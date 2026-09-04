use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

pub fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{PredefinedMenuItem, Submenu};
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let widget = MenuItem::with_id(app, "widget", "显示 / 隐藏今日悬浮窗", true, None::<&str>)?;
    let new_note = MenuItem::with_id(app, "new_note", "新建便签", true, None::<&str>)?;

    // 便签子菜单：显示/隐藏全部 + 各便签单独开关
    let note_all_show = MenuItem::with_id(app, "note_all_show", "显示全部便签", true, None::<&str>)?;
    let note_all_hide = MenuItem::with_id(app, "note_all_hide", "隐藏全部便签", true, None::<&str>)?;
    let submenu_items: Vec<&dyn tauri::menu::IsMenuItem<_>> =
        vec![&note_all_show, &note_all_hide];
    let note_menu = Submenu::with_id_and_items(app, "notes-sub", "便签", true, &submenu_items)?;

    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出 DailyFlow", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &sep1, &widget, &note_menu, &new_note, &sep2, &quit])?;

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
        "widget" => {
            let c = crate::domain::Ctx {
                store: crate::store::Store::new(crate::app_paths()),
            };
            let visible = c.store.load().settings.widget_visible;
            let _ = c.widget_show(!visible);
            if !visible {
                let _ = crate::windows::open_widget_window(app);
            } else {
                crate::windows::close_widget_window(app);
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
        "note_all_show" | "note_all_hide" => {
            let show = event.id().as_ref() == "note_all_show";
            let c = crate::domain::Ctx {
                store: crate::store::Store::new(crate::app_paths()),
            };
            let mut d = c.store.load();
            for n in &mut d.notes {
                n.visible = show;
                n.updated_at = crate::timeparse::now_iso();
            }
            let _ = c.store.save(&d);
            let v = serde_json::to_value(&d).unwrap_or(serde_json::json!({}));
            use tauri::Emitter;
            let _ = app.emit("data-changed", &v);
            crate::windows::sync_note_windows(app, &v);
        }
        "quit" => {
            app.exit(0);
        }
        _ => {}
    }
}
