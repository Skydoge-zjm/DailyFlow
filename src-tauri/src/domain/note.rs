use super::*;

impl Ctx {
    pub fn note_add(&self, body: &str, title: &str, color: &str) -> CmdResult {
        if body.trim().is_empty() {
            return err("内容不能为空".into());
        }
        let color_s = normalize_color(color)?;
        let body = body.to_string();
        let title = title.to_string();
        self.store
            .with_lock(2000, move |d| {
                let idx = d.notes.len();
                let id = d.gen_unique_id("n");
                let (x, y) = crate::model::default_note_position(idx);
                let note = Note {
                    id: id.clone(),
                    title: title.trim().to_string(),
                    body,
                    color: color_s,
                    x,
                    y,
                    monitor: String::new(),
                    w: 260.0,
                    h: 220.0,
                    pinned: false,
                    visible: true,
                    created_at: now_iso(),
                    updated_at: now_iso(),
                };
                d.notes.push(note);
                let n = d.notes.last().unwrap().clone();
                Ok((id, n))
            })
            .map(|(id, n)| ok(json!({ "id": id, "note": n })))?
    }

    pub fn note_list(&self) -> CmdResult {
        let d = self.load()?;
        ok(json!({ "count": d.notes.len(), "notes": d.notes }))
    }

    pub fn note_edit(
        &self,
        id: &str,
        title: Option<&str>,
        body: Option<&str>,
        color: Option<&str>,
    ) -> CmdResult {
        let note = self.store.with_lock(2000, |d| {
            let n = d
                .note_mut(id)
                .ok_or_else(|| format!("便签不存在: {}", id))?;
            if let Some(v) = title {
                n.title = v.to_string();
            }
            if let Some(v) = body {
                n.body = v.to_string();
            }
            if let Some(v) = color {
                if !v.trim().is_empty() {
                    n.color = normalize_color(v)?;
                }
            }
            n.updated_at = now_iso();
            Ok(n.clone())
        })?;
        ok(json!(note))
    }

    pub fn note_delete(&self, id: &str) -> CmdResult {
        self.store.with_lock(2000, |d| {
            let deleted = d
                .note(id)
                .cloned()
                .ok_or_else(|| format!("便签不存在: {}", id))?;
            if d.notes.iter().filter(|note| note.id == id).count() > 1 {
                return Err(format!("便签 ID 重复，拒绝删除以免误删: {}", id));
            }
            let mut snapshot = self.snapshot_undo("删除便签");
            snapshot.deleted_notes.push(deleted);
            d.notes.retain(|n| n.id != id);
            d.undo = Some(snapshot);
            Ok(())
        })?;
        ok(json!({ "deleted": id }))
    }

    /// 撤销最近一次可撤销操作（删除任务/便签），恢复删除前的任务/便签集合。
    /// 单级撤销：执行后 undo 记录清空，连用两次第二次会报"没有可撤销的操作"。
    pub fn undo(&self, expected_ids: &[String]) -> CmdResult {
        let expected_ids = expected_ids.to_vec();
        let (label, ts) = self.store.with_lock(2000, |d| {
            let current = d
                .undo
                .as_ref()
                .ok_or_else(|| "没有可撤销的操作".to_string())?;
            if !expected_ids.is_empty() {
                let mut deleted_ids = current
                    .deleted_tasks
                    .iter()
                    .map(|task| task.id.clone())
                    .collect::<Vec<_>>();
                deleted_ids.extend(current.deleted_notes.iter().map(|note| note.id.clone()));
                deleted_ids.sort();
                let mut expected = expected_ids.clone();
                expected.sort();
                if deleted_ids != expected {
                    return Err("最近的删除操作已变化，未执行撤销".into());
                }
            }
            let u = d.undo.take().expect("undo entry checked above");
            let is_new_snapshot = !u.deleted_tasks.is_empty() || !u.deleted_notes.is_empty();
            if is_new_snapshot {
                for task in u.deleted_tasks {
                    if !d.tasks.iter().any(|current| current.id == task.id) {
                        d.tasks.push(task);
                    }
                }
                for note in u.deleted_notes {
                    if !d.notes.iter().any(|current| current.id == note.id) {
                        d.notes.push(note);
                    }
                }
            } else {
                // 兼容旧版本全量快照：只补回缺项，不覆盖后续编辑。
                for task in u.tasks {
                    if !d.tasks.iter().any(|current| current.id == task.id) {
                        d.tasks.push(task);
                    }
                }
                for note in u.notes {
                    if !d.notes.iter().any(|current| current.id == note.id) {
                        d.notes.push(note);
                    }
                }
            }
            Ok((u.label, u.ts))
        })?;
        ok(json!({ "undone": label, "ts": ts }))
    }

    pub fn note_show(&self, id: &str, show: bool) -> CmdResult {
        self.store.with_lock(2000, |d| {
            let n = d
                .note_mut(id)
                .ok_or_else(|| format!("便签不存在: {}", id))?;
            n.visible = show;
            n.updated_at = now_iso();
            Ok(())
        })?;
        ok(json!({ "id": id, "visible": show }))
    }

    pub fn note_pin(&self, id: &str, pin: bool) -> CmdResult {
        self.store.with_lock(2000, |d| {
            let n = d
                .note_mut(id)
                .ok_or_else(|| format!("便签不存在: {}", id))?;
            n.pinned = pin;
            n.updated_at = now_iso();
            Ok(())
        })?;
        ok(json!({ "id": id, "pinned": pin }))
    }

    // ---------- widget（今日悬浮窗） ----------

    pub fn widget_show(&self, visible: bool) -> CmdResult {
        self.store.with_lock(2000, |d| {
            d.settings.widget_visible = visible;
            Ok(())
        })?;
        ok(json!({ "widget_visible": visible }))
    }

    pub fn widget_pin(&self, pinned: bool) -> CmdResult {
        self.store.with_lock(2000, |d| {
            d.settings.widget_pinned = pinned;
            Ok(())
        })?;
        ok(json!({ "widget_pinned": pinned }))
    }
}
