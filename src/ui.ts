// 主窗口 UI 渲染（无框架，纯 DOM）
import type { Data, Quadrant, Task } from "./types.ts";
import { el, taskQuadrant, type RenderOpts } from "./ui-shared.ts";
import { taskClearDoneArgs, taskDeleteArgs, taskEditArgs, taskToggleArgs, undoArgs } from "./cli-args.ts";
import { openTaskEditor } from "./task-editor.ts";
import { quickAdd } from "./quick-add.ts";
import { notesPanel } from "./notes-panel.ts";
import { openThemePanel } from "./theme-panel.ts";
import { openCliPathPanel } from "./cli-path-panel.ts";

export { el, openTaskEditor };
export type { RenderOpts };

const WD = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const QUADRANT_META: Record<Quadrant, { label: string; short: string }> = {
  q1: { label: "重要且紧急", short: "Q1" },
  q2: { label: "重要不紧急", short: "Q2" },
  q3: { label: "不重要但紧急", short: "Q3" },
  q4: { label: "不重要不紧急", short: "Q4" },
};
let taskSearch = "";
type WorkspaceMode = "day" | "projects" | "matrix";
type TaskFilter = "all" | "open" | "done";
let taskView: WorkspaceMode = "day";
let taskFilter: TaskFilter = "all";
let showArchivedProjects = false;

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function openCountText(tasks: Task[]): string {
  const scheduled = tasks.filter((t) => t.kind !== "goal");
  const open = scheduled.filter((t) => !t.done).length;
  if (!scheduled.length) return "还没有安排，先从右侧捕捉一项计划";
  return open ? `${scheduled.length} 项计划 · ${open} 项待完成` : `${scheduled.length} 项计划 · 全部完成`;
}

export function renderApp(root: HTMLElement, opts: RenderOpts): void {
  const searchFocused = document.activeElement?.classList.contains("task-search");
  const searchCaret = searchFocused ? (document.activeElement as HTMLInputElement).selectionStart : null;
  document.body.classList.add("modern-ui");
  root.classList.add("modern-app");
  root.innerHTML = "";
  const { data, selectedDate } = opts;
  const today = fmtDate(new Date());
  const visibleProjectIds = new Set(data.projects.filter((project) => showArchivedProjects || !project.archived).map((project) => project.id));
  const projectOpenCount = data.tasks.filter((task) => !task.done && (!task.project_id || visibleProjectIds.has(task.project_id))).length;

  // ===== 顶栏 =====
  const sel = new Date(selectedDate + "T00:00:00");
  const dayCount = data.tasks.filter((t) => t.date === selectedDate && t.kind !== "goal").length;
  const progress = dayProgress(data, selectedDate);
  const ring = buildRing(progress, dayCount > 0 && progress >= 1);

  const doneCount = data.tasks.filter((t) => t.date === selectedDate && t.kind !== "goal" && t.done).length;
  const topbar = el(
    "header",
    { class: "topbar" },
    el("div", { class: "brand-lockup" },
      el("div", { class: "brand-mark", "aria-hidden": "true" }, "df"),
      el("div", { class: "brand-copy" },
        el("div", { class: "brand-name" }, "DAILYFLOW"),
        el("div", { class: "brand-caption" }, "个人节奏工作台"),
      ),
    ),
    el("div", { class: "topbar-divider", "aria-hidden": "true" }),
    el(
      "div",
      { class: "date-block" },
      el("div", { class: "date-kicker" }, today === selectedDate ? "FOCUS DAY" : "SELECTED DAY"),
      el("div", { class: "date-main" }, `${sel.getMonth() + 1}月${sel.getDate()}日`),
      el("div", { class: "date-sub" }, `${WD[sel.getDay()]} · ${today === selectedDate ? "今天" : selectedDate}`),
    ),
    el("div", { class: "progress-cluster" },
      ring,
      el("div", { class: "progress-copy" },
        el("span", { class: "progress-label" }, "今日进度"),
        el("strong", {}, `${doneCount} / ${dayCount || 0} 项完成`),
      ),
    ),
    el("div", { class: "spacer" }),
    el("div", { class: "topbar-actions" },
      el("button", { class: "icon-btn action-btn", title: "新建便签", "aria-label": "新建便签", onclick: () => opts.onNewNote() },
        el("span", { class: "btn-glyph", "aria-hidden": "true" }, "+"),
        el("span", { class: "btn-label" }, "便签"),
      ),
      el("button", {
        class: "icon-btn action-btn",
        title: "明暗切换",
        "aria-label": "切换明暗主题",
        onclick: () => void opts.onSettings({ theme: data.settings.theme === "dark" ? "light" : "dark" }),
      },
        el("span", { class: "btn-glyph", "aria-hidden": "true" }, data.settings.theme === "dark" ? "☼" : "◐"),
        el("span", { class: "btn-label" }, data.settings.theme === "dark" ? "浅色" : "深色"),
      ),
      el("button", { class: "icon-btn action-btn", title: "主题与外观", "aria-label": "主题与外观", onclick: () => openThemePanel(opts) },
        el("span", { class: "btn-glyph", "aria-hidden": "true" }, "✦"),
        el("span", { class: "btn-label" }, "外观"),
      ),
      el("button", { class: "icon-btn action-btn", title: "命令行设置", "aria-label": "命令行设置", onclick: openCliPathPanel },
        el("span", { class: "btn-glyph", "aria-hidden": "true" }, "⚙"),
        el("span", { class: "btn-label" }, "设置"),
      ),
    ),
  );

  // ===== 左列：任务 =====
  const dayTasks = data.tasks
    .filter((t) => t.date === selectedDate)
    .sort((a, b) => (a.start ?? "99:99").localeCompare(b.start ?? "99:99") || a.id.localeCompare(b.id));

  const groups: Array<[string, Task[]]> = [
    ["早上", []],
    ["下午", []],
    ["晚上", []],
    ["全天 / 待办", []],
  ];
  for (const t of dayTasks.filter((t) => t.kind === "normal")) {
    if (!t.start) groups[3][1].push(t);
    else if (t.start < "12:00") groups[0][1].push(t);
    else if (t.start < "18:00") groups[1][1].push(t);
    else groups[2][1].push(t);
  }

  const listEl = el("div", { class: "task-list" });
  let any = false;

  // 逾期任务（所有日期早于今天、未完成、非 goal）单独成组置顶
  const overdueTasks = data.tasks
    .filter((t) => !t.done && t.kind !== "goal" && t.date !== "" && t.date < today)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (overdueTasks.length && selectedDate === today) {
    any = true;
    listEl.append(
      el("div", { class: "time-group overdue-group" },
        el("div", { class: "time-group-label overdue-label" }, `已逾期 · ${overdueTasks.length}`),
        ...overdueTasks.map((t) => taskItem(t, opts)),
      ),
    );
  }

  for (const [label, items] of groups) {
    if (!items.length) continue;
    any = true;
    listEl.append(
      el("div", { class: "time-group" },
        el("div", { class: "time-group-label" }, label),
        ...items.map((t) => taskItem(t, opts)),
      ),
    );
  }

  // 截止任务（截止日 >= 选中日，未完成，日期非空）——按剩余天数升序
  const todayStr = fmtDate(new Date());
  const deadlines = data.tasks
    .filter((t) => t.kind === "deadline" && t.date !== "" && (t.date === selectedDate || (!t.done && t.date >= todayStr)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  if (deadlines.length) {
    any = true;
    listEl.append(
      el("div", { class: "time-group" },
        el("div", { class: "time-group-label" }, "截止任务"),
        ...deadlines.map((t) => taskItem(t, opts)),
      ),
    );
  }

  // 长期目标（未完成）——持续展示
  const goals = data.tasks.filter((t) => t.kind === "goal" && !t.done);
  if (goals.length) {
    any = true;
    listEl.append(
      el("div", { class: "time-group" },
        el("div", { class: "time-group-label" }, "长期目标"),
        ...goals.map((t) => taskItem(t, opts)),
      ),
    );
  }

  if (!any) {
    listEl.append(
      el("div", { class: "empty-state" },
        el("div", { class: "big" }, "—"),
        el("div", { class: "empty-title" }, "这一天还没有安排"),
        el("div", { class: "empty-hint" }, "双击标题可改任务 · 右侧快速添加 · 或让 AI 通过 CLI 帮你安排"),
      ),
    );
  }

  const openCount = dayTasks.filter((t) => t.kind !== "goal" && !t.done).length;
  const defaultItems = Array.from(listEl.childNodes);
  const searchInput = el("input", { class: "task-search", type: "search", placeholder: "搜索任务", "aria-label": "搜索任务或项目" });
  searchInput.value = taskSearch;
  const modeLabels: Array<[WorkspaceMode, string, string]> = [
    ["day", "时间", "按时间安排执行"],
    ["projects", "项目", "按项目推进结果"],
    ["matrix", "重要性", "按四象限判断优先级"],
  ];
  const modeSwitch = el("div", { class: "view-mode-switch", role: "tablist", "aria-label": "任务组织模式" });
  for (const [value, label, hint] of modeLabels) {
    const button = el("button", {
      class: `mode-tab${taskView === value ? " active" : ""}`,
      type: "button",
      role: "tab",
      "aria-selected": String(taskView === value),
      title: hint,
    }, label);
    button.addEventListener("click", () => {
      taskView = value;
      taskSearch = "";
      window.__dailyflow.rerender();
    });
    modeSwitch.append(button);
  }
  const filterSelect = document.createElement("select");
  filterSelect.className = "task-filter-select";
  filterSelect.setAttribute("aria-label", "任务状态筛选");
  for (const [value, label] of [["all", "全部任务"], ["open", "未完成"], ["done", "已完成"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    filterSelect.append(option);
  }
  filterSelect.value = taskFilter;
  const countBadge = el("span", { class: "count-badge" }, String(openCount));
  const viewTitle = () => taskView === "matrix" ? "重要性矩阵" : taskView === "projects" ? "项目任务树" : "时间安排";
  const sectionTitle = el("h2", {}, viewTitle());
  const refreshTaskList = () => {
    if (taskView === "projects") {
      const board = projectsBoard(data, opts, taskSearch, taskFilter);
      countBadge.textContent = String(board.count);
      listEl.replaceChildren(board.element);
      return;
    }
    if (taskView === "matrix") {
      const query = taskSearch.trim().toLocaleLowerCase();
      const matches = data.tasks
        .filter((task) => taskFilter === "all" || (taskFilter === "open" ? !task.done : task.done))
        .filter((task) => !query || [task.title, task.notes, task.date, ...task.tags].some((value) => value.toLocaleLowerCase().includes(query)))
        .sort((a, b) => taskQuadrant(a).localeCompare(taskQuadrant(b)) || (a.date || "9999").localeCompare(b.date || "9999") || a.id.localeCompare(b.id));
      countBadge.textContent = String(matches.length);
      listEl.replaceChildren(matrixBoard(matches, opts));
      return;
    }
    if (taskView === "day" && taskFilter === "all" && !taskSearch.trim()) {
      listEl.replaceChildren(...defaultItems);
      countBadge.textContent = String(openCount);
      return;
    }
    const query = taskSearch.trim().toLocaleLowerCase();
    const matches = data.tasks
      .filter((task) => taskFilter === "all" || (taskFilter === "open" ? !task.done : task.done))
      .filter((task) => !query || [task.title, task.notes, task.date, ...task.tags].some((value) => value.toLocaleLowerCase().includes(query)))
      .sort((a, b) => Number(a.done) - Number(b.done) || (a.date || "9999").localeCompare(b.date || "9999") || a.id.localeCompare(b.id));
    countBadge.textContent = String(matches.length);
    listEl.replaceChildren(...(matches.length
      ? matches.map((task) => taskItem(task, opts, true))
      : [el("div", { class: "empty-state" }, el("div", { class: "empty-title" }, "没有符合条件的任务"))]));
  };
  searchInput.addEventListener("input", () => {
    taskSearch = searchInput.value;
    refreshTaskList();
  });
  filterSelect.addEventListener("change", () => {
    taskFilter = filterSelect.value as TaskFilter;
    sectionTitle.textContent = viewTitle();
    refreshTaskList();
  });
  refreshTaskList();
  const tasksCol = el(
    "div",
    { class: "tasks-col" },
    el("div", { class: "workspace-intro" },
      el("div", { class: "section-kicker" }, taskView === "projects" ? "WORKSPACE / PROJECTS" : taskView === "matrix" ? "WORKSPACE / PRIORITY" : today === selectedDate ? "WORKSPACE / TODAY" : "WORKSPACE / SCHEDULE"),
      el("div", { class: "workspace-title-row" },
        el("h1", { class: "workspace-title" }, taskView === "projects" ? "项目任务树" : taskView === "matrix" ? "重要性矩阵" : today === selectedDate ? "今天的节奏" : "这一天的安排"),
        taskView === "day" ? el("span", { class: "workspace-date" }, selectedDate.slice(5).replace("-", " / ")) : null,
      ),
      el("p", { class: "workspace-subtitle" }, taskView === "projects"
        ? `${data.projects.filter((project) => showArchivedProjects || !project.archived).length} 个项目 · ${projectOpenCount} 项未完成`
        : taskView === "matrix" ? "把注意力放在真正重要的事情上"
        : openCountText(dayTasks)),
    ),
    taskView === "day" ? statCards(data, today) : null,
    el("div", { class: "section-head" },
      sectionTitle,
      countBadge,
      el("div", { class: "spacer" }),
      selectedDate !== today && taskView === "day"
        ? el("button", { class: "mini-btn", onclick: () => opts.onSelectDate(today) }, "← 回到今天")
        : null,
      taskView === "day" ? el("button", { class: "mini-btn", onclick: async () => {
        const result = await opts.onCall(taskClearDoneArgs(selectedDate));
        if (!result.ok) return;
        const data = result.data as { removed?: number; deleted_ids?: string[]; retained_with_children?: number } | undefined;
        const removed = Number(data?.removed || 0);
        const retained = Number(data?.retained_with_children || 0);
        const deletedIds = data?.deleted_ids || [];
        window.__dailyflow.rerender();
        if (removed > 0) {
          const suffix = retained ? `，保留 ${retained} 项含子任务的父任务` : "";
          window.__dailyflow.undoToast(`已清理 ${removed} 项${suffix}`, async () => {
            const restored = await opts.onCall(undoArgs(...deletedIds));
            if (restored.ok) window.__dailyflow.rerender();
          });
        } else if (retained > 0) {
          window.__dailyflow.toast(`保留 ${retained} 项仍含子任务的父任务`);
        }
      } }, "清理已完成") : null,
    ),
    el("div", { class: "task-tools" }, modeSwitch, el("div", { class: "task-tools-row" }, searchInput, filterSelect)),
    listEl,
  );

  // ===== 右列 =====
  const sideCol = el(
    "div",
    { class: "side-col" },
    weekCal(data, selectedDate, today, opts),
    quickAdd(opts, selectedDate, taskView === "projects"),
    notesPanel(data, opts),
  );

  // ===== 底栏 =====
  const statusbar = el(
    "footer",
    { class: "statusbar" },
    el("span", { class: "status-indicator", "aria-hidden": "true" }),
    el("span", { class: "status-label" }, "已同步"),
    el("span", { class: "mono" }, "%APPDATA%\\com.dailyflow.app\\data.json"),
    el("div", { class: "spacer" }),
    el("span", { class: "status-count" }, `共 ${data.tasks.length} 项 · 便签 ${data.notes.length} 张`),
  );

  root.append(topbar, el("div", { class: "layout" }, tasksCol, sideCol), statusbar);
  if (searchFocused) {
    searchInput.focus();
    if (searchCaret !== null) searchInput.setSelectionRange(searchCaret, searchCaret);
  }
}

function projectsBoard(data: Data, opts: RenderOpts, search: string, filter: TaskFilter = "all"): { element: HTMLElement; count: number } {
  const board = el("div", { class: "projects-board" });
  const query = search.trim().toLocaleLowerCase();
  let visibleCount = 0;
  const createButton = el("button", { class: "mini-btn", type: "button" }, "+ 新建项目");
  const archivedButton = el("button", { class: "mini-btn", type: "button" }, showArchivedProjects ? "隐藏归档" : "显示归档");
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
  archivedButton.addEventListener("click", () => {
    showArchivedProjects = !showArchivedProjects;
    window.__dailyflow.rerender();
  });
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
    .filter((project) => showArchivedProjects || !project.archived)
    .slice()
    .sort((left, right) => Number(left.archived) - Number(right.archived) || left.name.localeCompare(right.name));
  const tasksByProject = new Map<string, Task[]>();
  for (const task of data.tasks) {
    if (!task.project_id) continue;
    const tasks = tasksByProject.get(task.project_id) || [];
    tasks.push(task);
    tasksByProject.set(task.project_id, tasks);
  }
  for (const project of projects) {
    const tasks = (tasksByProject.get(project.id) || []).filter((task) => filter === "all" || (filter === "open" ? !task.done : task.done));
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
    const openCount = visibleTasks.filter((task) => !task.done).length;
    const completedCount = visibleTasks.length - openCount;
    visibleCount += visibleTasks.length;
    const list = el("div", { class: "project-task-tree" });
    if (roots.length) {
      for (const task of roots) list.append(taskItem(task, opts, true, childrenByParent));
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
    board.append(
      el("section", { class: `project-section${project.archived ? " is-archived" : ""}` },
        el("div", { class: "project-section-head" },
          el("div", { class: "project-heading" },
            el("h3", {}, project.name),
            el("span", { class: "project-task-count" }, `${openCount} 未完成 · ${completedCount} 已完成`),
          ),
          el("div", { class: "project-actions" }, editButton, archive),
        ),
        project.description ? el("p", { class: "project-description" }, project.description) : null,
        editForm,
        list,
      ),
    );
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
      el("div", { class: "project-section-head" }, el("h3", {}, "未归属项目")),
    );
    if (roots.length) {
      section.append(...roots.map((task) => taskItem(task, opts, true, childrenByParent)));
    } else {
      section.append(el("div", { class: "project-empty" }, "任务关系有循环，无法显示此树"));
    }
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
function statCards(data: Data, today: string): HTMLElement {
  const todayAll = data.tasks.filter((t) => t.date === today && t.kind !== "goal");
  const todayOpen = todayAll.filter((t) => !t.done).length;
  const overdueN = data.tasks.filter((t) => !t.done && t.kind !== "goal" && t.date !== "" && t.date < today).length;
  const goalsN = data.tasks.filter((t) => t.kind === "goal" && !t.done).length;
  const deadlinesN = data.tasks.filter((t) => t.kind === "deadline" && !t.done && t.date !== "" && t.date >= today).length;
  const card = (label: string, value: string, cls: string, index: string) =>
    el("div", { class: `stat-card ${cls}` },
      el("div", { class: "stat-topline" },
        el("span", { class: "stat-index" }, index),
        el("span", { class: "stat-value" }, value),
      ),
      el("div", { class: "stat-label" }, label),
    );
  const cards: Array<[string, string, string]> = [
    ["今日待办", String(todayOpen), todayOpen > 0 ? "hot" : "calm"],
    ...(overdueN > 0 ? [["已逾期", String(overdueN), "danger"] as [string, string, string]] : []),
    ...(deadlinesN > 0 ? [["临近截止", String(deadlinesN), "warn"] as [string, string, string]] : []),
    ["长期目标", String(goalsN), "goal"],
  ];
  return el(
    "div",
    { class: "stat-cards" },
    ...cards.map(([label, value, cls], index) => card(label, value, cls, String(index + 1).padStart(2, "0"))),
  );
}

function dayProgress(data: Data, date: string): number {
  const ts = data.tasks.filter((t) => t.date === date && t.kind !== "goal");
  if (!ts.length) return 0;
  return ts.filter((t) => t.done).length / ts.length;
}

function buildRing(p: number, allDone: boolean): HTMLElement {
  const r = 21;
  const c = 2 * Math.PI * r;
  const wrap = el("div", { class: "progress-ring", title: allDone ? "全部完成 🎉" : "完成率" });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "52");
  svg.setAttribute("height", "52");
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  const fg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  for (const [circle, cls] of [[bg, "ring-bg"], [fg, "ring-fg"]] as const) {
    circle.setAttribute("cx", "26");
    circle.setAttribute("cy", "26");
    circle.setAttribute("r", String(r));
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke-width", "4");
    circle.setAttribute("class", cls);
  }
  if (allDone) {
    fg.classList.add("done-all");
  }
  fg.setAttribute("stroke-dasharray", String(c));
  fg.setAttribute("stroke-dashoffset", String(c * (1 - p)));
  fg.setAttribute("stroke-linecap", "round");
  svg.append(bg, fg);
  const label = el("div", { class: `ring-label${allDone ? " done-all" : ""}` }, allDone ? "✓" : `${Math.round(p * 100)}%`);
  wrap.append(svg, label);
  return wrap;
}

function daysUntil(date: string): number {
  if (!date) return Infinity;
  const d = new Date(date + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

function matrixBoard(tasks: Task[], opts: RenderOpts): HTMLElement {
  const groups: Quadrant[] = ["q1", "q2", "q3", "q4"];
  const board = el("div", { class: "quadrant-board" });
  for (const quadrant of groups) {
    const items = tasks.filter((task) => taskQuadrant(task) === quadrant);
    const meta = QUADRANT_META[quadrant];
    const cell = el(
      "section",
      { class: `quadrant-cell quadrant-${quadrant}` },
      el("div", { class: "quadrant-head" },
        el("div", { class: "quadrant-code" }, meta.short),
        el("div", { class: "quadrant-heading" },
          el("strong", {}, meta.label),
          el("span", { class: "quadrant-count" }, String(items.length)),
        ),
      ),
      el("div", { class: "quadrant-hint" }, quadrant === "q1" ? "先处理，避免继续积压" : quadrant === "q2" ? "留出时间，安排进计划" : quadrant === "q3" ? "尽量委派或快速处理" : "减少、合并或稍后再做"),
      el("div", { class: "quadrant-items" },
        ...(items.length
          ? items.map((task) => taskItem(task, opts, true))
          : [el("div", { class: "quadrant-empty" }, "暂无任务")]),
      ),
    );
    board.append(cell);
  }
  return board;
}

function taskItem(
  t: Task,
  opts: RenderOpts,
  showDate = false,
  treeChildren?: Map<string, Task[]>,
  ancestors: ReadonlySet<string> = new Set(),
): HTMLElement {
  const today = fmtDate(new Date());
  const overdue = !t.done && t.date !== "" && t.date < today && t.kind !== "goal";
  const children = treeChildren?.get(t.id) || [];
  const meta: (Node | string | null)[] = [];
  const quadrant = taskQuadrant(t);
  meta.push(el("span", { class: `quadrant-chip quadrant-chip-${quadrant}` }, QUADRANT_META[quadrant].short));
  if (t.project_id && !treeChildren) {
    const project = opts.data.projects.find((item) => item.id === t.project_id);
    if (project) meta.push(el("span", { class: "project-chip" }, project.name));
  }
  if (t.parent_id && !treeChildren) {
    const parent = opts.data.tasks.find((item) => item.id === t.parent_id);
    if (parent) meta.push(el("span", { class: "task-parent-chip" }, `↳ ${parent.title}`));
  }
  if (showDate) meta.push(el("span", { class: "date-chip" }, t.date || "无目标日"));
  if (t.start) meta.push(el("span", { class: "time-chip" }, `◷ ${t.start}${t.end ? "–" + t.end : ""}`));
  if (t.remind_at) meta.push(el("span", { class: "remind-chip" }, `提醒 ${t.remind_at}`));
  if (t.repeat && t.repeat !== "none") {
    const labels = { daily: "每天", weekly: "每周", monthly: "每月" };
    meta.push(el("span", { class: "repeat-chip" }, labels[t.repeat]));
  }
  if (overdue) meta.push(el("span", { class: "overdue" }, "已逾期"));
  if (t.kind === "deadline" && t.date) {
    const n = daysUntil(t.date);
    const label = n === 0 ? "今天截止" : n === 1 ? "明天截止" : `剩 ${n} 天`;
    meta.push(el("span", { class: n <= 1 ? "overdue" : "kind-chip" }, `↘ ${label}`));
  }
  if (t.kind === "goal") {
    if (t.date) meta.push(el("span", { class: "kind-chip goal-chip" }, `◎ 目标日 ${t.date.slice(5)}`));
    else meta.push(el("span", { class: "kind-chip goal-chip" }, "◎ 长期"));
  }
  if (treeChildren && children.length) {
    const doneChildren = children.filter((child) => child.done).length;
    meta.push(el("span", { class: "subtask-chip" }, `子任务 ${doneChildren}/${children.length}`));
  }
  meta.push(...t.tags.map((tag) => el("span", { class: "tag-chip" }, tag)));

  const titleEl = el("div", { class: "task-title" }, t.title);
  const project = t.project_id ? opts.data.projects.find((item) => item.id === t.project_id) : undefined;
  let childTitle: HTMLInputElement | undefined;
  let childForm: HTMLFormElement | undefined;
  if (treeChildren && t.repeat === "none" && !project?.archived && !ancestors.has(t.id)) {
    childTitle = el("input", {
      type: "text",
      placeholder: "子任务名称",
      "aria-label": `为 ${t.title} 添加子任务`,
    });
    childForm = el("form", { class: "task-child-form", hidden: "" },
      childTitle,
      el("button", { type: "submit", class: "task-child-submit" }, "添加"),
      el("button", { type: "button", class: "task-child-cancel" }, "取消"),
    );
    childForm.querySelector<HTMLButtonElement>(".task-child-cancel")!.addEventListener("click", () => {
      childForm!.hidden = true;
      childTitle!.value = "";
    });
    childForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const title = childTitle!.value.trim();
      if (!title) {
        childTitle!.focus();
        return;
      }
      const args = ["task", "add", title, "--parent", t.id];
      if (t.date) args.push("--date", t.date);
      const result = await opts.onCall(args);
      if (result.ok) {
        childTitle!.value = "";
        childForm!.hidden = true;
      }
    });
  }
  const addChild = childForm
    ? el("button", {
        class: "task-child-add",
        type: "button",
        title: "添加子任务",
        "aria-label": `为 ${t.title} 添加子任务`,
        onclick: () => {
          childForm!.hidden = !childForm!.hidden;
          if (!childForm!.hidden) childTitle!.focus();
        },
      }, "+")
    : null;
  const item = el(
    "div",
    { class: `task-item pri-${t.priority}${t.done ? " done" : ""}` },
    el("button", {
      class: "task-check",
      title: t.done ? "标记未完成" : "完成",
      onclick: async () => {
        await opts.onCall(taskToggleArgs(t.id));
        window.__dailyflow.rerender();
      },
    }, t.done ? "✓" : ""),
    el("div", { class: "task-body" },
      titleEl,
      el("div", { class: "task-meta" }, ...meta),
      t.notes ? el("div", { class: "task-meta" }, t.notes) : null,
    ),
    el("button", {
      class: "task-edit",
      title: "编辑任务",
      "aria-label": `编辑 ${t.title}`,
      "data-focus-key": `task-edit-${t.id}`,
      onclick: () => openTaskEditor(t, opts),
    }, "编辑"),
    addChild,
    el("button", {
      class: "task-del",
      title: "删除",
      onclick: async () => {
        const res = await opts.onCall(taskDeleteArgs(t.id));
        if (res.ok) {
          window.__dailyflow.rerender();
          window.__dailyflow.undoToast("已删除任务", async () => {
            const restored = await opts.onCall(undoArgs(t.id));
            if (restored.ok) window.__dailyflow.rerender();
          });
        }
      },
    }, "✕"),
  );
  if (t.kind === "goal") item.classList.add("is-goal");
  if (t.kind === "deadline") item.classList.add("is-deadline");
  item.classList.add(`quadrant-${quadrant}`);

  // 双击标题 → 行内编辑（标题 + 时间），Enter 保存 / Esc 取消
  titleEl.addEventListener("dblclick", () => beginInlineEdit(titleEl, t, opts));
  titleEl.title = "双击编辑";

  if (!treeChildren) return item;
  if (ancestors.has(t.id)) return item;
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(t.id);
  const node = el("div", { class: `task-tree-node${children.length ? " has-children" : ""}` }, item);
  if (childForm) node.append(childForm);
  for (const child of children) {
    node.append(taskItem(child, opts, true, treeChildren, nextAncestors));
  }
  return node;
}

/** 双击行内编辑：标题输入框替换标题文本，可选时间输入框 */
function beginInlineEdit(titleEl: HTMLElement, t: Task, opts: RenderOpts): void {
  if (titleEl.querySelector("input")) return; // 已在编辑
  const old = t.title;
  const input = document.createElement("input");
  input.className = "task-inline-input";
  input.value = old;
  titleEl.replaceWith(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  let done = false;
  const finish = async (save: boolean) => {
    if (done) return;
    done = true;
    const val = input.value.trim();
    if (save && val && val !== old) {
      await opts.onCall(taskEditArgs(t.id, [["title", old, val]]));
    }
    window.__dailyflow.rerender();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.isComposing || e.keyCode === 229)) return;
    if (e.key === "Enter") void finish(true);
    else if (e.key === "Escape") void finish(false);
    e.stopPropagation();
  });
  input.addEventListener("blur", () => void finish(true));
}

function weekCal(data: Data, selected: string, today: string, opts: RenderOpts): HTMLElement {
  const base = new Date(selected + "T00:00:00");
  const monday = new Date(base);
  monday.setDate(base.getDate() - ((base.getDay() + 6) % 7));
  const grid = el("div", { class: "week-grid" });
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const ds = fmtDate(d);
    const dayTasks = data.tasks.filter((t) => t.date === ds);
    const cell = el(
      "button",
      {
        class: `week-day${ds === selected ? " selected" : ""}${ds === today ? " today" : ""}`,
        type: "button",
        "aria-pressed": String(ds === selected),
        "aria-label": `${ds}，${dayTasks.length} 项任务${ds === selected ? "，当前日期" : ""}`,
        onclick: () => opts.onSelectDate(ds),
      },
      el("span", { class: "wd" }, WD[d.getDay()].slice(1)),
      el("span", { class: "dn" }, String(d.getDate())),
      el("span", { class: "dots" },
        ...dayTasks.filter((t) => !t.done).slice(0, 4).map(() => el("span", { class: "dot" })),
        ...dayTasks.filter((t) => t.done).slice(0, 2).map(() => el("span", { class: "dot done-dot" })),
      ),
    );
    grid.append(cell);
  }
  // 选中日的月分标题（跨月导航时给用户方位感）
  const selMonth = `${base.getFullYear() % 100}年${base.getMonth() + 1}月`;
  return el(
    "div",
    { class: "week-cal" },
    el("div", { class: "week-cal-head" },
      el("div", { class: "panel-heading" },
        el("div", { class: "panel-eyebrow" }, "WEEK VIEW"),
        el("h3", {}, selMonth),
      ),
      el("button", {
        class: "week-nav",
        "aria-label": "上一周",
        title: "上一周（含更早日期）",
        onclick: () => {
          const d = new Date(selected + "T00:00:00");
          d.setDate(d.getDate() - 7);
          opts.onSelectDate(fmtDate(d));
        },
      }, "‹"),
      el("button", {
        class: "week-nav",
        "aria-label": "下一周",
        title: "下一周",
        onclick: () => {
          const d = new Date(selected + "T00:00:00");
          d.setDate(d.getDate() + 7);
          opts.onSelectDate(fmtDate(d));
        },
      }, "›"),
    ),
    grid,
  );
}
