use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use crate::model::{
    Data, Note, Priority, Project, Quadrant, RepeatRule, Task, UndoEntry, NOTE_COLORS,
};
use crate::store::Store;
use crate::timeparse::{now_iso, parse_date, parse_time, today_str, weekday_cn};

pub struct Ctx {
    pub store: Store,
}

pub type CmdResult = Result<Value, String>;

#[derive(Debug, Clone, Default)]
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
    pub project: String,
    pub parent: String,
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
    pub project: Option<&'a str>,
    pub parent: Option<&'a str>,
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
    /// 创建新的撤销记录。新格式只保存本次删除的项目；tasks/notes 仅为旧版本兼容保留。
    fn snapshot_undo(&self, label: &str) -> UndoEntry {
        UndoEntry {
            ts: now_iso(),
            label: label.to_string(),
            tasks: Vec::new(),
            notes: Vec::new(),
            deleted_tasks: Vec::new(),
            deleted_notes: Vec::new(),
        }
    }
}

mod note;
mod project;
mod queries;
mod settings;
mod task;
fn optional_link_id(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || matches!(value.to_ascii_lowercase().as_str(), "none" | "off" | "null") {
        None
    } else {
        Some(value.to_string())
    }
}

fn resolve_task_location(
    data: &Data,
    task_id: Option<&str>,
    existing: Option<&Task>,
    project_patch: Option<Option<String>>,
    parent_patch: Option<Option<String>>,
) -> Result<(Option<String>, Option<String>), String> {
    let old_project = existing.and_then(|task| task.project_id.clone());
    let old_parent = existing.and_then(|task| task.parent_id.clone());
    let parent_id = parent_patch.unwrap_or_else(|| old_parent.clone());

    let project_id = if let Some(parent_id) = parent_id.as_deref() {
        if task_id == Some(parent_id) {
            return Err("任务不能成为自己的子任务".into());
        }
        let parent = data
            .task(parent_id)
            .ok_or_else(|| format!("上级任务不存在: {}", parent_id))?;
        if task_id.is_some_and(|id| task_is_descendant(data, parent_id, id)) {
            return Err("不能把任务移动到自己的子任务下".into());
        }
        if old_parent.as_deref() != Some(parent_id) && parent.repeat != RepeatRule::None {
            return Err("重复任务不能包含子任务".into());
        }
        let inherited = parent.project_id.clone();
        if project_patch
            .as_ref()
            .is_some_and(|requested| requested != &inherited)
        {
            return Err("子任务必须与上级任务属于同一项目".into());
        }
        inherited
    } else {
        project_patch.unwrap_or_else(|| old_project.clone())
    };

    if let Some(project_id) = project_id.as_deref() {
        let project = data
            .project(project_id)
            .ok_or_else(|| format!("项目不存在: {}", project_id))?;
        if project.archived && old_project.as_deref() != Some(project_id) {
            return Err("不能将任务加入已归档项目".into());
        }
    }
    Ok((parent_id, project_id))
}

fn task_is_descendant(data: &Data, candidate_id: &str, ancestor_id: &str) -> bool {
    let mut current = data
        .task(candidate_id)
        .and_then(|task| task.parent_id.as_deref());
    let mut seen = HashSet::new();
    while let Some(id) = current {
        if id == ancestor_id || !seen.insert(id) {
            return true;
        }
        current = data.task(id).and_then(|task| task.parent_id.as_deref());
    }
    false
}

struct TaskLinks {
    children_by_parent: HashMap<String, Vec<String>>,
    parent_by_task: HashMap<String, String>,
    repeat_neighbors: HashMap<String, Vec<String>>,
}

impl TaskLinks {
    fn new(data: &Data) -> Self {
        let mut links = Self {
            children_by_parent: HashMap::new(),
            parent_by_task: HashMap::new(),
            repeat_neighbors: HashMap::new(),
        };
        for task in &data.tasks {
            if let Some(parent_id) = &task.parent_id {
                links
                    .children_by_parent
                    .entry(parent_id.clone())
                    .or_default()
                    .push(task.id.clone());
                links
                    .parent_by_task
                    .insert(task.id.clone(), parent_id.clone());
            }
            if let Some(previous_id) = &task.repeat_parent_id {
                links
                    .repeat_neighbors
                    .entry(task.id.clone())
                    .or_default()
                    .push(previous_id.clone());
                links
                    .repeat_neighbors
                    .entry(previous_id.clone())
                    .or_default()
                    .push(task.id.clone());
            }
        }
        links
    }
}

fn task_descendant_ids(links: &TaskLinks, task_id: &str) -> HashSet<String> {
    let mut descendants = HashSet::new();
    let mut parents = vec![task_id.to_string()];
    while let Some(parent_id) = parents.pop() {
        if let Some(children) = links.children_by_parent.get(&parent_id) {
            for child_id in children {
                if descendants.insert(child_id.clone()) {
                    parents.push(child_id.clone());
                }
            }
        }
    }
    descendants.remove(task_id);
    descendants
}

fn task_project_family_ids(links: &TaskLinks, task_id: &str) -> HashSet<String> {
    let mut related = HashSet::new();
    let mut pending = vec![task_id.to_string()];
    while let Some(current_id) = pending.pop() {
        if let Some(children) = links.children_by_parent.get(&current_id) {
            for child_id in children {
                if child_id != task_id && related.insert(child_id.clone()) {
                    pending.push(child_id.clone());
                }
            }
        }
        if let Some(repeats) = links.repeat_neighbors.get(&current_id) {
            for repeat_id in repeats {
                if repeat_id != task_id && related.insert(repeat_id.clone()) {
                    pending.push(repeat_id.clone());
                }
            }
        }
    }
    related
}

fn task_repeat_family_ids(links: &TaskLinks, task_id: &str) -> HashSet<String> {
    let mut related = HashSet::new();
    let mut pending = vec![task_id.to_string()];
    while let Some(current_id) = pending.pop() {
        if let Some(repeats) = links.repeat_neighbors.get(&current_id) {
            for repeat_id in repeats {
                if repeat_id != task_id && related.insert(repeat_id.clone()) {
                    pending.push(repeat_id.clone());
                }
            }
        }
    }
    related
}

fn task_has_children(data: &Data, task_id: &str) -> bool {
    data.tasks
        .iter()
        .any(|task| task.parent_id.as_deref() == Some(task_id))
}

fn reopen_completed_ancestors(data: &mut Data, parent_id: &str) {
    let mut current = Some(parent_id.to_string());
    let mut seen = HashSet::new();
    while let Some(id) = current {
        if !seen.insert(id.clone()) {
            break;
        }
        let Some(parent) = data.task(&id) else {
            break;
        };
        let next = parent.parent_id.clone();
        if parent.done {
            if let Some(parent) = data.task_mut(&id) {
                parent.done = false;
                parent.completed_at = None;
            }
        }
        current = next;
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
        && child.project_id == parent.project_id
        && child.parent_id == parent.parent_id
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
            project_id: None,
            parent_id: None,
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
