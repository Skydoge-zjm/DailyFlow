use super::*;

impl Ctx {
    pub fn widget_set_pos(&self, x: i32, y: i32, w: i32, h: i32, monitor: &str) -> CmdResult {
        self.store.with_lock(2000, |d| {
            d.settings.widget_x = x;
            d.settings.widget_y = y;
            d.settings.widget_w = w.clamp(200, 1200);
            d.settings.widget_h = h.clamp(180, 1200);
            d.settings.widget_monitor = monitor.trim().to_string();
            Ok(())
        })?;
        ok(json!({
            "widget_x": x,
            "widget_y": y,
            "widget_w": w.clamp(200, 1200),
            "widget_h": h.clamp(180, 1200),
            "widget_monitor": monitor.trim(),
        }))
    }

    // ---------- theme（主题与外观） ----------

    pub fn theme_set(&self, preset: &str, light: bool, overrides_json: &str) -> CmdResult {
        let settings = self.store.with_lock(2000, |d| {
            if !preset.trim().is_empty() {
                let p = preset.trim().to_lowercase();
                if crate::model::THEME_PRESETS.contains(&p.as_str()) {
                    d.settings.theme_preset = p;
                } else {
                    return Err(format!(
                        "无效主题: {} (可选 {})",
                        preset,
                        crate::model::THEME_PRESETS.join("/")
                    ));
                }
            }
            // overrides_json 可带 light:/dark: 前缀，用于明确设置明暗模式。
            if !overrides_json.trim().is_empty() {
                let (mode, json_part) = match overrides_json.split_once(':') {
                    Some((m @ ("light" | "dark"), rest)) => (Some(m), rest),
                    _ => (None, overrides_json),
                };
                if let Some("light") = mode {
                    d.settings.theme = crate::model::Theme::Light;
                }
                if let Some("dark") = mode {
                    d.settings.theme = crate::model::Theme::Dark;
                }
                if !json_part.trim().is_empty() {
                    let parsed: std::collections::BTreeMap<String, String> =
                        serde_json::from_str(json_part).map_err(|e| {
                            format!(
                            "overrides JSON 解析失败: {}（应为 CSS 变量名到颜色值的 JSON 映射）",
                            e
                        )
                        })?;
                    crate::model::validate_theme_overrides(&parsed)?;
                    d.settings.theme_overrides = parsed;
                }
            }
            if light {
                d.settings.theme = crate::model::Theme::Light;
            }
            Ok((
                d.settings.theme.clone(),
                d.settings.theme_preset.clone(),
                d.settings.theme_overrides.clone(),
            ))
        })?;
        ok(json!({
            "theme": settings.0,
            "theme_preset": settings.1,
            "theme_overrides": settings.2,
        }))
    }

    // ---------- aggregates ----------
}
