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
let taskView: "day" | "all" | "open" | "done" | "matrix" = "day";

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
  const searchInput = el("input", { class: "task-search", type: "search", placeholder: "搜索任务", "aria-label": "搜索所有任务" });
  searchInput.value = taskSearch;
  const viewSelect = document.createElement("select");
  viewSelect.className = "task-view-select";
  viewSelect.setAttribute("aria-label", "筛选任务");
  for (const [value, label] of [["day", "当前日期"], ["all", "全部任务"], ["open", "未完成"], ["done", "已完成"], ["matrix", "四象限"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    viewSelect.append(option);
  }
  viewSelect.value = taskView;
  const countBadge = el("span", { class: "count-badge" }, String(openCount));
  const sectionTitle = el("h2", {}, taskView === "matrix" ? "四象限" : "日程与待办");
  const refreshTaskList = () => {
    if (taskView === "matrix") {
      const query = taskSearch.trim().toLocaleLowerCase();
      const matches = data.tasks
        .filter((task) => !task.done)
        .filter((task) => !query || [task.title, task.notes, task.date, ...task.tags].some((value) => value.toLocaleLowerCase().includes(query)))
        .sort((a, b) => taskQuadrant(a).localeCompare(taskQuadrant(b)) || (a.date || "9999").localeCompare(b.date || "9999") || a.id.localeCompare(b.id));
      countBadge.textContent = String(matches.length);
      listEl.replaceChildren(matrixBoard(matches, opts));
      return;
    }
    if (taskView === "day" && !taskSearch.trim()) {
      listEl.replaceChildren(...defaultItems);
      countBadge.textContent = String(openCount);
      return;
    }
    const query = taskSearch.trim().toLocaleLowerCase();
    const matches = data.tasks
      .filter((task) => (taskView !== "open" || !task.done) && (taskView !== "done" || task.done))
      .filter((task) => !query || [task.title, task.notes, task.date, ...task.tags].some((value) => value.toLocaleLowerCase().includes(query)))
      .sort((a, b) => Number(a.done) - Number(b.done) || (a.date || "9999").localeCompare(b.date || "9999") || a.id.localeCompare(b.id));
    countBadge.textContent = String(matches.length);
    listEl.replaceChildren(...(matches.length
      ? matches.map((task) => taskItem(task, opts, true))
      : [el("div", { class: "empty-state" }, el("div", { class: "empty-title" }, "没有符合条件的任务"))]));
  };
  searchInput.addEventListener("input", () => {
    taskSearch = searchInput.value;
    if (taskSearch.trim() && taskView === "day") {
      taskView = "all";
      viewSelect.value = "all";
    }
    refreshTaskList();
  });
  viewSelect.addEventListener("change", () => {
    taskView = viewSelect.value as typeof taskView;
    sectionTitle.textContent = taskView === "matrix" ? "四象限" : "日程与待办";
    if (taskView === "day") {
      taskSearch = "";
      searchInput.value = "";
    }
    refreshTaskList();
  });
  refreshTaskList();
  const tasksCol = el(
    "div",
    { class: "tasks-col" },
    el("div", { class: "workspace-intro" },
      el("div", { class: "section-kicker" }, today === selectedDate ? "WORKSPACE / TODAY" : "WORKSPACE / SCHEDULE"),
      el("div", { class: "workspace-title-row" },
        el("h1", { class: "workspace-title" }, today === selectedDate ? "今天的节奏" : "这一天的安排"),
        el("span", { class: "workspace-date" }, selectedDate.slice(5).replace("-", " / ")),
      ),
      el("p", { class: "workspace-subtitle" }, openCountText(dayTasks)),
    ),
    statCards(data, today),
    el("div", { class: "section-head" },
      sectionTitle,
      countBadge,
      el("div", { class: "spacer" }),
      selectedDate !== today
        ? el("button", { class: "mini-btn", onclick: () => opts.onSelectDate(today) }, "← 回到今天")
        : null,
      el("button", { class: "mini-btn", onclick: async () => {
        const result = await opts.onCall(taskClearDoneArgs(selectedDate));
        if (!result.ok) return;
        const data = result.data as { removed?: number; deleted_ids?: string[] } | undefined;
        const removed = Number(data?.removed || 0);
        const deletedIds = data?.deleted_ids || [];
        window.__dailyflow.rerender();
        if (removed > 0) {
          window.__dailyflow.undoToast(`已清理 ${removed} 项`, async () => {
            const restored = await opts.onCall(undoArgs(...deletedIds));
            if (restored.ok) window.__dailyflow.rerender();
          });
        }
      } }, "清理已完成"),
    ),
    el("div", { class: "task-tools" }, searchInput, viewSelect),
    listEl,
  );

  // ===== 右列 =====
  const sideCol = el(
    "div",
    { class: "side-col" },
    weekCal(data, selectedDate, today, opts),
    quickAdd(opts, selectedDate),
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

function taskItem(t: Task, opts: RenderOpts, showDate = false): HTMLElement {
  const today = fmtDate(new Date());
  const overdue = !t.done && t.date !== "" && t.date < today && t.kind !== "goal";
  const meta: (Node | string | null)[] = [];
  const quadrant = taskQuadrant(t);
  meta.push(el("span", { class: `quadrant-chip quadrant-chip-${quadrant}` }, QUADRANT_META[quadrant].short));
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
  meta.push(...t.tags.map((tag) => el("span", { class: "tag-chip" }, tag)));

  const titleEl = el("div", { class: "task-title" }, t.title);
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
  return item;
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
