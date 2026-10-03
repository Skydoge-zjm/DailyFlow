mod autostart;
mod cli;
mod cli_path;
mod command;
mod commands;
mod domain;
mod error;
mod model;
mod store;
mod timeparse;
mod tray;
mod windows;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Manager, RunEvent};

#[derive(Clone)]
struct SyncState {
    snapshot: Arc<Mutex<SyncSnapshot>>,
    dispatch: Arc<Mutex<()>>,
    status: Arc<Mutex<SyncStatus>>,
}

struct SyncSnapshot {
    modified: Option<std::time::SystemTime>,
    generation: u64,
    data: Arc<model::Data>,
}

#[derive(Clone, PartialEq, Eq)]
struct SyncStatus {
    state: SyncStateKind,
    attempt: u32,
    message: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SyncStateKind {
    Synced,
    Retrying,
}

impl SyncState {
    fn new(data: model::Data, modified: Option<std::time::SystemTime>) -> Self {
        Self {
            snapshot: Arc::new(Mutex::new(SyncSnapshot {
                modified,
                generation: 0,
                data: Arc::new(data),
            })),
            dispatch: Arc::new(Mutex::new(())),
            status: Arc::new(Mutex::new(SyncStatus {
                state: SyncStateKind::Synced,
                attempt: 0,
                message: None,
            })),
        }
    }
}

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
        .plugin(tauri_plugin_notification::init())
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // 主窗口关闭按钮执行隐藏，托盘仍可重新唤起；通过托盘“退出”才结束进程。
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let store = store::Store::new(app_paths());
            let mut data = store.load().map_err(std::io::Error::other)?;
            // 不在每次启动时重放历史便签窗口；保留内容与布局，只清除“当前显示”标记。
            if data.notes.iter().any(|note| note.visible) {
                if let Err(error) = store.with_lock(2000, |current| {
                    for note in &mut current.notes {
                        if note.visible {
                            note.visible = false;
                            note.updated_at = timeparse::now_iso();
                        }
                    }
                    Ok(())
                }) {
                    eprintln!("无法重置便签显示状态: {}", error);
                }
                data = store.load().map_err(std::io::Error::other)?;
            }

            tray::setup_tray(app)?;
            let _ = tray::on_tray_event; // 引用避免 unused 警告（由 tauri menu 事件回调触发）

            app.manage(SyncState::new(data.clone(), store_mtime(&store.path)));
            windows::sync_note_windows(app.handle(), &data);
            update_tray_from_data(app.handle(), &data);

            // 用文件 mtime 检测 CLI 外部修改；失败时保留未消费的 mtime，按退避策略重试。
            let handle = app.handle().clone();
            let sync_state = app.state::<SyncState>().inner().clone();
            std::thread::spawn(move || {
                let mut retry_delay = std::time::Duration::from_secs(1);
                let mut retrying = false;
                loop {
                    std::thread::sleep(retry_delay);
                    let Some(cur) = store_mtime(&store.path) else {
                        // 新安装时 data.json 尚不存在，这是正常的空数据状态，不应显示错误。
                        if !store.path.exists() {
                            if retrying {
                                retrying = false;
                                publish_sync_status(
                                    &handle,
                                    &sync_state,
                                    SyncStatus {
                                        state: SyncStateKind::Synced,
                                        attempt: 0,
                                        message: None,
                                    },
                                );
                            }
                            retry_delay = std::time::Duration::from_secs(1);
                            continue;
                        }
                        if !retrying {
                            retrying = true;
                            publish_sync_status(
                                &handle,
                                &sync_state,
                                SyncStatus {
                                    state: SyncStateKind::Retrying,
                                    attempt: 1,
                                    message: Some("无法读取数据文件，正在重试".into()),
                                },
                            );
                        }
                        retry_delay = std::cmp::min(
                            retry_delay.saturating_mul(2),
                            std::time::Duration::from_secs(30),
                        );
                        continue;
                    };
                    let generation = {
                        let snapshot = sync_state
                            .snapshot
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner());
                        if snapshot.modified == Some(cur) && !retrying {
                            continue;
                        }
                        snapshot.generation
                    };
                    match store.load() {
                        Ok(data) => {
                            let data = Arc::new(data);
                            let _dispatch = sync_state
                                .dispatch
                                .lock()
                                .unwrap_or_else(|poisoned| poisoned.into_inner());
                            let previous = {
                                let mut snapshot = sync_state
                                    .snapshot
                                    .lock()
                                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                                if snapshot.generation != generation {
                                    continue;
                                }
                                let previous = std::mem::replace(&mut snapshot.data, data.clone());
                                snapshot.modified = Some(cur);
                                snapshot.generation = snapshot.generation.wrapping_add(1);
                                previous
                            };
                            notify_data_changed(&handle, &previous, &data);
                            retrying = false;
                            retry_delay = std::time::Duration::from_secs(1);
                            publish_sync_status(
                                &handle,
                                &sync_state,
                                SyncStatus {
                                    state: SyncStateKind::Synced,
                                    attempt: 0,
                                    message: None,
                                },
                            );
                        }
                        Err(error) => {
                            retrying = true;
                            let attempt = {
                                let status = sync_state
                                    .status
                                    .lock()
                                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                                status.attempt.saturating_add(1)
                            };
                            publish_sync_status(
                                &handle,
                                &sync_state,
                                SyncStatus {
                                    state: SyncStateKind::Retrying,
                                    attempt,
                                    message: Some(error),
                                },
                            );
                            eprintln!(
                                "读取外部数据变更失败，将重试: {}",
                                sync_state_status_message(&sync_state)
                            );
                            retry_delay = std::cmp::min(
                                retry_delay.saturating_mul(2),
                                std::time::Duration::from_secs(30),
                            );
                        }
                    }
                }
            });

            let notification_handle = app.handle().clone();
            std::thread::spawn(move || {
                use tauri_plugin_notification::NotificationExt;
                let ctx = domain::Ctx {
                    store: store::Store::new(app_paths()),
                };
                loop {
                    let due_reminders = match ctx.due_reminders() {
                        Ok(tasks) => tasks,
                        Err(error) => {
                            eprintln!("读取待提醒任务失败: {}", error);
                            std::thread::sleep(std::time::Duration::from_secs(15));
                            continue;
                        }
                    };
                    for task in due_reminders {
                        let body = format!(
                            "{} · {}",
                            task.title,
                            task.remind_at.as_deref().unwrap_or("")
                        );
                        match notification_handle
                            .notification()
                            .builder()
                            .title("DailyFlow 提醒")
                            .body(body)
                            .show()
                        {
                            Ok(()) => {
                                if let Err(error) = ctx.mark_reminded(&task) {
                                    eprintln!("记录任务提醒失败: {}", error);
                                }
                            }
                            Err(error) => eprintln!("发送任务提醒失败: {}", error),
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_secs(15));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::fe_load_ui,
            commands::fe_cli_path_status,
            commands::fe_cli_path_add,
            commands::fe_save_settings,
            commands::fe_call,
            commands::fe_note_window,
            commands::fe_close_note_window,
            commands::fe_note_drag,
            commands::fe_note_pin_window,
            commands::fe_set_note_pos,
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

fn sync_state_status_message(state: &SyncState) -> String {
    state
        .status
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .message
        .clone()
        .unwrap_or_else(|| "未知同步错误".into())
}

fn publish_sync_status(app: &tauri::AppHandle, state: &SyncState, next: SyncStatus) {
    let changed = {
        let mut current = state
            .status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *current == next {
            false
        } else {
            *current = next.clone();
            true
        }
    };
    if !changed {
        return;
    }
    use tauri::Emitter;
    let _ = app.emit("sync-status", serde_json::json!({
        "state": match next.state {
            SyncStateKind::Synced => "synced",
            SyncStateKind::Retrying => "retrying",
        },
        "attempt": next.attempt,
        "code": next.message.as_ref().map(|message| crate::error::sync_error(message.clone()).code),
        "message": next.message,
    }));
}

fn store_mtime(p: &std::path::Path) -> Option<std::time::SystemTime> {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
}

pub(crate) fn publish_data_change(app: &tauri::AppHandle, data: model::Data) {
    let state = app.state::<SyncState>().inner().clone();
    let _dispatch = state
        .dispatch
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let previous = {
        let mut snapshot = state
            .snapshot
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let data = Arc::new(data);
        let previous = std::mem::replace(&mut snapshot.data, data.clone());
        snapshot.generation = snapshot.generation.wrapping_add(1);
        (previous, data)
    };
    notify_data_changed(app, &previous.0, &previous.1);
}

fn notify_data_changed(app: &tauri::AppHandle, previous: &model::Data, data: &model::Data) {
    let tasks_changed = previous.tasks != data.tasks;
    if !tasks_changed && !previous.affects_ui_except_tasks(data) {
        return;
    }
    use tauri::Emitter;
    let _ = app.emit("data-changed", data.ui_snapshot());
    windows::sync_note_windows_with_previous(app, previous, data);
    if tasks_changed {
        update_tray_from_data(app, data);
    }
}

/// 依据数据更新托盘图标状态与提示（今日待办数/逾期数）
fn update_tray_from_data(app: &tauri::AppHandle, d: &model::Data) {
    let today = timeparse::today_str();
    let pending = d
        .tasks
        .iter()
        .filter(|t| t.date == today && !t.done && t.kind != model::TaskKind::Goal)
        .count();
    let overdue = d
        .tasks
        .iter()
        .filter(|t| {
            !t.done && t.kind != model::TaskKind::Goal && !t.date.is_empty() && t.date < today
        })
        .count();
    tray::update_tray_state(app, pending, overdue);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().skip(1).collect();

    // 显式 `gui` 子命令：从任意上下文启动图形界面
    if args.len() == 1 && args[0] == "gui" {
        run_gui();
        return;
    }

    // 带参数：CLI 模式
    if !args.is_empty() {
        prepare_cli_console();
        let code = cli::run_cli(args);
        std::process::exit(code);
    }

    // 无参数是用户双击应用或从开始菜单启动，进入主窗口。
    // CLI 调用仍通过带参数的子命令分流；需要显式启动 GUI 也可使用 `dailyflow gui`。
    run_gui();
}

#[cfg(windows)]
fn prepare_cli_console() {
    use std::ffi::c_void;

    const STD_OUTPUT_HANDLE: u32 = (-11i32) as u32;
    const ATTACH_PARENT_PROCESS: u32 = u32::MAX;

    #[link(name = "kernel32")]
    extern "system" {
        #[link_name = "GetStdHandle"]
        fn get_std_handle(kind: u32) -> *mut c_void;
        #[link_name = "AttachConsole"]
        fn attach_console(process_id: u32) -> i32;
    }

    unsafe {
        let invalid = -1isize as *mut c_void;
        let stdout = get_std_handle(STD_OUTPUT_HANDLE);
        if stdout.is_null() || stdout == invalid {
            let _ = attach_console(ATTACH_PARENT_PROCESS);
        }
    }
}

#[cfg(not(windows))]
fn prepare_cli_console() {}
