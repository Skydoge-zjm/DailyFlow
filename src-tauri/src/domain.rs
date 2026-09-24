use serde_json::{json, Value};
use std::collections::HashMap;

use crate::model::{Data, Note, Priority, Quadrant, RepeatRule, Task, UndoEntry, NOTE_COLORS};
use crate::store::Store;
use crate::timeparse::{now_iso, parse_date, parse_time, today_str, weekday_cn};

pub struct Ctx {
    pub store: Store,
}

pub type CmdResult = Result<Value, String>;

#[derive(Default)]
pub struct TaskAddInput {
    pub title: String,
    pub date: String,
    pub start: String,
    pub end: String,
    pub priority: String,
    pub tags: String,
    pub notes: String,
    pub kind: String,
    pub quadrant: String,
    pub repeat: String,
    pub remind: Option<String>,
}

#[derive(Default)]
pub struct TaskEditPatch<'a> {
    pub title: Option<&'a str>,
    pub date: Option<&'a str>,
    pub start: Option<&'a str>,
    pub end: Option<&'a str>,
    pub priority: Option<&'a str>,
    pub tags: Option<&'a str>,
    pub notes: Option<&'a str>,
    pub kind: Option<&'a str>,
    pub quadrant: Option<&'a str>,
    pub repeat: Option<&'a str>,
    pub remind: Option<&'a str>,
}

fn ok(v: Value) -> CmdResult {
    Ok(json!({ "ok": true, "data": v }))
}

fn err<T>(msg: String) -> Result<T, String> {
    Err(msg)
}

impl Ctx {
    fn load(&self) -> Result<Data, String> {
        self.store.load()
    }
    /// 保存撤销快照：记录操作前 tasks/notes 全量（settings/undo 不含）
    fn snapshot_undo(&self, d: &Data, label: &str) -> UndoEntry {
        UndoEntry {
            ts: now_iso(),
            label: label.to_string(),
            tasks: d.tasks.clone(),
            notes: d.notes.clone(),
            deleted_tasks: Vec::new(),
            deleted_notes: Vec::new(),
        }
    }

    // ---------- tasks ----------

    pub fn task_add(&self, input: TaskAddInput) -> CmdResult {
        let TaskAddInput {
            title,
            date,
            start,
            end,
            priority,
            tags,
            notes,
            kind,
            quadrant,
            repeat,
            remind,
        } = input;
        if title.trim().is_empty() {
            return err("标题不能为空".into());
        }
        let kind_v = crate::model::TaskKind::parse(&kind)?;
        // goal 类型：date 可空（无目标日）；deadline/normal 缺省今天
        let date_s = if date.trim().is_empty() {
            match kind_v {
                crate::model::TaskKind::Goal => String::new(),
                _ => today_str(),
            }
        } else {
            parse_date(&date)?.format("%Y-%m-%d").to_string()
        };
        let start_s = parse_time(&start)?;
        let end_s = parse_time(&end)?;
        if !start_s.is_empty() && !end_s.is_empty() && end_s < start_s {
            return err(format!(
                "结束时间 ({}) 不能早于开始时间 ({})",
                end_s, start_s
            ));
        }
        let priority_v = parse_priority(&priority)?;
        let quadrant_v = Quadrant::parse(&quadrant)?;
        let repeat_v = RepeatRule::parse(&repeat)?;
        if kind_v == crate::model::TaskKind::Goal && repeat_v != RepeatRule::None {
            return err("长期目标不能设置重复规则".into());
        }
        let remind_at = match remind.as_deref() {
            Some(value) => parse_reminder(value)?,
            None => (!date_s.is_empty() && !start_s.is_empty()).then(|| start_s.clone()),
        };
        if date_s.is_empty() && remind_at.is_some() {
            return err("设置提醒需要任务日期".into());
        }
        let repeat_day = if repeat_v == RepeatRule::Monthly {
            Some(date_day(&date_s)?)
        } else {
            None
        };
        let tags_v = parse_tags(&tags);
        let notes_s = notes.trim().to_string();
        let title_s = title.trim().to_string();
        self.store
            .with_lock(2000, move |d| {
                let id = d.gen_unique_id("t");
                let task = Task {
                    id: id.clone(),
                    title: title_s,
                    notes: notes_s,
                    date: date_s.clone(),
                    start: if start_s.is_empty() {
                        None
                    } else {
                        Some(start_s)
                    },
                    end: if end_s.is_empty() { None } else { Some(end_s) },
                    done: false,
                    priority: priority_v,
                    kind: kind_v,
                    quadrant: quadrant_v,
                    repeat: repeat_v,
                    repeat_day,
                    repeat_parent_id: None,
                    remind_at,
                    reminded_at: None,
                    tags: tags_v,
                    created_at: now_iso(),
                    completed_at: None,
                };
                d.tasks.push(task);
                let t = d.tasks.last().unwrap().clone();
                Ok((id, t))
            })
            .map(|(id, t)| ok(json!({ "id": id, "task": t })))?
    }

    pub fn task_list(&self, scope: &str, tag: &str) -> CmdResult {
        let mut d = self.load()?;
        let today = today_str();
        let mut tasks: Vec<Task> = d.tasks.drain(..).collect();
        tasks.sort_by(|a, b| {
            a.date
                .cmp(&b.date)
                .then(
                    a.start
                        .clone()
                        .unwrap_or_else(|| "99:99".into())
                        .cmp(&b.start.clone().unwrap_or_else(|| "99:99".into())),
                )
                .then(a.id.cmp(&b.id))
        });
        let scope_raw = scope.trim().to_lowercase();
        // 空 scope = 默认 today（与文档一致）
        let scope = if scope_raw.is_empty() {
            "today".to_string()
        } else {
            scope_raw
        };
        let today_d = parse_date(if scope == "all" { "today" } else { &scope }).ok();
        tasks.retain(|t| {
            let scope_ok = match scope.as_str() {
                "all" => true,
                "today" => match t.kind {
                    crate::model::TaskKind::Goal => t.date == today, // goal 只在显式选中的日子出现
                    crate::model::TaskKind::Deadline => t.date == today && !t.done, // 截止日当天
                    crate::model::TaskKind::Normal => t.date == today,
                },
                "week" => {
                    // 未来 7 天（含今天）
                    let today_p = chrono::Local::now().date_naive();
                    let week_end = (today_p + chrono::Duration::days(6))
                        .format("%Y-%m-%d")
                        .to_string();
                    t.date >= today && t.date <= week_end
                }
                "overdue" => t.date < today && !t.done && t.kind != crate::model::TaskKind::Goal,
                "goal" | "goals" | "long" => t.kind == crate::model::TaskKind::Goal,
                "deadline" | "deadlines" => t.kind == crate::model::TaskKind::Deadline,
                "q1" | "q2" | "q3" | "q4" => t.quadrant.as_str() == scope,
                "open" => !t.done,
                _ => match today_d {
                    Some(pd) => t.date == pd.format("%Y-%m-%d").to_string(),
                    None => t.title.to_lowercase().contains(&scope.to_lowercase()),
                },
            };
            let tag_ok = tag.is_empty() || t.tags.iter().any(|x| x == tag);
            scope_ok && tag_ok
        });
        ok(json!({ "count": tasks.len(), "tasks": tasks }))
    }

    /// Return an Eisenhower matrix for a date, or all open tasks when `date` is `all`.
    pub fn matrix(&self, date: &str) -> CmdResult {
        let raw = date.trim();
        let date_s = if raw.eq_ignore_ascii_case("all") {
            None
        } else {
            Some(
                parse_date(if raw.is_empty() { "today" } else { raw })?
                    .format("%Y-%m-%d")
                    .to_string(),
            )
        };
        let tasks: Vec<Task> = self
            .load()?
            .tasks
            .into_iter()
            .filter(|task| !task.done)
            .filter(|task| {
                date_s
                    .as_deref()
                    .map(|date| task.date == date)
                    .unwrap_or(true)
            })
            .collect();
        let mut quadrants = serde_json::Map::new();
        for quadrant in ["q1", "q2", "q3", "q4"] {
            let items: Vec<Task> = tasks
                .iter()
                .filter(|task| task.quadrant.as_str() == quadrant)
                .cloned()
                .collect();
            quadrants.insert(quadrant.to_string(), json!(items));
        }
        ok(json!({
            "date": date_s,
            "total": tasks.len(),
            "quadrants": quadrants,
        }))
    }

    pub fn task_get(&self, id: &str) -> CmdResult {
        let d = self.load()?;
        match d.task(id) {
            Some(t) => ok(json!(t)),
            None => err(format!("任务不存在: {}", id)),
        }
    }

    pub fn task_edit(&self, id: &str, patch: TaskEditPatch<'_>) -> CmdResult {
        let TaskEditPatch {
            title,
            date,
            start,
            end,
            priority,
            tags,
            notes,
            kind,
            quadrant,
            repeat,
            remind,
        } = patch;
        let task = self.store.with_lock(2000, |d| {
            let t = d
                .task_mut(id)
                .ok_or_else(|| format!("任务不存在: {}", id))?;
            let old_start = t.start.clone();
            let old_date = t.date.clone();
            let old_reminder = t.remind_at.clone();
            if let Some(v) = title {
                if !v.trim().is_empty() {
                    t.title = v.trim().to_string();
                }
            }
            if let Some(v) = date {
                t.date = if v.trim().is_empty() {
                    String::new()
                } else {
                    parse_date(v)?.format("%Y-%m-%d").to_string()
                };
            }
            if let Some(v) = start {
                let parsed = parse_time(v)?;
                t.start = if parsed.is_empty() {
                    None
                } else {
                    Some(parsed)
                };
            }
            if let Some(v) = end {
                let parsed = parse_time(v)?;
                t.end = if parsed.is_empty() {
                    None
                } else {
                    Some(parsed)
                };
            }
            if let (Some(s), Some(e)) = (&t.start, &t.end) {
                if e < s {
                    return Err(format!("结束时间 ({}) 不能早于开始时间 ({})", e, s));
                }
            }
            if let Some(v) = priority {
                if !v.trim().is_empty() {
                    t.priority = parse_priority(v)?;
                }
            }
            if let Some(v) = kind {
                if !v.trim().is_empty() {
                    t.kind = crate::model::TaskKind::parse(v)?;
                    if t.date.is_empty() && t.kind != crate::model::TaskKind::Goal {
                        t.date = today_str();
                    }
                }
            }
            if let Some(v) = quadrant {
                t.quadrant = Quadrant::parse(v)?;
            }
            if date.is_some() && t.date.is_empty() && t.kind != crate::model::TaskKind::Goal {
                return Err("只有长期目标可以清空日期".into());
            }
            if let Some(value) = repeat {
                t.repeat = RepeatRule::parse(value)?;
            }
            if t.kind == crate::model::TaskKind::Goal && t.repeat != RepeatRule::None {
                return Err("长期目标不能设置重复规则".into());
            }
            t.repeat_day = if t.repeat == RepeatRule::Monthly {
                if repeat.is_some() || old_date != t.date || t.repeat_day.is_none() {
                    Some(date_day(&t.date)?)
                } else {
                    t.repeat_day
                }
            } else {
                None
            };
            if let Some(value) = remind {
                t.remind_at = parse_reminder(value)?;
            } else if start.is_some()
                && !t.date.is_empty()
                && (old_reminder == old_start && old_start.is_some()
                    || old_reminder.is_none() && old_start.is_none())
            {
                t.remind_at = t.start.clone();
            }
            if t.date.is_empty() && t.remind_at.is_some() {
                return Err("设置提醒需要任务日期".into());
            }
            if t.date != old_date || t.remind_at != old_reminder {
                t.reminded_at = None;
            }
            if let Some(v) = tags {
                t.tags = parse_tags(v);
            }
            if let Some(v) = notes {
                t.notes = v.to_string();
            }
            t.completed_at = if t.done {
                Some(t.completed_at.clone().unwrap_or_else(now_iso))
            } else {
                None
            };
            Ok(t.clone())
        })?;
        ok(json!(task))
    }

    pub fn task_set_done(&self, id: &str, done: bool) -> CmdResult {
        self.set_task_done(id, Some(done))
    }

    pub fn task_toggle(&self, id: &str) -> CmdResult {
        self.set_task_done(id, None)
    }

    fn set_task_done(&self, id: &str, requested: Option<bool>) -> CmdResult {
        let task = self.store.with_lock(2000, |d| {
            let index = d
                .tasks
                .iter()
                .position(|t| t.id == id)
                .ok_or_else(|| format!("任务不存在: {}", id))?;
            let done = requested.unwrap_or(!d.tasks[index].done);
            let newly_done = done && !d.tasks[index].done;
            let previous = d.tasks[index].clone();
            let generated_date = if previous.done && !done && previous.repeat != RepeatRule::None {
                previous
                    .completed_at
                    .as_deref()
                    .and_then(|timestamp| timestamp.get(..10))
                    .and_then(|date| chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
                    .and_then(|date| next_repeat_date(&previous, date).ok())
            } else {
                None
            };
            d.tasks[index].done = done;
            d.tasks[index].completed_at = if done {
                Some(d.tasks[index].completed_at.clone().unwrap_or_else(now_iso))
            } else {
                None
            };
            let task = d.tasks[index].clone();
            if let Some(date) = generated_date {
                d.tasks
                    .retain(|child| !is_untouched_repeat_child(child, &previous, &date));
            }
            if newly_done
                && task.repeat != RepeatRule::None
                && !d
                    .tasks
                    .iter()
                    .any(|t| t.repeat_parent_id.as_deref() == Some(id))
            {
                let mut child = task.clone();
                child.id = d.gen_unique_id("t");
                child.date = next_repeat_date(&task, chrono::Local::now().date_naive())?;
                child.done = false;
                child.created_at = task.completed_at.clone().unwrap_or_else(now_iso);
                child.completed_at = None;
                child.reminded_at = None;
                child.repeat_parent_id = Some(task.id.clone());
                d.tasks.push(child);
            }
            Ok(task)
        })?;
        ok(json!(task))
    }

    pub fn task_delete(&self, id: &str) -> CmdResult {
        self.store.with_lock(2000, |d| {
            let mut matches = d.tasks.iter().filter(|task| task.id == id);
            let deleted = matches
                .next()
                .cloned()
                .ok_or_else(|| format!("任务不存在: {}", id))?;
            if matches.next().is_some() {
                return Err(format!("任务 ID 重复，拒绝删除以免误删: {}", id));
            }
            let mut snapshot = self.snapshot_undo(d, "删除任务");
            snapshot.deleted_tasks.push(deleted);
            d.tasks.retain(|t| t.id != id);
            d.undo = Some(snapshot);
            Ok(())
        })?;
        ok(json!({ "deleted": id }))
    }

    pub fn task_move(&self, id: &str, date: &str) -> CmdResult {
        self.task_edit(
            id,
            TaskEditPatch {
                date: Some(date),
                ..TaskEditPatch::default()
            },
        )
    }

    pub fn due_reminders(&self) -> Result<Vec<Task>, String> {
        let now = chrono::Local::now();
        let date = now.format("%Y-%m-%d").to_string();
        let time = now.format("%H:%M").to_string();
        let due = |task: &Task| {
            !task.done
                && task.date == date
                && task.reminded_at.is_none()
                && task
                    .remind_at
                    .as_deref()
                    .is_some_and(|at| at <= time.as_str())
        };
        Ok(self.load()?.tasks.into_iter().filter(due).collect())
    }

    pub fn mark_reminded(&self, task: &Task) -> Result<(), String> {
        self.store.with_lock(2000, |data| {
            let current = data
                .task_mut(&task.id)
                .ok_or_else(|| format!("任务不存在: {}", task.id))?;
            if !current.done
                && current.date == task.date
                && current.remind_at == task.remind_at
                && current.reminded_at.is_none()
            {
                current.reminded_at = Some(now_iso());
            }
            Ok(())
        })
    }

    pub fn task_clear_done(&self, date: &str) -> CmdResult {
        let date_s = if date.trim().is_empty() {
            None
        } else {
            Some(parse_date(date)?.format("%Y-%m-%d").to_string())
        };
        let removed = self.store.with_lock(2000, |d| {
            let deleted: Vec<Task> = d
                .tasks
                .iter()
                .filter(|t| {
                    t.done
                        && t.kind != crate::model::TaskKind::Goal
                        && date_s.as_deref().map(|x| t.date == x).unwrap_or(true)
                })
                .cloned()
                .collect();
            let mut id_counts = HashMap::new();
            for task in &d.tasks {
                *id_counts.entry(task.id.as_str()).or_insert(0usize) += 1;
            }
            if let Some(task) = deleted
                .iter()
                .find(|task| id_counts.get(task.id.as_str()).copied().unwrap_or(0) > 1)
            {
                return Err(format!(
                    "任务 ID 重复，拒绝清理以免无法完整撤销: {}",
                    task.id
                ));
            }
            let deleted_ids = deleted
                .iter()
                .map(|task| task.id.clone())
                .collect::<Vec<_>>();
            let removed = deleted.len();
            if removed > 0 {
                let mut snapshot = self.snapshot_undo(d, "清理已完成任务");
                snapshot.deleted_tasks = deleted;
                d.tasks.retain(|t| {
                    !(t.done
                        && t.kind != crate::model::TaskKind::Goal
                        && date_s.as_deref().map(|x| t.date == x).unwrap_or(true))
                });
                d.undo = Some(snapshot);
            }
            Ok((removed, deleted_ids))
        })?;
        ok(json!({ "removed": removed.0, "deleted_ids": removed.1 }))
    }

    // ---------- notes ----------

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
            let mut snapshot = self.snapshot_undo(d, "删除便签");
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

    pub fn day(&self, date: &str) -> CmdResult {
        let pd = parse_date(if date.trim().is_empty() {
            "today"
        } else {
            date
        })?;
        let date_s = pd.format("%Y-%m-%d").to_string();
        let d = self.load()?;
        // 当天任务 + 需要关注的其他类型（进行中的长期目标 / 即将到期的截止任务）
        let mut tasks: Vec<&Task> = d.tasks.iter().filter(|t| t.date == date_s).collect();
        let goals: Vec<&Task> = d
            .tasks
            .iter()
            .filter(|t| t.kind == crate::model::TaskKind::Goal && !t.done && t.date != date_s)
            .collect();
        let total = tasks.len();
        let done = tasks.iter().filter(|t| t.done).count();
        let goals_open = goals.len();
        tasks.extend(goals);
        ok(json!({
            "date": date_s,
            "weekday": weekday_cn(pd),
            "total": total,
            "done": done,
            "pending": total - done,
            "goals_open": goals_open,
            "tasks": tasks,
        }))
    }

    pub fn stats(&self, date: &str) -> CmdResult {
        let d = self.load()?;
        let today = today_str();
        let total_all = d.tasks.len();
        let done_all = d.tasks.iter().filter(|t| t.done).count();
        let overdue = d
            .tasks
            .iter()
            .filter(|t| {
                !t.done
                    && t.date < today
                    && !t.date.is_empty()
                    && t.kind != crate::model::TaskKind::Goal
            })
            .count();
        let goals_open = d
            .tasks
            .iter()
            .filter(|t| t.kind == crate::model::TaskKind::Goal && !t.done)
            .count();
        let deadlines_open = d
            .tasks
            .iter()
            .filter(|t| t.kind == crate::model::TaskKind::Deadline && !t.done)
            .count();
        let date_summary = if date.trim().is_empty() {
            None
        } else {
            let parsed = parse_date(date)?;
            let date_text = parsed.format("%Y-%m-%d").to_string();
            let tasks: Vec<&Task> = d.tasks.iter().filter(|t| t.date == date_text).collect();
            Some(json!({
                "date": date_text,
                "total": tasks.len(),
                "done": tasks.iter().filter(|t| t.done).count(),
            }))
        };
        ok(json!({
            "tasks_total": total_all,
            "tasks_done": done_all,
            "tasks_open": total_all - done_all,
            "overdue": overdue,
            "goals_open": goals_open,
            "deadlines_open": deadlines_open,
            "date": date_summary,
            "notes": d.notes.len(),
        }))
    }

    pub fn dump(&self) -> CmdResult {
        ok(json!(self.load()?))
    }
}

fn parse_reminder(value: &str) -> Result<Option<String>, String> {
    if matches!(value.trim().to_lowercase().as_str(), "" | "off" | "none") {
        return Ok(None);
    }
    let time = parse_time(value)?;
    if time.is_empty() {
        return Err("无效提醒时间".into());
    }
    Ok(Some(time))
}

fn date_day(date: &str) -> Result<u32, String> {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|date| chrono::Datelike::day(&date))
        .map_err(|_| format!("无效日期: {}", date))
}

fn next_repeat_date(task: &Task, reference: chrono::NaiveDate) -> Result<String, String> {
    use chrono::{Datelike, Duration, NaiveDate};

    let current = NaiveDate::parse_from_str(&task.date, "%Y-%m-%d")
        .map_err(|_| format!("重复任务日期无效: {}", task.date))?;
    let threshold = current.max(reference);
    let next = match task.repeat {
        RepeatRule::Daily => threshold.checked_add_signed(Duration::days(1)),
        RepeatRule::Weekly => {
            let weeks = (threshold - current).num_days() / 7 + 1;
            current.checked_add_signed(Duration::days(weeks * 7))
        }
        RepeatRule::Monthly => {
            let anchor = task
                .repeat_day
                .filter(|day| (1..=31).contains(day))
                .unwrap_or(current.day());
            let mut year = current.year();
            let mut month = current.month();
            loop {
                if month == 12 {
                    year += 1;
                    month = 1;
                } else {
                    month += 1;
                }
                let next_month = if month == 12 {
                    NaiveDate::from_ymd_opt(year + 1, 1, 1)
                } else {
                    NaiveDate::from_ymd_opt(year, month + 1, 1)
                };
                let Some(last) =
                    next_month.and_then(|first| first.checked_sub_signed(Duration::days(1)))
                else {
                    break None;
                };
                let candidate = NaiveDate::from_ymd_opt(year, month, anchor.min(last.day()));
                if candidate.is_some_and(|date| date > threshold) {
                    break candidate;
                }
            }
        }
        RepeatRule::None => return Err("任务没有重复规则".into()),
    };
    next.map(|date| date.format("%Y-%m-%d").to_string())
        .ok_or_else(|| "重复任务的下一日期超出支持范围".into())
}

fn is_untouched_repeat_child(child: &Task, parent: &Task, generated_date: &str) -> bool {
    child.repeat_parent_id.as_deref() == Some(parent.id.as_str())
        && child.date == generated_date
        && child.created_at == parent.completed_at.as_deref().unwrap_or("")
        && !child.done
        && child.completed_at.is_none()
        && child.reminded_at.is_none()
        && child.title == parent.title
        && child.notes == parent.notes
        && child.start == parent.start
        && child.end == parent.end
        && child.kind == parent.kind
        && child.quadrant == parent.quadrant
        && child.priority == parent.priority
        && child.repeat == parent.repeat
        && child.repeat_day == parent.repeat_day
        && child.remind_at == parent.remind_at
        && child.tags == parent.tags
}

fn parse_priority(s: &str) -> Result<Priority, String> {
    match s.trim().to_lowercase().as_str() {
        "" | "normal" | "mid" | "中" => Ok(Priority::Normal),
        "low" | "低" => Ok(Priority::Low),
        "high" | "urgent" | "高" => Ok(Priority::High),
        other => err(format!("无效优先级: {} (可选 low/normal/high)", other)),
    }
}

fn parse_tags(s: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    s.split(&[',', '，'][..])
        .map(|x| x.trim().trim_start_matches('#').to_string())
        .filter(|x| !x.is_empty() && seen.insert(x.clone()))
        .collect()
}

fn normalize_color(c: &str) -> Result<String, String> {
    let s = c.trim().to_lowercase();
    if s.is_empty() {
        return Ok("yellow".to_string()); // 缺省黄色便签（note add 不带 --color、托盘新建都走这里）
    }
    if NOTE_COLORS.contains(&s.as_str()) {
        Ok(s)
    } else {
        err(format!("无效颜色: {} (可选 {})", c, NOTE_COLORS.join("/")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Data, Priority, Task, TaskKind};
    use std::path::PathBuf;

    fn temp_dir(label: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "dailyflow-{}-{}-{}",
            label,
            std::process::id(),
            nonce
        ))
    }

    fn task(id: &str, title: &str, done: bool, kind: TaskKind) -> Task {
        Task {
            id: id.into(),
            title: title.into(),
            notes: String::new(),
            date: "2026-09-23".into(),
            start: None,
            end: None,
            done,
            priority: Priority::Normal,
            kind,
            quadrant: Quadrant::Q2,
            repeat: RepeatRule::None,
            repeat_day: None,
            repeat_parent_id: None,
            remind_at: None,
            reminded_at: None,
            tags: Vec::new(),
            created_at: String::new(),
            completed_at: None,
        }
    }

    fn context(path: PathBuf) -> Ctx {
        Ctx {
            store: Store::new(path),
        }
    }

    #[test]
    fn undo_delete_restores_only_deleted_item_and_keeps_later_edits() {
        let dir = temp_dir("undo");
        let ctx = context(dir.clone());
        let mut data = Data::default();
        data.tasks
            .push(task("t_deleted", "deleted", false, TaskKind::Normal));
        data.tasks
            .push(task("t_kept", "keep me", false, TaskKind::Normal));
        ctx.store.save(&data).unwrap();

        ctx.task_delete("t_deleted").unwrap();
        ctx.task_edit(
            "t_kept",
            TaskEditPatch {
                title: Some("edited after delete"),
                ..TaskEditPatch::default()
            },
        )
        .unwrap();
        ctx.undo(&[]).unwrap();

        let restored = ctx.store.load().unwrap();
        assert_eq!(restored.tasks.len(), 2);
        assert_eq!(restored.task("t_deleted").unwrap().title, "deleted");
        assert_eq!(
            restored.task("t_kept").unwrap().title,
            "edited after delete"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn clear_done_is_undoable_and_keeps_completed_goals() {
        let dir = temp_dir("clear-done");
        let ctx = context(dir.clone());
        let mut data = Data::default();
        data.tasks
            .push(task("t_done", "done", true, TaskKind::Normal));
        data.tasks
            .push(task("t_goal", "goal", true, TaskKind::Goal));
        ctx.store.save(&data).unwrap();

        let result = ctx.task_clear_done("").unwrap();
        assert_eq!(result["data"]["removed"], 1);
        assert!(ctx.store.load().unwrap().task("t_done").is_none());
        assert!(ctx.store.load().unwrap().task("t_goal").is_some());
        ctx.undo(&[]).unwrap();
        assert!(ctx.store.load().unwrap().task("t_done").is_some());
        assert!(ctx.store.load().unwrap().task("t_goal").is_some());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn explicit_undo_refuses_a_different_delete() {
        let dir = temp_dir("scoped-undo");
        let ctx = context(dir.clone());
        let mut data = Data::default();
        data.tasks
            .push(task("t_first", "first", false, TaskKind::Normal));
        data.tasks
            .push(task("t_second", "second", false, TaskKind::Normal));
        ctx.store.save(&data).unwrap();

        ctx.task_delete("t_first").unwrap();
        ctx.task_delete("t_second").unwrap();
        assert!(ctx.undo(&["t_first".to_string()]).is_err());
        assert!(ctx.store.load().unwrap().task("t_second").is_none());
        ctx.undo(&["t_second".to_string()]).unwrap();
        assert!(ctx.store.load().unwrap().task("t_second").is_some());
        assert!(ctx.store.load().unwrap().task("t_first").is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn normal_task_cannot_be_left_without_a_date() {
        let dir = temp_dir("empty-date");
        let ctx = context(dir.clone());
        let mut data = Data::default();
        data.tasks
            .push(task("t_normal", "normal", false, TaskKind::Normal));
        ctx.store.save(&data).unwrap();

        assert!(ctx
            .task_edit(
                "t_normal",
                TaskEditPatch {
                    date: Some(""),
                    ..TaskEditPatch::default()
                },
            )
            .is_err());
        assert_eq!(
            ctx.store.load().unwrap().task("t_normal").unwrap().date,
            "2026-09-23"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn concurrent_task_toggles_are_atomic() {
        let dir = temp_dir("toggle");
        let ctx = context(dir.clone());
        let mut data = Data::default();
        data.tasks
            .push(task("t_toggle", "toggle", false, TaskKind::Normal));
        ctx.store.save(&data).unwrap();

        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let mut threads = Vec::new();
        for _ in 0..2 {
            let path = dir.clone();
            let barrier = barrier.clone();
            threads.push(std::thread::spawn(move || {
                let ctx = context(path);
                barrier.wait();
                ctx.task_toggle("t_toggle").unwrap();
            }));
        }
        for thread in threads {
            thread.join().unwrap();
        }

        assert!(!ctx.store.load().unwrap().task("t_toggle").unwrap().done);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn monthly_repeat_keeps_its_original_day_after_short_months() {
        let mut item = task("t_monthly", "monthly", false, TaskKind::Normal);
        item.repeat = RepeatRule::Monthly;
        item.repeat_day = Some(31);
        item.date = "2099-01-31".into();
        assert_eq!(
            next_repeat_date(&item, chrono::NaiveDate::from_ymd_opt(2099, 1, 31).unwrap()).unwrap(),
            "2099-02-28"
        );
        item.date = "2099-02-28".into();
        assert_eq!(
            next_repeat_date(&item, chrono::NaiveDate::from_ymd_opt(2099, 2, 28).unwrap()).unwrap(),
            "2099-03-31"
        );
    }

    #[test]
    fn completing_repeat_creates_only_one_following_task() {
        let dir = temp_dir("repeat");
        let ctx = context(dir.clone());
        let added = ctx
            .task_add(TaskAddInput {
                title: "晨间复盘".into(),
                date: "today".into(),
                start: "09:00".into(),
                kind: "normal".into(),
                quadrant: "q2".into(),
                repeat: "daily".into(),
                ..TaskAddInput::default()
            })
            .unwrap();
        let id = added["data"]["id"].as_str().unwrap();
        ctx.task_set_done(id, true).unwrap();
        ctx.task_set_done(id, true).unwrap();
        let data = ctx.store.load().unwrap();
        assert_eq!(data.tasks.len(), 2);
        let next = data
            .tasks
            .iter()
            .find(|task| task.repeat_parent_id.as_deref() == Some(id))
            .unwrap();
        assert_eq!(
            next.date,
            (chrono::Local::now().date_naive() + chrono::Duration::days(1))
                .format("%Y-%m-%d")
                .to_string()
        );
        assert_eq!(next.remind_at.as_deref(), Some("09:00"));
        assert!(next.reminded_at.is_none());
        ctx.task_set_done(id, false).unwrap();
        assert_eq!(ctx.store.load().unwrap().tasks.len(), 1);
        ctx.task_set_done(id, true).unwrap();
        let data = ctx.store.load().unwrap();
        let child_id = data
            .tasks
            .iter()
            .find(|task| task.repeat_parent_id.as_deref() == Some(id))
            .unwrap()
            .id
            .clone();
        ctx.task_edit(
            &child_id,
            TaskEditPatch {
                title: Some("改过的下一次"),
                ..TaskEditPatch::default()
            },
        )
        .unwrap();
        ctx.task_set_done(id, false).unwrap();
        assert_eq!(ctx.store.load().unwrap().tasks.len(), 2);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reminder_is_recorded_once_and_rearmed_after_rescheduling() {
        let dir = temp_dir("reminder");
        let ctx = context(dir.clone());
        let added = ctx
            .task_add(TaskAddInput {
                title: "喝水".into(),
                date: "today".into(),
                kind: "normal".into(),
                quadrant: "q2".into(),
                remind: Some("00:00".into()),
                ..TaskAddInput::default()
            })
            .unwrap();
        let id = added["data"]["id"].as_str().unwrap();
        let due = ctx.due_reminders().unwrap();
        assert_eq!(due.len(), 1);
        ctx.mark_reminded(&due[0]).unwrap();
        assert!(ctx.due_reminders().unwrap().is_empty());
        ctx.task_edit(
            id,
            TaskEditPatch {
                date: Some("tomorrow"),
                ..TaskEditPatch::default()
            },
        )
        .unwrap();
        assert!(ctx
            .store
            .load()
            .unwrap()
            .task(id)
            .unwrap()
            .reminded_at
            .is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn start_edit_moves_default_reminder_but_preserves_disabled_reminder() {
        let dir = temp_dir("reminder-edit");
        let ctx = context(dir.clone());
        let added = ctx
            .task_add(TaskAddInput {
                title: "会议".into(),
                date: "today".into(),
                start: "09:00".into(),
                kind: "normal".into(),
                quadrant: "q2".into(),
                ..TaskAddInput::default()
            })
            .unwrap();
        let id = added["data"]["id"].as_str().unwrap();
        ctx.task_edit(
            id,
            TaskEditPatch {
                start: Some("10:00"),
                ..TaskEditPatch::default()
            },
        )
        .unwrap();
        assert_eq!(
            ctx.store
                .load()
                .unwrap()
                .task(id)
                .unwrap()
                .remind_at
                .as_deref(),
            Some("10:00")
        );
        ctx.task_edit(
            id,
            TaskEditPatch {
                remind: Some("off"),
                ..TaskEditPatch::default()
            },
        )
        .unwrap();
        ctx.task_edit(
            id,
            TaskEditPatch {
                start: Some("11:00"),
                ..TaskEditPatch::default()
            },
        )
        .unwrap();
        assert!(ctx
            .store
            .load()
            .unwrap()
            .task(id)
            .unwrap()
            .remind_at
            .is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn matrix_groups_open_tasks_and_task_list_filters_quadrants() {
        let dir = temp_dir("matrix");
        let ctx = context(dir.clone());
        ctx.task_add(TaskAddInput {
            title: "马上处理".into(),
            date: "today".into(),
            kind: "normal".into(),
            quadrant: "q1".into(),
            ..TaskAddInput::default()
        })
        .unwrap();
        ctx.task_add(TaskAddInput {
            title: "留出时间".into(),
            date: "today".into(),
            kind: "normal".into(),
            quadrant: "q2".into(),
            ..TaskAddInput::default()
        })
        .unwrap();
        let q1 = ctx.task_list("q1", "").unwrap();
        assert_eq!(q1["data"]["count"], 1);
        let matrix = ctx.matrix("today").unwrap();
        assert_eq!(matrix["data"]["total"], 2);
        assert_eq!(
            matrix["data"]["quadrants"]["q1"].as_array().unwrap().len(),
            1
        );
        assert_eq!(
            matrix["data"]["quadrants"]["q2"].as_array().unwrap().len(),
            1
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
