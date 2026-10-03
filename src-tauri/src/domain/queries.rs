use super::*;

impl Ctx {
    pub fn day(&self, date: &str) -> CmdResult {
        let pd = parse_date(if date.trim().is_empty() {
            "today"
        } else {
            date
        })?;
        let date_s = pd.format("%Y-%m-%d").to_string();
        let d = self.load()?;
        // 当天任务 + 需要关注的其他类型（进行中的长期目标 / 即将到期的截止任务）
        let mut tasks: Vec<&Task> = d
            .tasks
            .iter()
            .filter(|t| t.date == date_s && t.kind != crate::model::TaskKind::Goal)
            .collect();
        let goals: Vec<&Task> = d
            .tasks
            .iter()
            .filter(|t| t.kind == crate::model::TaskKind::Goal && !t.done)
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
            let tasks: Vec<&Task> = d
                .tasks
                .iter()
                .filter(|t| t.date == date_text && t.kind != crate::model::TaskKind::Goal)
                .collect();
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
