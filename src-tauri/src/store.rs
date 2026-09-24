use fs2::FileExt;
use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};

use crate::model::{Data, DATA_VERSION};

struct FileLock {
    file: File,
}

impl Drop for FileLock {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.file);
    }
}

pub struct Store {
    pub path: PathBuf,
}

impl Store {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&app_data_dir);
        let backups = app_data_dir.join("backups");
        let _ = fs::create_dir_all(&backups);
        Store {
            path: app_data_dir.join("data.json"),
        }
    }

    fn load_inner(&self) -> Result<(Data, bool), String> {
        let raw = match fs::read_to_string(&self.path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok((Data::default(), false));
            }
            Err(error) => return Err(format!("读取数据文件失败: {}", error)),
        };
        let mut data = match serde_json::from_str::<Data>(&raw) {
            Ok(data) => data,
            Err(error) => {
                if let Err(backup_error) = self.backup_corrupt(&raw) {
                    eprintln!("备份损坏的数据文件失败: {}", backup_error);
                }
                return Err(format!("data.json 解析失败，原文件已保留: {}", error));
            }
        };
        let migrated = if data.version == 1 {
            data.version = DATA_VERSION;
            true
        } else if data.version != DATA_VERSION {
            return Err(format!(
                "数据版本 {} 不受当前版本 {} 支持；原文件已保留",
                data.version, DATA_VERSION
            ));
        } else {
            false
        };
        Ok((data, migrated))
    }

    pub fn load(&self) -> Result<Data, String> {
        let (data, migrated) = self.load_inner()?;
        if !migrated {
            return Ok(data);
        }
        let _lock = self.acquire_lock(2000)?;
        let (latest, needs_persist) = self.load_inner()?;
        if needs_persist {
            self.save_unlocked(&latest)?;
        }
        Ok(latest)
    }

    /// 带文件锁的读-改-写。数据变更和原子落盘都在锁内完成。
    pub fn with_lock<T>(
        &self,
        timeout_ms: u64,
        f: impl FnOnce(&mut Data) -> Result<T, String>,
    ) -> Result<T, String> {
        let _lock = self.acquire_lock(timeout_ms)?;
        let (mut data, migrated) = self.load_inner()?;
        let result = f(&mut data);
        if result.is_ok() || migrated {
            self.save_unlocked(&data)?;
        }
        result
    }

    fn acquire_lock(&self, timeout_ms: u64) -> Result<FileLock, String> {
        let start = std::time::Instant::now();
        let lock_path = self.path.with_extension("lock");
        if let Some(parent) = lock_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建数据目录失败: {}", e))?;
        }
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&lock_path)
            .map_err(|e| format!("打开数据锁失败: {}", e))?;
        loop {
            match FileExt::try_lock_exclusive(&file) {
                Ok(()) => return Ok(FileLock { file }),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if start.elapsed().as_millis() >= timeout_ms as u128 {
                        return Err("获取数据锁超时（另一进程可能正在写入）".into());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(error) => return Err(format!("获取数据锁失败: {}", error)),
            }
        }
    }

    /// 原子写：锁内先写临时文件，再 rename 覆盖；写前滚动备份。
    #[allow(dead_code)]
    pub fn save(&self, data: &Data) -> Result<(), String> {
        if data.version != DATA_VERSION {
            return Err(format!(
                "不能保存数据版本 {}；当前版本为 {}",
                data.version, DATA_VERSION
            ));
        }
        let _lock = self.acquire_lock(2000)?;
        self.save_unlocked(data)
    }

    fn save_unlocked(&self, data: &Data) -> Result<(), String> {
        if self.path.exists() {
            self.backup()?;
        }
        let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        // Windows 上直接 rename 覆盖，避免先删除目标文件导致读者误判为空数据。
        fs::rename(&tmp, &self.path).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn backup(&self) -> Result<(), String> {
        let stamp = {
            // 本地时间戳：YYYYMMDD-HHMMSS
            let secs = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            format_epoch_local(secs)
        };
        let backups = self.path.parent().unwrap().join("backups");
        let dest = backups.join(format!("data-{}.json", stamp));
        if !dest.exists() {
            // 内容与最近一份备份相同则跳过（连续多次保存不产生重复备份）
            if let Some(latest) = latest_backup(&backups) {
                if same_file_contents(&self.path, &latest) {
                    return Ok(());
                }
            }
            fs::copy(&self.path, &dest).map_err(|e| e.to_string())?;
            prune_backups(&backups, 10);
        }
        Ok(())
    }

    fn backup_corrupt(&self, raw: &str) -> Result<(), String> {
        let stamp = format_epoch_local(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64,
        );
        let backups = self.path.parent().unwrap().join("backups");
        let dest = backups.join(format!("data-corrupt-{}.json", stamp));
        fs::write(dest, raw).map_err(|e| e.to_string())
    }
}

fn prune_backups(dir: &Path, keep: usize) {
    let mut files: Vec<_> = match fs::read_dir(dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false))
            .map(|e| (e.path(), e.metadata().and_then(|m| m.modified()).ok()))
            .collect(),
        Err(_) => return,
    };
    files.sort_by_key(|(_, m)| *m);
    while files.len() > keep {
        let (path, _) = files.remove(0);
        let _ = fs::remove_file(path);
    }
}

/// UTC 秒 → 本地时间字符串（不引库，用本地时区偏移近似：Windows 上取系统时区 via env）
fn format_epoch_local(secs: i64) -> String {
    // 简化：使用 UTC+8 常见场景不通用，改为直接用秒级 UTC 时间戳，可读性够用
    let days = secs / 86400;
    let rem = secs.rem_euclid(86400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // civil from days (Howard Hinnant's algorithm)
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    format!("{:04}{:02}{:02}-{:02}{:02}{:02}", year, month, d, h, m, s)
}

/// backups 目录里最新的一份备份文件
fn latest_backup(dir: &Path) -> Option<PathBuf> {
    let mut files: Vec<_> = fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_str()
                .map(|n| n.starts_with("data-") && !n.contains("corrupt"))
                .unwrap_or(false)
        })
        .map(|e| e.path())
        .collect();
    files.sort();
    files.pop()
}

/// 低成本比较两文件是否内容一致（长度 + 逐字节）
fn same_file_contents(a: &Path, b: &Path) -> bool {
    let (ma, mb) = match (fs::metadata(a), fs::metadata(b)) {
        (Ok(x), Ok(y)) => (x, y),
        _ => return false,
    };
    if ma.len() != mb.len() {
        return false;
    }
    match (fs::read(a), fs::read(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Priority, Task, TaskKind};

    fn temp_store_dir() -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("dailyflow-store-{}-{}", std::process::id(), nonce))
    }

    fn test_task(id: usize) -> Task {
        Task {
            id: format!("t_{}", id),
            title: format!("task {}", id),
            notes: String::new(),
            date: "2026-09-23".into(),
            start: None,
            end: None,
            done: false,
            priority: Priority::Normal,
            kind: TaskKind::Normal,
            quadrant: crate::model::Quadrant::Q2,
            repeat: crate::model::RepeatRule::None,
            repeat_day: None,
            repeat_parent_id: None,
            remind_at: None,
            reminded_at: None,
            tags: Vec::new(),
            created_at: String::new(),
            completed_at: None,
        }
    }

    #[test]
    fn concurrent_updates_keep_every_change() {
        let dir = temp_store_dir();
        let workers = 8;
        let updates_per_worker = 12;
        let mut threads = Vec::new();

        for worker in 0..workers {
            let path = dir.clone();
            threads.push(std::thread::spawn(move || {
                let store = Store::new(path);
                for update in 0..updates_per_worker {
                    let id = worker * updates_per_worker + update;
                    store
                        .with_lock(5000, |data| {
                            data.tasks.push(test_task(id));
                            Ok(())
                        })
                        .unwrap();
                }
            }));
        }

        for thread in threads {
            thread.join().unwrap();
        }

        let store = Store::new(dir.clone());
        assert_eq!(
            store.load().unwrap().tasks.len(),
            workers * updates_per_worker
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn failed_update_does_not_write_or_leave_lock() {
        let dir = temp_store_dir();
        let store = Store::new(dir.clone());
        let result = store.with_lock::<()>(100, |data| {
            data.tasks.push(test_task(1));
            Err("abort".into())
        });

        assert!(result.is_err());
        assert!(store.load().unwrap().tasks.is_empty());
        let lock_file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(store.path.with_extension("lock"))
            .unwrap();
        assert!(FileExt::try_lock_exclusive(&lock_file).is_ok());
        fs::remove_dir_all(dir).unwrap();
    }
}
