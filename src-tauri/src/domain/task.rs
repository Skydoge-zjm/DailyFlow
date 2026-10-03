use super::*;

impl Ctx {
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
            project,
            parent,
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
                let (parent_id, project_id) = resolve_task_location(
                    d,
                    None,
                    None,
                    (!project.trim().is_empty()).then(|| optional_link_id(&project)),
                    Some(optional_link_id(&parent)),
                )?;
                let id = d.gen_unique_id("t");
                let task = Task {
                    id: id.clone(),
                    project_id,
                    parent_id,
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
                let parent_for_reopen = task.parent_id.clone();
                d.tasks.push(task);
                if let Some(parent_id) = parent_for_reopen.as_deref() {
                    reopen_completed_ancestors(d, parent_id);
                }
                let t = d.tasks.last().unwrap().clone();
                Ok((id, t))
            })
            .map(|(id, t)| ok(json!({ "id": id, "task": t })))?
    }

    pub fn task_list(&self, scope: &str, tag: &str) -> CmdResult {
        self.task_list_in_project(scope, tag, "")
    }

    pub fn task_list_in_project(&self, scope: &str, tag: &str, project_id: &str) -> CmdResult {
        let mut d = self.load()?;
        let today = today_str();
        let mut tasks = std::mem::take(&mut d.tasks);
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
                "today" => t.kind != crate::model::TaskKind::Goal && t.date == today,
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
            let project_ok = project_id.is_empty() || t.project_id.as_deref() == Some(project_id);
            scope_ok && tag_ok && project_ok
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
            project,
            parent,
        } = patch;
        let task = self.store.with_lock(2000, |d| {
            let index = d
                .tasks
                .iter()
                .position(|task| task.id == id)
                .ok_or_else(|| format!("任务不存在: {}", id))?;
            let original = d.tasks[index].clone();
            let (parent_id, project_id) = resolve_task_location(
                d,
                Some(id),
                Some(&original),
                project.map(optional_link_id),
                parent.map(optional_link_id),
            )?;
            let parent_changed = parent_id != original.parent_id;
            let location_changed = parent_changed || project_id != original.project_id;
            let next_repeat = repeat
                .map(RepeatRule::parse)
                .transpose()?
                .unwrap_or(original.repeat);
            let links = TaskLinks::new(d);
            let descendants = if next_repeat != RepeatRule::None {
                task_descendant_ids(&links, id)
            } else {
                HashSet::new()
            };
            if next_repeat != RepeatRule::None && !descendants.is_empty() {
                return Err("含有子任务的任务不能设置重复规则".into());
            }
            let project_family = if location_changed {
                task_project_family_ids(&links, id)
            } else {
                HashSet::new()
            };
            let repeat_family = if parent_changed {
                task_repeat_family_ids(&links, id)
            } else {
                HashSet::new()
            };
            let t = &mut d.tasks[index];
            let old_start = original.start.clone();
            let old_date = original.date.clone();
            let old_reminder = original.remind_at.clone();
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
            t.repeat = next_repeat;
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
            t.parent_id = parent_id.clone();
            t.project_id = project_id.clone();
            let updated = t.clone();
            for child in &mut d.tasks {
                if project_family.contains(&child.id) {
                    child.project_id = project_id.clone();
                }
                if repeat_family.contains(&child.id) {
                    child.parent_id = parent_id.clone();
                }
            }
            if !original.done && parent_changed {
                if let Some(parent_id) = parent_id.as_deref() {
                    reopen_completed_ancestors(d, parent_id);
                }
            }
            Ok(updated)
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
            let descendants = if newly_done {
                task_descendant_ids(&TaskLinks::new(d), id)
            } else {
                HashSet::new()
            };
            if newly_done
                && descendants
                    .iter()
                    .any(|child_id| d.task(child_id).is_some_and(|child| !child.done))
            {
                return Err("请先完成全部子任务，再完成父任务".into());
            }
            if newly_done && previous.repeat != RepeatRule::None && !descendants.is_empty() {
                return Err("含有子任务的任务不能设置重复规则".into());
            }
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
            if !done {
                if let Some(parent_id) = d.tasks[index].parent_id.clone() {
                    reopen_completed_ancestors(d, &parent_id);
                }
            }
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
                if let Some(parent_id) = task.parent_id.as_deref() {
                    reopen_completed_ancestors(d, parent_id);
                }
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
            if task_has_children(d, id) {
                return Err("该任务仍有子任务，请先移动或删除子任务".into());
            }
            let mut snapshot = self.snapshot_undo("删除任务");
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
            let candidates: Vec<Task> = d
                .tasks
                .iter()
                .filter(|t| {
                    t.done
                        && t.kind != crate::model::TaskKind::Goal
                        && date_s.as_deref().map(|x| t.date == x).unwrap_or(true)
                })
                .cloned()
                .collect();
            if candidates.is_empty() {
                return Ok((0, Vec::new(), 0));
            }
            let candidate_ids = candidates
                .iter()
                .map(|task| task.id.clone())
                .collect::<HashSet<_>>();
            let links = TaskLinks::new(d);
            let mut blocked = HashSet::new();
            let mut pending = Vec::new();
            for (parent_id, children) in &links.children_by_parent {
                if candidate_ids.contains(parent_id)
                    && children
                        .iter()
                        .any(|child_id| !candidate_ids.contains(child_id))
                    && blocked.insert(parent_id.clone())
                {
                    pending.push(parent_id.clone());
                }
            }
            while let Some(child_id) = pending.pop() {
                if let Some(parent_id) = links.parent_by_task.get(&child_id) {
                    if candidate_ids.contains(parent_id) && blocked.insert(parent_id.clone()) {
                        pending.push(parent_id.clone());
                    }
                }
            }
            let removable_ids = candidate_ids
                .difference(&blocked)
                .cloned()
                .collect::<HashSet<_>>();
            let retained_with_children = candidates.len().saturating_sub(removable_ids.len());
            let deleted: Vec<Task> = candidates
                .into_iter()
                .filter(|task| removable_ids.contains(&task.id))
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
                let mut snapshot = self.snapshot_undo("清理已完成任务");
                snapshot.deleted_tasks = deleted;
                d.tasks.retain(|task| !removable_ids.contains(&task.id));
                d.undo = Some(snapshot);
            }
            Ok((removed, deleted_ids, retained_with_children))
        })?;
        ok(json!({
            "removed": removed.0,
            "deleted_ids": removed.1,
            "retained_with_children": removed.2,
        }))
    }

    // ---------- notes ----------
}
