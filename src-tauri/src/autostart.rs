#[cfg(windows)]
mod platform {
    use std::env;

    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::RegKey;

    const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const VALUE_NAME: &str = "DailyFlow";

    pub fn set_enabled(enabled: bool) -> Result<(), String> {
        let root = RegKey::predef(HKEY_CURRENT_USER);
        let (run_key, _) = root
            .create_subkey_with_flags(RUN_KEY, KEY_READ | KEY_WRITE)
            .map_err(|error| format!("无法打开 Windows 启动项: {error}"))?;

        if enabled {
            let executable = env::current_exe()
                .map_err(|error| format!("无法定位 DailyFlow 可执行文件: {error}"))?;
            let command = format!("\"{}\" gui", executable.display());
            run_key
                .set_value(VALUE_NAME, &command)
                .map_err(|error| format!("无法写入 Windows 启动项: {error}"))?;
        } else {
            match run_key.delete_value(VALUE_NAME) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(format!("无法移除 Windows 启动项: {error}")),
            }
        }
        Ok(())
    }
}

#[cfg(windows)]
pub use platform::set_enabled;

#[cfg(not(windows))]
pub fn set_enabled(_enabled: bool) -> Result<(), String> {
    Err("开机自启目前仅支持 Windows".into())
}
