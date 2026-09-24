use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const NOTE_WIN_PREFIX: &str = "note-";
pub const WIDGET_LABEL: &str = "widget-today";

static OPENING_NOTE_WINDOWS: Mutex<Vec<String>> = Mutex::new(Vec::new());
static OPENING_WIDGET_WINDOW: AtomicBool = AtomicBool::new(false);

struct NoteWindowCreationGuard(String);

impl Drop for NoteWindowCreationGuard {
    fn drop(&mut self) {
        release_note_window(&self.0);
    }
}

struct WidgetWindowCreationGuard;

impl Drop for WidgetWindowCreationGuard {
    fn drop(&mut self) {
        OPENING_WIDGET_WINDOW.store(false, Ordering::Release);
    }
}

fn release_note_window(label: &str) {
    let mut opening = OPENING_NOTE_WINDOWS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(index) = opening.iter().position(|current| current == label) {
        opening.remove(index);
    }
}

pub fn note_label(id: &str) -> String {
    format!("{}{}", NOTE_WIN_PREFIX, id)
}

fn clamp_position(
    x: i32,
    y: i32,
    width: f64,
    height: f64,
    monitor_origin: (i32, i32),
    monitor_size: (u32, u32),
    scale: f64,
) -> (i32, i32) {
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    let (origin_x, origin_y) = monitor_origin;
    let (size_x, size_y) = monitor_size;
    let max_x = origin_x + ((size_x as f64 / scale - width.max(1.0)).max(0.0) as i32);
    let max_y = origin_y + ((size_y as f64 / scale - height.max(1.0)).max(0.0) as i32);
    (x.clamp(origin_x, max_x), y.clamp(origin_y, max_y))
}

fn monitor_key(monitor: &tauri::Monitor) -> String {
    if let Some(name) = monitor.name().filter(|name| !name.trim().is_empty()) {
        return name.trim().to_string();
    }
    let position = monitor.position();
    format!("@{},{}", position.x, position.y)
}

/// 请求打开（或刷新）今日待办悬浮窗（输入法风格）。
///
/// WebView2 在 Windows 上不能从同步命令或托盘事件处理器直接创建窗口，
/// 所以实际的 builder 必须在独立线程中执行。
pub fn open_widget_window(app: &AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(WIDGET_LABEL) {
        let _ = existing.show();
        return Ok(());
    }
    if OPENING_WIDGET_WINDOW.swap(true, Ordering::AcqRel) {
        return Ok(());
    }
    let handle = app.clone();
    std::thread::Builder::new()
        .name("dailyflow-widget-window".into())
        .spawn(move || {
            let _creation_guard = WidgetWindowCreationGuard;
            if let Err(error) = build_widget_window(&handle) {
                eprintln!("创建悬浮窗失败: {}", error);
            }
        })
        .map(|_| ())
        .map_err(|error| {
            OPENING_WIDGET_WINDOW.store(false, Ordering::Release);
            format!("启动悬浮窗线程失败: {}", error)
        })
}

fn build_widget_window(app: &AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(WIDGET_LABEL) {
        let _ = existing.show();
        return Ok(());
    }
    let d = crate::store::Store::new(crate::app_paths())
        .load()
        .map_err(|error| format!("读取悬浮窗设置失败: {}", error))?;
    let mut width = d.settings.widget_w.clamp(200, 1200) as f64;
    let mut height = d.settings.widget_h.clamp(180, 1200) as f64;
    let saved_monitor = d.settings.widget_monitor.trim();
    let has_relative_position = !saved_monitor.is_empty();
    let has_legacy_position = d.settings.widget_x != 0 || d.settings.widget_y != 0;
    let monitors = app.available_monitors().unwrap_or_default();
    let primary = app.primary_monitor().ok().flatten();
    let monitor = monitors
        .iter()
        .find(|monitor| has_relative_position && monitor_key(monitor) == saved_monitor)
        .or_else(|| primary.as_ref())
        .or_else(|| monitors.first());
    let (mut x, mut y) = if has_relative_position || has_legacy_position {
        (d.settings.widget_x, d.settings.widget_y)
    } else {
        crate::model::default_widget_position()
    };
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        let origin = (
            (area.position.x as f64 / scale).round() as i32,
            (area.position.y as f64 / scale).round() as i32,
        );
        let logical_width = (area.size.width as f64 / scale).max(200.0);
        let logical_height = (area.size.height as f64 / scale).max(180.0);
        width = width.min(logical_width);
        height = height.min(logical_height);
        if has_relative_position {
            x = x.saturating_add(origin.0);
            y = y.saturating_add(origin.1);
        } else if !has_legacy_position {
            x = origin.0 + (logical_width - width - 16.0).max(0.0) as i32;
            y = origin.1 + 16;
        }
        (x, y) = clamp_position(
            x,
            y,
            width,
            height,
            origin,
            (area.size.width, area.size.height),
            scale,
        );
    }
    let builder = WebviewWindowBuilder::new(
        app,
        WIDGET_LABEL,
        WebviewUrl::App("index.html?view=widget".into()),
    )
    .title("今日待办")
    .inner_size(width, height)
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

/// 请求打开（或刷新）一条便签窗口。
///
/// 只在这里登记窗口标签，真正的 builder 在独立线程执行，避免 WebView2
/// 在同步命令、数据轮询回调或托盘事件中发生死锁。
pub fn open_note_window(app: &AppHandle, id: &str, note: &Value) -> Result<(), String> {
    let label = note_label(id);
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    {
        let mut opening = OPENING_NOTE_WINDOWS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if opening.contains(&label) {
            return Ok(());
        }
        opening.push(label.clone());
    }
    let handle = app.clone();
    let note = note.clone();
    let id = id.to_string();
    let thread_label = label.clone();
    std::thread::Builder::new()
        .name(format!("dailyflow-note-{}", id))
        .spawn(move || {
            let _creation_guard = NoteWindowCreationGuard(thread_label);
            if let Err(error) = build_note_window(&handle, &id, &note) {
                eprintln!("创建便签窗口失败: {}", error);
            }
        })
        .map(|_| ())
        .map_err(|error| {
            release_note_window(&label);
            format!("启动便签窗口线程失败: {}", error)
        })
}

fn build_note_window(app: &AppHandle, id: &str, note: &Value) -> Result<(), String> {
    let label = note_label(id);
    // Another opener may have completed between the reservation and the worker thread.
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    let mut x = note["x"].as_i64().unwrap_or(1300) as i32;
    let mut y = note["y"].as_i64().unwrap_or(120) as i32;
    let w = note["w"]
        .as_f64()
        .filter(|value| value.is_finite())
        .unwrap_or(260.0)
        .clamp(180.0, 1200.0);
    let h = note["h"]
        .as_f64()
        .filter(|value| value.is_finite())
        .unwrap_or(220.0)
        .clamp(120.0, 1200.0);
    let monitors = app.available_monitors().unwrap_or_default();
    let saved_monitor = note["monitor"].as_str().unwrap_or("").trim();
    let monitor_matches_position = |monitor: &&tauri::Monitor| {
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        let origin = (
            (area.position.x as f64 / scale).round() as i32,
            (area.position.y as f64 / scale).round() as i32,
        );
        let width = area.size.width as f64 / scale;
        let height = area.size.height as f64 / scale;
        let x = x as f64;
        let y = y as f64;
        x >= origin.0 as f64
            && y >= origin.1 as f64
            && x < origin.0 as f64 + width
            && y < origin.1 as f64 + height
    };
    let primary = app.primary_monitor().ok().flatten();
    if let Some(monitor) = monitors
        .iter()
        .find(|monitor| !saved_monitor.is_empty() && monitor_key(monitor) == saved_monitor)
        .or_else(|| {
            primary
                .as_ref()
                .filter(|monitor| monitor_matches_position(monitor))
        })
        .or_else(|| monitors.iter().find(monitor_matches_position))
        .or_else(|| primary.as_ref())
        .or_else(|| monitors.first())
    {
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        let origin = (
            (area.position.x as f64 / scale).round() as i32,
            (area.position.y as f64 / scale).round() as i32,
        );
        (x, y) = clamp_position(
            x,
            y,
            w,
            h,
            origin,
            (area.size.width, area.size.height),
            scale,
        );
    }

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
            let should_show = match_want
                .map(|(_, n)| n["visible"].as_bool().unwrap_or(true))
                .unwrap_or(false);
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

#[cfg(test)]
mod tests {
    use super::clamp_position;

    #[test]
    fn clamps_scaled_window_in_logical_monitor_bounds() {
        assert_eq!(
            clamp_position(2000, 900, 260.0, 220.0, (0, 0), (1920, 1080), 1.5),
            (1020, 500)
        );
        assert_eq!(
            clamp_position(-3000, -500, 236.0, 300.0, (-1920, 0), (1920, 1080), 1.0),
            (-1920, 0)
        );
    }
}
