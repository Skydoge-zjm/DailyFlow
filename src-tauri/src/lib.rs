mod cli;
mod commands;
mod domain;
mod model;
mod store;
mod timeparse;
mod tray;
mod windows;

use std::path::PathBuf;
use tauri::{Manager, RunEvent};

/// 数据目录：优先环境变量 DAILYFLOW_HOME（便于测试/AI 指定），否则 %APPDATA%/com.dailyflow.app
pub fn app_paths() -> PathBuf {
    if let Ok(home) = std::env::var("DAILYFLOW_HOME") {
        if !home.trim().is_empty() {
            return PathBuf::from(home);
        }
    }
    if let Some(base) = dirs_data_root() {
        return base.join("com.dailyflow.app");
    }
    PathBuf::from(".").join("dailyflow-data")
}

fn dirs_data_root() -> Option<PathBuf> {
    std::env::var("APPDATA").ok().map(PathBuf::from)
}

/// Tauri 正常 GUI 启动
fn run_gui() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 第二个实例启动：唤起主窗口
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .setup(|app| {
            let store = store::Store::new(app_paths());
            let data = store.load();

            tray::setup_tray(app)?;
            let _ = tray::on_tray_event; // 引用避免 unused 警告（由 tauri menu 事件回调触发）

            // 主窗口在 tauri.conf.json 中定义；这里同步便签窗口
            let v = serde_json::to_value(&data).unwrap_or(serde_json::json!({}));
            windows::sync_note_windows(app.handle(), &v);

            // 周期性检测 data.json 外部变更（CLI 写入），推送给前端
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut last = store_mtime(&store.path);
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(800));
                    let cur = store_mtime(&store.path);
                    if cur != last {
                        last = cur;
                        let d = store.load();
                        if let Ok(v) = serde_json::to_value(&d) {
                            use tauri::Emitter;
                            let _ = handle.emit("data-changed", &v);
                            windows::sync_note_windows(&handle, &v);
                        }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::fe_load,
            commands::fe_save,
            commands::fe_call,
            commands::fe_note_window,
            commands::fe_close_note_window,
            commands::fe_note_drag,
            commands::fe_note_pin_window,
            commands::fe_set_note_pos,
            commands::fe_theme,
            commands::fe_show_main,
            commands::fe_open_widget,
            commands::fe_widget_drag,
            commands::fe_widget_set_pos,
            commands::fe_widget_pin,
            commands::fe_widget_close,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                // 保持托盘常驻：不退出，除非用户显式退出
            }
        });
}

fn store_mtime(p: &std::path::Path) -> Option<std::time::SystemTime> {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // CLI 模式：带参数启动（dev 下 Tauri 不会带参数启动 GUI）
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !args.is_empty() {
        // GUI 内部参数白名单之外都视为 CLI
        let code = cli::run_cli(args);
        std::process::exit(code);
    }
    run_gui();
}
