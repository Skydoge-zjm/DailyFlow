// 主窗口 UI 渲染（无框架，纯 DOM）
import type { Task } from "./types.ts";
import { el, taskQuadrant, type RenderOpts } from "./ui-shared.ts";
import { taskClearDoneArgs, undoArgs } from "./cli-args.ts";
import { openTaskEditor } from "./task-editor.ts";
import { quickAdd } from "./quick-add.ts";
import { notesPanel } from "./notes-panel.ts";
import { openThemePanel } from "./theme-panel.ts";
import { openCliPathPanel } from "./cli-path-panel.ts";
import { renderProjectsBoard, type TaskFilter } from "./ui-projects.ts";
import { renderMatrixBoard } from "./ui-matrix.ts";
import { statCards, dayProgress, buildRing } from "./ui-metrics.ts";
import { taskItem } from "./ui-task-card.ts";
import { weekCal } from "./ui-calendar.ts";
import { openExportPanel } from "./export-panel.ts";

export { el, openTaskEditor };
export type { RenderOpts };

const WD = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
let taskSearch = "";
type WorkspaceMode = "day" | "projects" | "matrix";
let taskView: WorkspaceMode = "day";
let taskFilter: TaskFilter = "all";
let showArchivedProjects = false;

export function handleWorkspaceShortcut(index: number): void {
  const modes: WorkspaceMode[] = ["day", "projects", "matrix"];
  const next = modes[index - 1];
  if (!next) return;
  taskView = next;
  taskSearch = "";
  window.__dailyflow?.rerender();
}

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
      el("button", { class: "icon-btn action-btn", title: "导出工作区", "aria-label": "导出工作区", onclick: () => openExportPanel(data) },
        el("span", { class: "btn-glyph", "aria-hidden": "true" }, "↓"),
        el("span", { class: "btn-label" }, "导出"),
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
  const viewTitle = () => taskView === "matrix" ? "任务分布" : taskView === "projects" ? "项目目录" : "时间安排";
  const sectionTitle = el("h2", {}, viewTitle());
  const refreshTaskList = () => {
    if (taskView === "projects") {
      const board = renderProjectsBoard(data, opts, taskSearch, taskFilter, showArchivedProjects, () => { showArchivedProjects = !showArchivedProjects; window.__dailyflow.rerender(); }, taskItem);
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
      listEl.replaceChildren(renderMatrixBoard(matches, opts, taskItem));
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
    el("span", { class: `status-indicator${opts.syncStatus.state === "retrying" ? " retrying" : ""}`, "aria-hidden": "true" }),
    el("span", { class: "status-label", role: "status", title: opts.syncStatus.message || "" }, opts.syncStatus.state === "retrying" ? `同步失败，正在重试（第 ${opts.syncStatus.attempt} 次）` : "已同步"),
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
