use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliPathStatus {
    executable_directory: String,
    in_current_path: bool,
    in_user_path: bool,
}

#[cfg(windows)]
mod platform {
    use super::CliPathStatus;
    use std::env;
    use std::ffi::OsStr;
    use std::io;
    use std::path::{Path, PathBuf};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };
    use winreg::enums::{RegType, HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_EXPAND_SZ, REG_SZ};
    use winreg::{RegKey, RegValue};

    const MAX_PATH_VALUE_CHARS: usize = 32_767;

    pub fn status() -> Result<CliPathStatus, String> {
        let directory = executable_directory()?;
        let directory_text = path_to_string(&directory)?;
        let current_path = env::var_os("PATH").unwrap_or_default();
        let user_path = read_user_path()?.0;

        Ok(CliPathStatus {
            executable_directory: directory_text,
            in_current_path: path_contains(&current_path, &directory),
            in_user_path: user_path_contains(&user_path, &directory),
        })
    }

    pub fn add_to_user_path() -> Result<CliPathStatus, String> {
        let directory = executable_directory()?;
        let directory_text = path_to_string(&directory)?;
        if directory_text.contains(';') {
            return Err("应用目录包含 PATH 分隔符，无法安全配置".into());
        }

        let root = RegKey::predef(HKEY_CURRENT_USER);
        let (environment, _) = root
            .create_subkey_with_flags("Environment", KEY_READ | KEY_WRITE)
            .map_err(|error| format!("无法打开当前用户环境变量: {error}"))?;
        let (current, value_type) = read_path_value(&environment)?;
        if user_path_contains(&current, &directory) {
            return status();
        }

        let separator = if current.is_empty() || current.ends_with(';') {
            ""
        } else {
            ";"
        };
        let updated = format!("{current}{separator}{directory_text}");
        if updated.encode_utf16().count() + 1 > MAX_PATH_VALUE_CHARS {
            return Err("当前用户 PATH 太长，无法安全追加 DailyFlow 目录".into());
        }

        let mut bytes = Vec::with_capacity((updated.len() + 1) * 2);
        for unit in updated.encode_utf16().chain(std::iter::once(0)) {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        environment
            .set_raw_value(
                "Path",
                &RegValue {
                    bytes,
                    vtype: value_type,
                },
            )
            .map_err(|error| format!("写入当前用户 PATH 失败: {error}"))?;

        broadcast_environment_change();
        status()
    }

    fn executable_directory() -> Result<PathBuf, String> {
        env::current_exe()
            .map_err(|error| format!("无法定位 DailyFlow 可执行文件: {error}"))?
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "无法定位 DailyFlow 安装目录".into())
    }

    fn path_to_string(path: &Path) -> Result<String, String> {
        path.to_str()
            .map(str::to_owned)
            .ok_or_else(|| "DailyFlow 安装目录无法表示为 Windows 路径".into())
    }

    fn read_user_path() -> Result<(String, RegType), String> {
        let root = RegKey::predef(HKEY_CURRENT_USER);
        match root.open_subkey_with_flags("Environment", KEY_READ) {
            Ok(environment) => read_path_value(&environment),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                Ok((String::new(), REG_EXPAND_SZ))
            }
            Err(error) => Err(format!("读取当前用户环境变量失败: {error}")),
        }
    }

    fn read_path_value(environment: &RegKey) -> Result<(String, RegType), String> {
        match environment.get_raw_value("Path") {
            Ok(raw) => {
                if raw.vtype != REG_SZ && raw.vtype != REG_EXPAND_SZ {
                    return Err("当前用户 Path 注册表值不是字符串，已停止修改以保护现有数据".into());
                }
                let value = environment
                    .get_value("Path")
                    .map_err(|error| format!("读取当前用户 PATH 失败: {error}"))?;
                Ok((value, raw.vtype))
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                Ok((String::new(), REG_EXPAND_SZ))
            }
            Err(error) => Err(format!("读取当前用户 PATH 失败: {error}")),
        }
    }

    fn path_contains(path_value: &OsStr, expected: &Path) -> bool {
        let expected = normalize_path(&expected.to_string_lossy());
        env::split_paths(path_value)
            .any(|entry| normalize_path(&entry.to_string_lossy()) == expected)
    }

    fn user_path_contains(path_value: &str, expected: &Path) -> bool {
        let expanded = expand_environment_variables(path_value);
        path_contains(OsStr::new(&expanded), expected)
    }

    fn normalize_path(path: &str) -> String {
        path.trim()
            .trim_matches('"')
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_lowercase()
    }

    fn expand_environment_variables(value: &str) -> String {
        let mut expanded = String::with_capacity(value.len());
        let mut remaining = value;
        while let Some(start) = remaining.find('%') {
            expanded.push_str(&remaining[..start]);
            let variable_start = start + 1;
            let Some(end) = remaining[variable_start..].find('%') else {
                expanded.push_str(&remaining[start..]);
                return expanded;
            };
            let variable_end = variable_start + end;
            let variable = &remaining[variable_start..variable_end];
            if !variable.is_empty() {
                if let Some(replacement) = env::var_os(variable) {
                    expanded.push_str(&replacement.to_string_lossy());
                } else {
                    expanded.push('%');
                    expanded.push_str(variable);
                    expanded.push('%');
                }
            } else {
                expanded.push_str("%%");
            }
            remaining = &remaining[variable_end + 1..];
        }
        expanded.push_str(remaining);
        expanded
    }

    fn broadcast_environment_change() {
        let environment = "Environment\0".encode_utf16().collect::<Vec<_>>();
        let mut result = 0usize;
        unsafe {
            let _ = SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                0,
                environment.as_ptr() as isize,
                SMTO_ABORTIFHUNG,
                5_000,
                &mut result,
            );
        }
    }
}

#[cfg(windows)]
pub use platform::{add_to_user_path, status};

#[cfg(not(windows))]
pub fn status() -> Result<CliPathStatus, String> {
    Err("PATH 检测目前仅支持 Windows".into())
}

#[cfg(not(windows))]
pub fn add_to_user_path() -> Result<CliPathStatus, String> {
    Err("PATH 配置目前仅支持 Windows".into())
}
