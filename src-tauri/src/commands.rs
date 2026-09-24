use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::domain::Ctx;
use crate::store::Store;

fn optional_string<'a>(patch: &'a Value, key: &str) -> Result<Option<&'a str>, String> {
    match patch.get(key) {
        None => Ok(None),
        Some(Value::String(value)) => Ok(Some(value)),
        Some(_) => Err(format!("{} 必须是字符串", key)),
    }
}

fn optional_bool(patch: &Value, key: &str) -> Result<Option<bool>, String> {
    match patch.get(key) {
        None => Ok(None),
        Some(Value::Bool(value)) => Ok(Some(*value)),
        Some(_) => Err(format!("{} 必须是布尔值", key)),
    }
}

fn optional_f64(patch: &Value, key: &str) -> Result<Option<f64>, String> {
    match patch.get(key) {
        None => Ok(None),
        Some(Value::Number(value)) => value
            .as_f64()
            .map(Some)
            .ok_or_else(|| format!("{} 必须是数字", key)),
        Some(_) => Err(format!("{} 必须是数字", key)),
    }
}

fn optional_i64(patch: &Value, key: &str) -> Result<Option<i64>, String> {
    match patch.get(key) {
        None => Ok(None),
        Some(Value::Number(value)) => value
            .as_i64()
            .map(Some)
            .ok_or_else(|| format!("{} 必须是整数", key)),
        Some(_) => Err(format!("{} 必须是整数", key)),
    }
}

fn ctx(_handle: &AppHandle) -> Ctx {
    Ctx {
        store: Store::new(crate::app_paths()),
    }
}

// ---------- 前端调用的命令 ----------

#[tauri::command]
pub fn fe_cli_path_status() -> Result<crate::cli_path::CliPathStatus, String> {
    crate::cli_path::status()
}

#[tauri::command]
pub fn fe_cli_path_add() -> Result<crate::cli_path::CliPathStatus, String> {
    crate::cli_path::add_to_user_path()
}

#[tauri::command]
pub fn fe_load() -> Result<crate::model::Data, String> {
    let c = Ctx {
        store: Store::new(crate::app_paths()),
    };
    c.store.load()
}

/// 合并保存设置字段，避免前端携带的旧整份 Data 覆盖其他窗口刚保存的任务或便签。
#[tauri::command]
pub fn fe_save_settings(app: AppHandle, patch: Value) -> Result<(), String> {
    let c = ctx(&app);
    let patch_object = patch
        .as_object()
        .ok_or_else(|| "设置 patch 必须是对象".to_string())?;
    const ALLOWED_FIELDS: &[&str] = &[
        "theme",
        "theme_preset",
        "theme_overrides",
        "sticky_opacity",
        "autostart",
        "widget_visible",
        "widget_pinned",
        "widget_x",
        "widget_y",
    ];
    if let Some(unknown) = patch_object
        .keys()
        .find(|key| !ALLOWED_FIELDS.contains(&key.as_str()))
    {
        return Err(format!("未知设置字段: {}", unknown));
    }
    let before = serde_json::to_value(c.store.load()?).map_err(|e| e.to_string())?;
    c.store.with_lock(2000, |data| {
        if let Some(theme) = optional_string(&patch, "theme")? {
            data.settings.theme = match theme {
                "dark" => crate::model::Theme::Dark,
                "light" => crate::model::Theme::Light,
                "auto" => crate::model::Theme::Auto,
                other => return Err(format!("无效主题模式: {}", other)),
            };
        }
        if let Some(preset) = optional_string(&patch, "theme_preset")? {
            if !crate::model::THEME_PRESETS.contains(&preset) {
                return Err(format!("无效主题预设: {}", preset));
            }
            data.settings.theme_preset = preset.to_string();
        }
        if let Some(overrides) = patch.get("theme_overrides") {
            let map = overrides
                .as_object()
                .ok_or_else(|| "theme_overrides 必须是对象".to_string())?;
            let mut parsed = std::collections::BTreeMap::new();
            for (key, value) in map {
                let value = value
                    .as_str()
                    .ok_or_else(|| format!("主题变量 {} 的值必须是字符串", key))?;
                if !key.starts_with("--") {
                    return Err(format!("无效 CSS 变量名: {}", key));
                }
                parsed.insert(key.clone(), value.to_string());
            }
            crate::model::validate_theme_overrides(&parsed)?;
            data.settings.theme_overrides = parsed;
        }
        if let Some(opacity) = optional_f64(&patch, "sticky_opacity")? {
            if !(0.0..=1.0).contains(&opacity) {
                return Err("sticky_opacity 必须在 0 到 1 之间".into());
            }
            data.settings.sticky_opacity = opacity;
        }
        if let Some(value) = optional_bool(&patch, "autostart")? {
            data.settings.autostart = value;
        }
        if let Some(value) = optional_bool(&patch, "widget_visible")? {
            data.settings.widget_visible = value;
        }
        if let Some(value) = optional_bool(&patch, "widget_pinned")? {
            data.settings.widget_pinned = value;
        }
        if let Some(value) = optional_i64(&patch, "widget_x")? {
            data.settings.widget_x =
                i32::try_from(value).map_err(|_| "widget_x 超出范围".to_string())?;
        }
        if let Some(value) = optional_i64(&patch, "widget_y")? {
            data.settings.widget_y =
                i32::try_from(value).map_err(|_| "widget_y 超出范围".to_string())?;
        }
        Ok(())
    })?;
    let after = serde_json::to_value(c.store.load()?).map_err(|e| e.to_string())?;
    let _ = app.emit("data-changed", &after);
    crate::windows::sync_note_windows_with_previous(&app, &before, &after);
    Ok(())
}

/// 前端直接复用 CLI 的领域命令（task add 等），保持单一实现
#[tauri::command]
pub fn fe_call(app: AppHandle, args: Vec<String>) -> Value {
    let c = Ctx {
        store: Store::new(crate::app_paths()),
    };
    let before = c.store.load().ok();
    match crate::cli::dispatch_pub(&c, &args) {
        Ok(v) => {
            // 广播完整数据（与 lib.rs 轮询线程的 payload 结构一致），所有窗口据此刷新
            if let Ok(d) = c.store.load() {
                if let Ok(v) = serde_json::to_value(&d) {
                    let _ = app.emit("data-changed", &v);
                    if let Some(before) = before
                        .as_ref()
                        .and_then(|data| serde_json::to_value(data).ok())
                    {
                        crate::windows::sync_note_windows_with_previous(&app, &before, &v);
                    } else {
                        crate::windows::sync_note_windows(&app, &v);
                    }
                }
            }
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
    if let Ok(()) = window.start_dragging() {}
}

#[tauri::command]
pub fn fe_set_note_pos(
    app: AppHandle,
    id: String,
    x: i32,
    y: i32,
    w: f64,
    h: f64,
    monitor: String,
) -> Result<(), String> {
    let c = ctx(&app);
    c.store.with_lock(2000, |d| {
        let n = d
            .note_mut(&id)
            .ok_or_else(|| format!("便签不存在: {}", id))?;
        n.x = x;
        n.y = y;
        n.w = w;
        n.h = h;
        n.monitor = monitor;
        n.updated_at = crate::timeparse::now_iso();
        Ok(())
    })
}

#[tauri::command]
pub fn fe_show_main(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// ---------- 今日悬浮窗 ----------

#[tauri::command]
pub fn fe_open_widget(app: AppHandle) -> Result<(), String> {
    crate::windows::open_widget_window(&app)
}

#[tauri::command]
pub fn fe_widget_drag(window: tauri::WebviewWindow) {
    let _ = window.start_dragging();
}

#[tauri::command]
pub fn fe_widget_set_pos(
    _app: AppHandle,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    monitor: String,
) -> Result<(), String> {
    let c = Ctx {
        store: Store::new(crate::app_paths()),
    };
    c.widget_set_pos(x, y, w, h, &monitor)?;
    Ok(())
}

#[tauri::command]
pub fn fe_widget_pin(app: AppHandle, pinned: bool) -> Result<(), String> {
    let c = Ctx {
        store: Store::new(crate::app_paths()),
    };
    c.widget_pin(pinned)?;
    if let Some(w) = app.get_webview_window(crate::windows::WIDGET_LABEL) {
        let _ = w.set_always_on_top(pinned);
    }
    Ok(())
}

/// 便签窗口置顶切换（窗口的 always_on_top + 数据的 pinned 字段）
#[tauri::command]
pub fn fe_note_pin_window(app: AppHandle, id: String, pin: bool) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(&crate::windows::note_label(&id)) {
        let _ = w.set_always_on_top(pin);
    }
    Ok(())
}

#[tauri::command]
pub fn fe_widget_close(app: AppHandle) -> Result<(), String> {
    let c = Ctx {
        store: Store::new(crate::app_paths()),
    };
    c.widget_show(false)?;
    crate::windows::close_widget_window(&app);
    Ok(())
}
