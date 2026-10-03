use super::*;

impl Ctx {
    pub fn project_add(&self, name: &str, description: &str) -> CmdResult {
        let name = name.trim().to_string();
        if name.is_empty() {
            return err("项目名称不能为空".into());
        }
        let description = description.trim().to_string();
        let project = self.store.with_lock(2000, move |data| {
            if data
                .projects
                .iter()
                .any(|project| project.name.eq_ignore_ascii_case(&name))
            {
                return Err(format!("项目名称已存在: {}", name));
            }
            let now = now_iso();
            let project = Project {
                id: data.gen_unique_id("p"),
                name,
                description,
                archived: false,
                created_at: now.clone(),
                updated_at: now,
            };
            data.projects.push(project.clone());
            Ok(project)
        })?;
        ok(json!(project))
    }

    pub fn project_list(&self, include_archived: bool) -> CmdResult {
        let mut projects = self.load()?.projects;
        if !include_archived {
            projects.retain(|project| !project.archived);
        }
        projects.sort_by(|left, right| {
            left.archived
                .cmp(&right.archived)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
                .then(left.id.cmp(&right.id))
        });
        ok(json!({ "count": projects.len(), "projects": projects }))
    }

    pub fn project_get(&self, id: &str) -> CmdResult {
        let data = self.load()?;
        let project = data
            .project(id)
            .ok_or_else(|| format!("项目不存在: {}", id))?;
        let tasks: Vec<&Task> = data
            .tasks
            .iter()
            .filter(|task| task.project_id.as_deref() == Some(id))
            .collect();
        ok(json!({ "project": project, "count": tasks.len(), "tasks": tasks }))
    }

    pub fn project_edit(
        &self,
        id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> CmdResult {
        let project = self.store.with_lock(2000, |data| {
            if let Some(name) = name {
                if name.trim().is_empty() {
                    return Err("项目名称不能为空".into());
                }
                if data
                    .projects
                    .iter()
                    .any(|item| item.id != id && item.name.eq_ignore_ascii_case(name.trim()))
                {
                    return Err(format!("项目名称已存在: {}", name.trim()));
                }
            }
            let project = data
                .project_mut(id)
                .ok_or_else(|| format!("项目不存在: {}", id))?;
            if let Some(name) = name {
                project.name = name.trim().to_string();
            }
            if let Some(description) = description {
                project.description = description.trim().to_string();
            }
            project.updated_at = now_iso();
            Ok(project.clone())
        })?;
        ok(json!(project))
    }

    pub fn project_archive(&self, id: &str, archived: bool) -> CmdResult {
        let project = self.store.with_lock(2000, |data| {
            let project = data
                .project_mut(id)
                .ok_or_else(|| format!("项目不存在: {}", id))?;
            project.archived = archived;
            project.updated_at = now_iso();
            Ok(project.clone())
        })?;
        ok(json!(project))
    }

    pub fn project_delete(&self, id: &str) -> CmdResult {
        self.store.with_lock(2000, |data| {
            if data.project(id).is_none() {
                return Err(format!("项目不存在: {}", id));
            }
            let has_tasks = data
                .tasks
                .iter()
                .any(|task| task.project_id.as_deref() == Some(id));
            let undo_references_project = data.undo.as_ref().is_some_and(|undo| {
                undo.deleted_tasks
                    .iter()
                    .chain(&undo.tasks)
                    .any(|task| task.project_id.as_deref() == Some(id))
            });
            if has_tasks || undo_references_project {
                return Err(
                    "项目仍有关联任务或可撤销记录，不能删除；请先移出关联任务并处理撤销记录".into(),
                );
            }
            data.projects.retain(|item| item.id != id);
            Ok(())
        })?;
        ok(json!({ "deleted": id }))
    }
}
