use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

pub fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let new_note = MenuItem::with_id(app, "new_note", "新建便签", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 DailyFlow", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &new_note, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("DailyFlow - AI 日程管理");
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.to_owned());
    }
    tray.build(app)?;

    // 菜单事件
    let handle = app.handle().clone();
    app.on_menu_event(move |_app, event| {
        on_tray_event(&handle, event.clone());
    });
    Ok(())
}

pub fn on_tray_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "show" => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }
        "new_note" => {
            let c = crate::domain::Ctx {
                store: crate::store::Store::new(crate::app_paths()),
            };
            let body = "（双击编辑内容）".to_string();
            if let Ok(v) = c.note_add(&body, "", "") {
                if let Some(note) = v["note"].as_object() {
                    let val = serde_json::Value::Object(note.clone());
                    let _ = crate::windows::open_note_window(app, &v["id"].as_str().unwrap_or(""), &val);
                }
            }
        }
        "quit" => {
            app.exit(0);
        }
        _ => {}
    }
}
