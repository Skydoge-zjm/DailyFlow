use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const NOTE_WIN_PREFIX: &str = "note-";
pub const WIDGET_LABEL: &str = "widget-today";

pub fn note_label(id: &str) -> String {
    format!("{}{}", NOTE_WIN_PREFIX, id)
}

/// 打开（或刷新）今日待办悬浮窗（输入法风格）
pub fn open_widget_window(app: &AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(WIDGET_LABEL) {
        let _ = existing.show();
        return Ok(());
    }
    let d = crate::store::Store::new(crate::app_paths()).load();
    let (mut x, mut y) = if d.settings.widget_x != 0 || d.settings.widget_y != 0 {
        (d.settings.widget_x, d.settings.widget_y)
    } else {
        crate::model::default_widget_position()
    };
    // 校正到主屏可见范围
    if let Some(monitor) = app.primary_monitor().ok().flatten() {
        let pos = monitor.position();
        let size = monitor.size();
        let (mw, mh) = (size.width as i32, size.height as i32);
        x = x.clamp(pos.x, pos.x + mw - 240);
        y = y.clamp(pos.y, pos.y + mh - 200);
    }
    let builder = WebviewWindowBuilder::new(
        app,
        WIDGET_LABEL,
        WebviewUrl::App("index.html?view=widget".into()),
    )
    .title("今日待办")
    .inner_size(236.0, 300.0)
    .min_inner_size(200.0, 180.0)
    .position(x as f64, y as f64)
    .decorations(false)
    .transparent(true)
    .always_on_top(d.settings.widget_pinned)
    .resizable(true)
    .skip_taskbar(true)
    .shadow(false);

    builder
        .build()
        .map_err(|e| format!("创建悬浮窗失败: {}", e))?;
    Ok(())
}

pub fn close_widget_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(WIDGET_LABEL) {
        let _ = w.close();
    }
}

/// 打开（或刷新）一条便签窗口
pub fn open_note_window(app: &AppHandle, id: &str, note: &Value) -> Result<(), String> {
    let label = note_label(id);
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    let x = note["x"].as_i64().unwrap_or(1300) as i32;
    let y = note["y"].as_i64().unwrap_or(120) as i32;
    let w = note["w"].as_f64().unwrap_or(260.0);
    let h = note["h"].as_f64().unwrap_or(220.0);

    let builder = WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::App(format!("index.html?note={}", id).into()),
    )
    .title("便签")
    .inner_size(w, h)
    .position(x as f64, y as f64)
    .decorations(false)
    .transparent(true)
    .always_on_top(note["pinned"].as_bool().unwrap_or(false))
    .resizable(true)
    .skip_taskbar(true)
    .shadow(false);

    builder
        .build()
        .map_err(|e| format!("创建便签窗口失败: {}", e))?;
    Ok(())
}

/// 根据 data 同步便签与悬浮窗。
///
/// 启动时只清理不该显示的窗口，不会把所有历史 `visible` 便签一次性创建出来。
/// 新建便签、单独显示便签和托盘“显示全部”会通过显式函数打开窗口。
pub fn sync_note_windows(app: &AppHandle, data: &Value) {
    sync_note_windows_inner(app, data, None);
}

/// 同步外部变更，并只打开从隐藏变为可见的新便签。
pub fn sync_note_windows_with_previous(app: &AppHandle, previous: &Value, data: &Value) {
    sync_note_windows_inner(app, data, Some(previous));
}

/// 用户明确选择“显示全部便签”时使用。
pub fn open_visible_notes(app: &AppHandle, data: &Value) {
    let notes = data["notes"].as_array().cloned().unwrap_or_default();
    for n in notes {
        if n["visible"].as_bool().unwrap_or(false) {
            let id = n["id"].as_str().unwrap_or_default();
            let _ = open_note_window(app, id, &n);
        }
    }
}

fn sync_note_windows_inner(app: &AppHandle, data: &Value, previous: Option<&Value>) {
    let notes = data["notes"].as_array().cloned().unwrap_or_default();
    let want: Vec<(String, Value)> = notes
        .iter()
        .map(|n| (n["id"].as_str().unwrap_or_default().to_string(), n.clone()))
        .collect();

    // 关闭数据里已不存在/不可见但窗口还开着的
    for (label, _w) in app.webview_windows() {
        if let Some(id) = label.strip_prefix(NOTE_WIN_PREFIX) {
            let match_want = want.iter().find(|(wid, _)| wid == id);
            let should_show = match_want.map(|(_, n)| n["visible"].as_bool().unwrap_or(true)).unwrap_or(false);
            if !should_show {
                if match_want.is_none() {
                    let _ = app.get_webview_window(&label).map(|w| w.close());
                } else {
                    let _ = app.get_webview_window(&label).map(|w| w.hide());
                }
            }
        }
    }
    // 仅打开本次变更里从隐藏变为可见的便签，避免普通任务更新也弹出全部历史便签。
    if let Some(previous) = previous {
        let old_notes = previous["notes"].as_array().cloned().unwrap_or_default();
        for (id, n) in &want {
            if !n["visible"].as_bool().unwrap_or(false) {
                continue;
            }
            let was_visible = old_notes
                .iter()
                .find(|old| old["id"].as_str() == Some(id.as_str()))
                .and_then(|old| old["visible"].as_bool())
                .unwrap_or(false);
            if !was_visible {
                let _ = open_note_window(app, id, n);
            }
        }
    }

    // 今日悬浮窗跟随 settings.widget_visible
    let widget_visible = data["settings"]["widget_visible"].as_bool().unwrap_or(true);
    if widget_visible {
        let _ = open_widget_window(app);
    } else {
        close_widget_window(app);
    }

    // 悬浮窗置顶状态跟随
    if let Some(w) = app.get_webview_window(WIDGET_LABEL) {
        let _ = w.set_always_on_top(data["settings"]["widget_pinned"].as_bool().unwrap_or(true));
    }

    let _ = app.emit("note-synced", json!({}));
}
