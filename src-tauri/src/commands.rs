use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::domain::Ctx;
use crate::store::Store;

fn ctx(_handle: &AppHandle) -> Ctx {
    Ctx {
        store: Store::new(crate::app_paths()),
    }
}

fn notify_change(app: &AppHandle) {
    let _ = app.emit("data-changed", serde_json::json!({ "ts": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0) }));
}

// ---------- 前端调用的命令 ----------

#[tauri::command]
pub fn fe_load() -> Value {
    let c = ctx_handle();
    serde_json::json!(c.store.load())
}

fn ctx_handle() -> Ctx {
    Ctx {
        store: Store::new(crate::app_paths()),
    }
}

#[tauri::command]
pub fn fe_save(data: Value) -> Result<(), String> {
    let parsed: crate::model::Data =
        serde_json::from_value(data).map_err(|e| format!("数据格式错误: {}", e))?;
    let c = ctx_handle();
    c.store.save(&parsed)
}

/// 前端直接复用 CLI 的领域命令（task add 等），保持单一实现
#[tauri::command]
pub fn fe_call(app: AppHandle, args: Vec<String>) -> Value {
    let c = Ctx {
        store: Store::new(crate::app_paths()),
    };
    match crate::cli::dispatch_pub(&c, &args) {
        Ok(v) => {
            notify_change(&app);
            v
        }
        Err(e) => serde_json::json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
pub fn fe_note_window(app: AppHandle, id: String, note: Value) -> Result<(), String> {
    crate::windows::open_note_window(&app, &id, &note)
}

#[tauri::command]
pub fn fe_close_note_window(app: AppHandle, id: String) {
    if let Some(win) = app.get_webview_window(&crate::windows::note_label(&id)) {
        let _ = win.close();
    }
}

#[tauri::command]
pub fn fe_note_drag(window: tauri::WebviewWindow) {
    if let Ok(()) = window.start_dragging() {
    }
}

#[tauri::command]
pub fn fe_set_note_pos(app: AppHandle, id: String, x: i32, y: i32, w: f64, h: f64) -> Result<(), String> {
    let mut d = ctx(&app).store.load();
    {
        let n = d
            .note_mut(&id)
            .ok_or_else(|| format!("便签不存在: {}", id))?;
        n.x = x;
        n.y = y;
        n.w = w;
        n.h = h;
        n.updated_at = crate::timeparse::now_iso();
    }
    ctx(&app).store.save(&d)
}

#[tauri::command]
pub fn fe_theme(window: tauri::WebviewWindow, theme: String) {
    let _ = window.eval(&format!("document.documentElement.dataset.theme = '{}';", theme));
}

#[tauri::command]
pub fn fe_show_main(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
