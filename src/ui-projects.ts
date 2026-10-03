import type { Data, Task } from "./types.ts";
import type { RenderOpts } from "./ui-shared.ts";
import { el } from "./ui-shared.ts";

export type TaskFilter = "all" | "open" | "done";
type TaskRenderer = (task: Task, opts: RenderOpts, showDate?: boolean, children?: Map<string, Task[]>) => HTMLElement;

export function renderProjectsBoard(data: Data, opts: RenderOpts, search: string, filter: TaskFilter, showArchived: boolean, onToggleArchived: () => void, renderTask: TaskRenderer): { element: HTMLElement; count: number } {
  const board = el("div", { class: "projects-board" });
  const query = search.trim().toLocaleLowerCase();
  let visibleCount = 0;
  const createButton = el("button", { class: "mini-btn project-create-button", type: "button" },
    el("span", { class: "project-create-glyph", "aria-hidden": "true" }, "+"),
    el("span", {}, "新建项目"),
  );
  const archivedButton = el("button", { class: "mini-btn", type: "button" }, showArchived ? "隐藏归档" : "显示归档");
  const projectName = el("input", { type: "text", placeholder: "项目名称", "aria-label": "项目名称" });
  const projectDescription = el("input", { type: "text", placeholder: "目标或说明（可选）", "aria-label": "项目说明" });
  const createForm = el("form", { class: "project-create-form", hidden: "" },
    projectName,
    projectDescription,
    el("button", { type: "submit", class: "project-create-submit" }, "创建"),
    el("button", { type: "button", class: "project-create-cancel" }, "取消"),
  );
  createButton.addEventListener("click", () => {
    createForm.hidden = !createForm.hidden;
    if (!createForm.hidden) projectName.focus();
  });
  archivedButton.addEventListener("click", onToggleArchived);
  createForm.querySelector<HTMLButtonElement>(".project-create-cancel")!.addEventListener("click", () => {
    createForm.hidden = true;
    projectName.value = "";
    projectDescription.value = "";
  });
  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = projectName.value.trim();
    if (!name) {
      projectName.focus();
      return;
    }
    const args = ["project", "add", name];
    if (projectDescription.value.trim()) args.push("--description", projectDescription.value.trim());
    const result = await opts.onCall(args);
    if (!result.ok) return;
    projectName.value = "";
    projectDescription.value = "";
    createForm.hidden = true;
  });
  board.append(
    el("div", { class: "projects-toolbar" }, createButton, archivedButton),
    createForm,
  );

  const projects = data.projects
    .filter((project) => showArchived || !project.archived)
    .slice()
    .sort((left, right) => Number(left.archived) - Number(right.archived) || left.name.localeCompare(right.name));
  const tasksByProject = new Map<string, Task[]>();
  for (const task of data.tasks) {
    if (!task.project_id) continue;
    const tasks = tasksByProject.get(task.project_id) || [];
    tasks.push(task);
    tasksByProject.set(task.project_id, tasks);
  }
  const allProjectTasks = data.tasks;
  const summaryOpen = allProjectTasks.filter((task) => !task.done).length;
  const summaryDone = allProjectTasks.length - summaryOpen;
  const summaryProjects = projects.filter((project) => !project.archived).length;
  board.append(
    el("div", { class: "project-summary" },
      el("div", { class: "project-summary-lead" },
        el("span", { class: "project-summary-kicker" }, "PROJECT CONTROL"),
        el("strong", {}, "把任务推进到结果"),
      ),
      el("div", { class: "project-summary-stats" },
        el("div", { class: "project-summary-stat" }, el("strong", {}, String(summaryProjects)), el("span", {}, "个项目")),
        el("div", { class: "project-summary-stat" }, el("strong", {}, String(summaryOpen)), el("span", {}, "项进行中")),
        el("div", { class: "project-summary-stat" }, el("strong", {}, String(summaryDone)), el("span", {}, "项已完成")),
      ),
    ),
  );
  for (const [projectIndex, project] of projects.entries()) {
    const projectTasks = tasksByProject.get(project.id) || [];
    const tasks = projectTasks.filter((task) => filter === "all" || (filter === "open" ? !task.done : task.done));
    const taskIds = new Set(tasks.map((task) => task.id));
    const projectMatches = query.length > 0
      && [project.name, project.description].some((value) => value.toLocaleLowerCase().includes(query));
    const visibleIds = projectMatches ? taskIds : matchingTreeTaskIds(tasks, query);
    if (query && !projectMatches && !visibleIds.size) continue;
    const visibleTasks = tasks.filter((task) => visibleIds.has(task.id));
    const roots = visibleTasks
      .filter((task) => !task.parent_id || !visibleIds.has(task.parent_id))
      .sort(taskOrder);
    const childrenByParent = taskChildren(visibleTasks);
    const openCount = projectTasks.filter((task) => !task.done).length;
    const completedCount = projectTasks.length - openCount;
    const completion = projectTasks.length ? Math.round((completedCount / projectTasks.length) * 100) : 0;
    visibleCount += visibleTasks.length;
    const list = el("div", { class: "project-task-tree" });
    if (roots.length) {
      for (const task of roots) list.append(renderTask(task, opts, true, childrenByParent));
    } else if (visibleTasks.length) {
      list.append(el("div", { class: "project-empty" }, "任务关系有循环，无法显示此树"));
    } else {
      list.append(el("div", { class: "project-empty" }, "项目还没有任务"));
    }
    const editName = el("input", { type: "text", value: project.name, "aria-label": "项目名称" });
    const editDescription = el("input", { type: "text", value: project.description, "aria-label": "项目说明", placeholder: "目标或说明（可选）" });
    const editForm = el("form", { class: "project-edit-form", hidden: "" },
      editName,
      editDescription,
      el("button", { type: "submit", class: "project-edit-submit" }, "保存"),
      el("button", { type: "button", class: "project-edit-cancel" }, "取消"),
    );
    const editButton = el("button", {
      class: "mini-btn",
      type: "button",
      onclick: () => {
        editForm.hidden = !editForm.hidden;
        if (!editForm.hidden) editName.focus();
      },
    }, "编辑");
    editForm.querySelector<HTMLButtonElement>(".project-edit-cancel")!.addEventListener("click", () => {
      editForm.hidden = true;
      editName.value = project.name;
      editDescription.value = project.description;
    });
    editForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = editName.value.trim();
      if (!name) {
        editName.focus();
        return;
      }
      const result = await opts.onCall([
        "project", "edit", project.id,
        "--name", name,
        "--description", editDescription.value.trim(),
      ]);
      if (result.ok) editForm.hidden = true;
    });
    const archive = el("button", {
      class: "mini-btn project-archive",
      type: "button",
      onclick: async () => {
        await opts.onCall(["project", project.archived ? "unarchive" : "archive", project.id]);
      },
    }, project.archived ? "恢复" : "归档");
    const collapseButton = el("button", {
      class: "project-collapse",
      type: "button",
      "aria-expanded": "true",
      "aria-label": `折叠项目 ${project.name}`,
      title: "折叠任务树",
    }, "⌄");
    collapseButton.addEventListener("click", () => {
      const expanded = !list.hidden;
      list.hidden = expanded;
      collapseButton.textContent = expanded ? "›" : "⌄";
      collapseButton.setAttribute("aria-expanded", String(!expanded));
      collapseButton.title = expanded ? "展开任务树" : "折叠任务树";
    });
    const projectSection = el(
      "section",
      { class: `project-section${project.archived ? " is-archived" : ""}` },
        el("div", { class: "project-section-head" },
          el("div", { class: "project-index" }, String(projectIndex + 1).padStart(2, "0")),
          el("div", { class: "project-heading" },
            el("h3", {}, project.name),
            el("span", { class: "project-task-count" }, `${openCount} 未完成 · ${completedCount} 已完成`),
          ),
          el("div", { class: "project-actions" }, editButton, archive, collapseButton),
        ),
        project.description ? el("p", { class: "project-description" }, project.description) : null,
        el("div", { class: "project-progress-row" },
          el("div", { class: "project-progress-track" }, el("i", { style: `width:${completion}%` })),
          el("span", { class: "project-progress-value" }, `${completion}%`),
        ),
        editForm,
        el("div", { class: "project-tree-surface" }, list),
    );
    board.append(projectSection);
  }

  const unassigned = data.tasks.filter((task) => !task.project_id && (filter === "all" || (filter === "open" ? !task.done : task.done)));
  const visibleUnassignedIds = matchingTreeTaskIds(unassigned, query);
  const visibleUnassigned = unassigned.filter((task) => visibleUnassignedIds.has(task.id));
  if (visibleUnassigned.length) {
    const visibleIds = new Set(visibleUnassigned.map((task) => task.id));
    const roots = visibleUnassigned
      .filter((task) => !task.parent_id || !visibleIds.has(task.parent_id))
      .sort(taskOrder);
    const childrenByParent = taskChildren(visibleUnassigned);
    visibleCount += visibleUnassigned.length;
    const section = el("section", { class: "project-section project-unassigned" },
      el("div", { class: "project-section-head" },
        el("div", { class: "project-index" }, "--"),
        el("div", { class: "project-heading" },
          el("h3", {}, "未归属项目"),
          el("span", { class: "project-task-count" }, `${visibleUnassigned.filter((task) => !task.done).length} 未完成`),
        ),
      ),
      el("p", { class: "project-description" }, "先归入项目，任务会更容易形成可推进的路径。"),
    );
    const unassignedTree = el("div", { class: "project-tree-surface" });
    if (roots.length) {
      unassignedTree.append(...roots.map((task) => renderTask(task, opts, true, childrenByParent)));
    } else {
      unassignedTree.append(el("div", { class: "project-empty" }, "任务关系有循环，无法显示此树"));
    }
    section.append(unassignedTree);
    board.append(section);
  }

  if (!board.querySelector(".project-section")) {
    board.append(el("div", { class: "project-empty-state" }, query ? "没有符合条件的项目或任务" : "还没有项目或任务"));
  }
  return { element: board, count: visibleCount };
}

function matchingTreeTaskIds(tasks: Task[], query: string): Set<string> {
  if (!query) return new Set(tasks.map((task) => task.id));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visible = new Set<string>();
  for (const task of tasks) {
    const fields = [task.title, task.notes, task.date, ...task.tags];
    if (!fields.some((value) => value.toLocaleLowerCase().includes(query))) continue;
    let current: Task | undefined = task;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      visible.add(current.id);
      seen.add(current.id);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
  }
  return visible;
}

function taskChildren(tasks: Task[]): Map<string, Task[]> {
  const children = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.parent_id) continue;
    const siblings = children.get(task.parent_id) || [];
    siblings.push(task);
    children.set(task.parent_id, siblings);
  }
  for (const siblings of children.values()) siblings.sort(taskOrder);
  return children;
}

function taskOrder(left: Task, right: Task): number {
  return (left.date || "9999").localeCompare(right.date || "9999")
    || (left.start || "99:99").localeCompare(right.start || "99:99")
    || left.title.localeCompare(right.title)
    || left.id.localeCompare(right.id);
}

/** 概览卡：今天 / 逾期 / 长期 三张数字卡 */
