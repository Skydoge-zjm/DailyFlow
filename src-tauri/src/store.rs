use std::fs;
use std::path::{Path, PathBuf};

use crate::model::Data;

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

    pub fn load(&self) -> Data {
        match fs::read_to_string(&self.path) {
            Ok(raw) => match serde_json::from_str::<Data>(&raw) {
                Ok(data) => data,
                Err(e) => {
                    eprintln!("warn: data.json parse failed ({}), backup kept, starting fresh", e);
                    let _ = self.backup_corrupt(&raw);
                    Data::default()
                }
            },
            Err(_) => Data::default(),
        }
    }

    /// 原子写：先写临时文件，再 rename 覆盖；写前滚动备份。
    pub fn save(&self, data: &Data) -> Result<(), String> {
        if self.path.exists() {
            self.backup()?;
        }
        let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        // Windows 上 rename 覆盖已存在文件：先移除旧的
        if self.path.exists() {
            let _ = fs::remove_file(&self.path);
        }
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
