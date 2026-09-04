use serde_json::{json, Value};

use crate::model::{Data, Note, Priority, Task, NOTE_COLORS};
use crate::store::Store;
use crate::timeparse::{now_iso, parse_date, parse_time, today_str, weekday_cn};

pub struct Ctx {
    pub store: Store,
}

pub type CmdResult = Result<Value, String>;

fn ok(v: Value) -> CmdResult {
    Ok(json!({ "ok": true, "data": v }))
}

fn err<T>(msg: String) -> Result<T, String> {
    Err(msg)
}

impl Ctx {
    fn load(&self) -> Data {
        self.store.load()
    }
    fn save(&self, d: &Data) -> CmdResult {
        self.store
            .save(d)
            .map_err(|e| format!("保存失败: {}", e))?;
        Ok(json!({}))
    }

    // ---------- tasks ----------

    #[allow(clippy::too_many_arguments)]
    pub fn task_add(
        &self,
        title: &str,
        date: &str,
        start: &str,
        end: &str,
        priority: &str,
        tags: &str,
        notes: &str,
        kind: &str,
    ) -> CmdResult {
        if title.trim().is_empty() {
            return err("标题不能为空".into());
        }
        let kind_v = crate::model::TaskKind::parse(kind)?;
        // goal 类型：date 可空（无目标日）；deadline/normal 缺省今天
        let date_s = if date.trim().is_empty() {
            match kind_v {
                crate::model::TaskKind::Goal => String::new(),
                _ => today_str(),
            }
        } else {
            parse_date(date)?.format("%Y-%m-%d").to_string()
        };
        let start_s = parse_time(start)?;
        let end_s = parse_time(end)?;
        let mut d = self.load();
        let id = Data::gen_id("t");
        let task = Task {
            id: id.clone(),
            title: title.trim().to_string(),
            notes: notes.trim().to_string(),
            date: date_s.clone(),
            start: if start_s.is_empty() { None } else { Some(start_s) },
            end: if end_s.is_empty() { None } else { Some(end_s) },
            done: false,
            priority: parse_priority(priority)?,
            kind: kind_v,
            tags: parse_tags(tags),
            created_at: now_iso(),
            completed_at: None,
        };
        d.tasks.push(task);
        self.save(&d)?;
        let t = d.tasks.last().unwrap().clone();
        ok(json!({ "id": id, "task": t }))
    }

    pub fn task_list(&self, scope: &str, tag: &str) -> CmdResult {
        let mut d = self.load();
        let today = today_str();
        let mut tasks: Vec<Task> = d.tasks.drain(..).collect();
        tasks.sort_by(|a, b| {
            b.date.cmp(&a.date) // 倒序日期无意义，改升序
        });
        tasks.sort_by(|a, b| {
            a.date
                .cmp(&b.date)
                .then(a.start.clone().unwrap_or_else(|| "99:99".into()).cmp(&b.start.clone().unwrap_or_else(|| "99:99".into())))
                .then(a.id.cmp(&b.id))
        });
        let scope = scope.trim().to_lowercase();
        let today_d = parse_date(if scope.is_empty() { "all" } else { &scope }).ok();
        tasks.retain(|t| {
            let scope_ok = match scope.as_str() {
                "" | "all" => true,
                "today" => match t.kind {
                    crate::model::TaskKind::Goal => t.date == today, // goal 只在显式选中的日子出现
                    crate::model::TaskKind::Deadline => t.date == today && !t.done, // 截止日当天
                    crate::model::TaskKind::Normal => t.date == today,
                },
                "week" => {
                    // 未来 7 天（含今天）
                    let today_p = chrono::Local::now().date_naive();
                    let week_end = (today_p + chrono::Duration::days(6)).format("%Y-%m-%d").to_string();
                    t.date >= today && t.date <= week_end
                }
                "overdue" => t.date < today && !t.done && t.kind != crate::model::TaskKind::Goal,
                "goal" | "goals" | "long" => t.kind == crate::model::TaskKind::Goal,
                "deadline" | "deadlines" => t.kind == crate::model::TaskKind::Deadline,
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

    pub fn task_get(&self, id: &str) -> CmdResult {
        let d = self.load();
        match d.task(id) {
            Some(t) => ok(json!(t)),
            None => err(format!("任务不存在: {}", id)),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn task_edit(
        &self,
        id: &str,
        title: Option<&str>,
        date: Option<&str>,
        start: Option<&str>,
        end: Option<&str>,
        priority: Option<&str>,
        tags: Option<&str>,
        notes: Option<&str>,
        kind: Option<&str>,
    ) -> CmdResult {
        let mut d = self.load();
        {
            let t = d
                .task_mut(id)
                .ok_or_else(|| format!("任务不存在: {}", id))?;
            if let Some(v) = title {
                if !v.trim().is_empty() {
                    t.title = v.trim().to_string();
                }
            }
            if let Some(v) = date {
                if v.trim().is_empty() {
                    // 允许清空日期（goal 无目标日）
                    t.date = String::new();
                } else {
                    t.date = parse_date(v)?.format("%Y-%m-%d").to_string();
                }
            }
            if let Some(v) = start {
                let s = parse_time(v)?;
                t.start = if s.is_empty() { None } else { Some(s) };
            }
            if let Some(v) = end {
                let s = parse_time(v)?;
                t.end = if s.is_empty() { None } else { Some(s) };
            }
            if let Some(v) = priority {
                if !v.trim().is_empty() {
                    t.priority = parse_priority(v)?;
                }
            }
            if let Some(v) = kind {
                if !v.trim().is_empty() {
                    t.kind = crate::model::TaskKind::parse(v)?;
                }
            }
            if let Some(v) = tags {
                t.tags = parse_tags(v);
            }
            if let Some(v) = notes {
                t.notes = v.to_string();
            }
        }
        let task = d.task(id).cloned().unwrap();
        self.save(&d)?;
        ok(json!(task))
    }

    pub fn task_set_done(&self, id: &str, done: bool) -> CmdResult {
        let mut d = self.load();
        {
            let t = d
                .task_mut(id)
                .ok_or_else(|| format!("任务不存在: {}", id))?;
            t.done = done;
            t.completed_at = if done { Some(now_iso()) } else { None };
        }
        let task = d.task(id).cloned().unwrap();
        self.save(&d)?;
        ok(json!(task))
    }

    pub fn task_toggle(&self, id: &str) -> CmdResult {
        let d = self.load();
        let cur = d.task(id).ok_or_else(|| format!("任务不存在: {}", id))?.done;
        self.task_set_done(id, !cur)
    }

    pub fn task_delete(&self, id: &str) -> CmdResult {
        let mut d = self.load();
        let before = d.tasks.len();
        d.tasks.retain(|t| t.id != id);
        if d.tasks.len() == before {
            return err(format!("任务不存在: {}", id));
        }
        self.save(&d)?;
        ok(json!({ "deleted": id }))
    }

    pub fn task_move(&self, id: &str, date: &str) -> CmdResult {
        self.task_edit(id, None, Some(date), None, None, None, None, None, None)
    }

    pub fn task_clear_done(&self, date: &str) -> CmdResult {
        let mut d = self.load();
        let date_s = if date.trim().is_empty() {
            None
        } else {
            Some(parse_date(date)?.format("%Y-%m-%d").to_string())
        };
        let before = d.tasks.len();
        d.tasks
            .retain(|t| !(t.done && date_s.as_deref().map(|x| t.date == x).unwrap_or(true)));
        let removed = before - d.tasks.len();
        self.save(&d)?;
        ok(json!({ "removed": removed }))
    }

    // ---------- notes ----------

    pub fn note_add(&self, body: &str, title: &str, color: &str) -> CmdResult {
        if body.trim().is_empty() {
            return err("内容不能为空".into());
        }
        let color_s = normalize_color(color)?;
        let mut d = self.load();
        let idx = d.notes.len();
        let id = Data::gen_id("n");
        let (x, y) = crate::model::default_note_position(idx);
        let note = Note {
            id: id.clone(),
            title: title.trim().to_string(),
            body: body.to_string(),
            color: color_s,
            x,
            y,
            w: 260.0,
            h: 220.0,
            pinned: false,
            visible: true,
            created_at: now_iso(),
            updated_at: now_iso(),
        };
        d.notes.push(note);
        self.save(&d)?;
        let n = d.notes.last().unwrap().clone();
        ok(json!({ "id": id, "note": n }))
    }

    pub fn note_list(&self) -> CmdResult {
        let d = self.load();
        ok(json!({ "count": d.notes.len(), "notes": d.notes }))
    }

    pub fn note_edit(
        &self,
        id: &str,
        title: Option<&str>,
        body: Option<&str>,
        color: Option<&str>,
    ) -> CmdResult {
        let mut d = self.load();
        {
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
        }
        let note = d.note(id).cloned().unwrap();
        self.save(&d)?;
        ok(json!(note))
    }

    pub fn note_delete(&self, id: &str) -> CmdResult {
        let mut d = self.load();
        let before = d.notes.len();
        d.notes.retain(|n| n.id != id);
        if d.notes.len() == before {
            return err(format!("便签不存在: {}", id));
        }
        self.save(&d)?;
        ok(json!({ "deleted": id }))
    }

    pub fn note_show(&self, id: &str, show: bool) -> CmdResult {
        let mut d = self.load();
        {
            let n = d
                .note_mut(id)
                .ok_or_else(|| format!("便签不存在: {}", id))?;
            n.visible = show;
            n.updated_at = now_iso();
        }
        self.save(&d)?;
        ok(json!({ "id": id, "visible": show }))
    }

    pub fn note_pin(&self, id: &str, pin: bool) -> CmdResult {
        let mut d = self.load();
        {
            let n = d
                .note_mut(id)
                .ok_or_else(|| format!("便签不存在: {}", id))?;
            n.pinned = pin;
            n.updated_at = now_iso();
        }
        self.save(&d)?;
        ok(json!({ "id": id, "pinned": pin }))
    }

    // ---------- widget（今日悬浮窗） ----------

    pub fn widget_show(&self, visible: bool) -> CmdResult {
        let mut d = self.load();
        d.settings.widget_visible = visible;
        self.save(&d)?;
        ok(json!({ "widget_visible": visible }))
    }

    pub fn widget_pin(&self, pinned: bool) -> CmdResult {
        let mut d = self.load();
        d.settings.widget_pinned = pinned;
        self.save(&d)?;
        ok(json!({ "widget_pinned": pinned }))
    }

    pub fn widget_set_pos(&self, x: i32, y: i32) -> CmdResult {
        let mut d = self.load();
        d.settings.widget_x = x;
        d.settings.widget_y = y;
        self.save(&d)?;
        ok(json!({ "widget_x": x, "widget_y": y }))
    }

    // ---------- aggregates ----------

    pub fn day(&self, date: &str) -> CmdResult {
        let pd = parse_date(if date.trim().is_empty() { "today" } else { date })?;
        let date_s = pd.format("%Y-%m-%d").to_string();
        let d = self.load();
        // 当天任务 + 需要关注的其他类型（进行中的长期目标 / 即将到期的截止任务）
        let mut tasks: Vec<&Task> = d
            .tasks
            .iter()
            .filter(|t| t.date == date_s)
            .collect();
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
        let d = self.load();
        let today = today_str();
        let total_all = d.tasks.len();
        let done_all = d.tasks.iter().filter(|t| t.done).count();
        let overdue = d
            .tasks
            .iter()
            .filter(|t| {
                !t.done
                    && t.date < today
                    && t.date != ""
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
        let (date_total, date_done) = if date.trim().is_empty() {
            (None, None)
        } else {
            let ds = parse_date(date)?.format("%Y-%m-%d").to_string();
            let ts: Vec<&Task> = d.tasks.iter().filter(|t| t.date == ds).collect();
            (
                Some(ts.len()),
                Some(ts.iter().filter(|t| t.done).count()),
            )
        };
        ok(json!({
            "tasks_total": total_all,
            "tasks_done": done_all,
            "tasks_open": total_all - done_all,
            "overdue": overdue,
            "goals_open": goals_open,
            "deadlines_open": deadlines_open,
            "date": date_total.map(|_| json!({
                "date": parse_date(if date.trim().is_empty() { "today" } else { date }).unwrap().format("%Y-%m-%d").to_string(),
                "total": date_total.unwrap(),
                "done": date_done.unwrap(),
            })),
            "notes": d.notes.len(),
        }))
    }

    pub fn dump(&self) -> CmdResult {
        ok(json!(self.load()))
    }
}

fn parse_priority(s: &str) -> Result<Priority, String> {
    match s.trim().to_lowercase().as_str() {
        "" | "normal" | "mid" | "中" => Ok(Priority::Normal),
        "low" | "低" => Ok(Priority::Low),
        "high" | "urgent" | "高" => Ok(Priority::High),
        other => err(format!(
            "无效优先级: {} (可选 low/normal/high)",
            other
        )),
    }
}

fn parse_tags(s: &str) -> Vec<String> {
    s.split(&[',', '，'][..])
        .map(|x| x.trim().trim_start_matches('#').to_string())
        .filter(|x| !x.is_empty())
        .collect()
}

fn normalize_color(c: &str) -> Result<String, String> {
    let s = c.trim().to_lowercase();
    if NOTE_COLORS.contains(&s.as_str()) {
        Ok(s)
    } else {
        err(format!(
            "无效颜色: {} (可选 {})",
            c,
            NOTE_COLORS.join("/")
        ))
    }
}
