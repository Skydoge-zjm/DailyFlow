// 今日待办悬浮窗：URL ?view=widget
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { applyTheme } from "./themes.ts";
import type { Data, Task } from "./types.ts";

export {};

const WD = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

interface WidgetData {
  overdue: Task[];
  moreOverdue: Task[];
  tasks: Task[];
  completed: Task[];
  deadlines: Task[];
  moreDeadlines: Task[];
  goals: Task[];
  moreGoals: Task[];
  done: number;
  total: number;
}

let listEl: HTMLElement;
let footEl: HTMLElement;
let summaryEl: HTMLElement;
let addInput: HTMLInputElement;
let headSub: HTMLElement;
let dateEl: HTMLElement;
let currentData: WidgetData = {
  overdue: [], moreOverdue: [], tasks: [], completed: [], deadlines: [],
  moreDeadlines: [], goals: [], moreGoals: [], done: 0, total: 0,
};
let saving = false;
let closeActiveTaskMenu: (() => void) | undefined;
let toastTimer: number | undefined;
let completedExpanded = false;
let moreOverdueExpanded = false;
let moreDeadlinesExpanded = false;
let moreGoalsExpanded = false;
let dataRevision = 0;
let reloadGeneration = 0;
let loadErrorShown = false;

window.addEventListener("DOMContentLoaded", () => {
  if (new URLSearchParams(location.search).get("view") !== "widget") return;
  document.body.dataset.view = "widget";
  document.documentElement.dataset.view = "widget";
  build();
  void reload();
  window.setInterval(reload, 5000);

  // 后端推送
  // @ts-expect-error Tauri event API
  const { listen } = window.__TAURI__.event;
  listen("data-changed", (evt: { payload: Data }) => {
    dataRevision += 1;
    reloadGeneration += 1;
    apply(evt.payload);
  });
});

async function reload() {
  if (saving) return; // 避免保存中覆盖输入
  const generation = ++reloadGeneration;
  const revision = dataRevision;
  try {
    const d = await invoke<Data>("fe_load");
    if (generation === reloadGeneration && revision === dataRevision) {
      loadErrorShown = false;
      apply(d);
    }
  } catch (error) {
    if (generation !== reloadGeneration || revision !== dataRevision) return;
    console.error("读取 DailyFlow 数据失败", error);
    if (!loadErrorShown) {
      loadErrorShown = true;
      showWidgetToast("读取数据失败，请检查数据文件后重试");
    }
  }
}

function apply(d: Data) {
  const today = todayStr();
  const todayItems = d.tasks
    .filter((t) => t.date === today && t.kind !== "goal")
    .sort((a, b) => (a.start ?? "99:99").localeCompare(b.start ?? "99:99") || a.id.localeCompare(b.id));
  const overdueItems = d.tasks
    .filter((t) => !t.done && t.kind !== "goal" && t.date !== "" && t.date < today)
    .sort((a, b) => a.date.localeCompare(b.date) || priorityRank(b) - priorityRank(a) || (a.start ?? "99:99").localeCompare(b.start ?? "99:99"));
  const futureDeadlines = d.tasks
    .filter((t) => t.kind === "deadline" && !t.done && t.date > today)
    .sort((a, b) => a.date.localeCompare(b.date) || priorityRank(b) - priorityRank(a) || a.id.localeCompare(b.id));
  const nearDeadlineHorizon = dateOffset(today, 7);
  const nearDeadlines = futureDeadlines.filter((t) => t.date <= nearDeadlineHorizon);
  const laterDeadlines = futureDeadlines.filter((t) => t.date > nearDeadlineHorizon);
  const openGoals = d.tasks
    .filter((t) => t.kind === "goal" && !t.done)
    .sort((a, b) => (a.date || "9999-99-99").localeCompare(b.date || "9999-99-99") || priorityRank(b) - priorityRank(a) || a.id.localeCompare(b.id));
  currentData = {
    overdue: overdueItems.slice(0, 3),
    moreOverdue: overdueItems.slice(3),
    tasks: todayItems.filter((t) => !t.done),
    completed: todayItems.filter((t) => t.done),
    deadlines: nearDeadlines.slice(0, 3),
    moreDeadlines: [...nearDeadlines.slice(3), ...laterDeadlines],
    goals: openGoals.slice(0, 3),
    moreGoals: openGoals.slice(3),
    done: todayItems.filter((t) => t.done).length,
    total: todayItems.length,
  };
  render();
  applyTheme(d.settings.theme_preset || "classic-dark", d.settings.theme === "light", d.settings.theme_overrides || {});
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateOffset(dateString: string, days: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseQuickAdd(input: string): { title: string; date?: string; start?: string } {
  const raw = input.trim();
  let text = raw;
  let date: string | undefined;
  const dateMatch = raw.match(/^(后天|明天|明日|今天|昨天|today|tomorrow|tmr|yesterday|[+-]\d+|周[一二三四五六日天]|星期[一二三四五六日天]|mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday|\d{4}-\d{2}-\d{2})(?=\s|$|(?=(?:上午|下午|晚上)?\d)|(?=[\u3400-\u9fff]))/i);
  if (dateMatch) {
    date = dateMatch[1] === "后天" ? "+2" : dateMatch[1];
    text = raw.slice(dateMatch[0].length).trimStart();
  }

  const timeMatch = text.replace(/：/g, ":").match(/^(上午|下午|晚上)?\s*(\d{1,2}:\d{1,2}|\d{3,4}|\d{1,2}点(?:半|一刻|\d{1,2})?|\d{1,2})(.*)$/);
  if (timeMatch) {
    const token = timeMatch[2];
    const rest = timeMatch[3];
    const hasSeparator = /^\s+/.test(rest);
    const compactTime = token.includes(":") || /^\d{3,4}$/.test(token) || token.includes("点");
    if (rest.trim() && (hasSeparator || compactTime)) {
      let time = token
        .replace(/点半/, ":30")
        .replace(/点一刻/, ":15")
        .replace(/点/, ":");
      if (time.endsWith(":")) time += "00";
      return { title: rest.trim(), date, start: `${timeMatch[1] || ""}${time}` };
    }
  }

  return { title: text, date };
}

function priorityRank(task: Task): number {
  return task.priority === "high" ? 2 : task.priority === "low" ? 0 : 1;
}

function build() {
  const app = document.getElementById("app")!;

  // 头部（拖拽区）
  const now = new Date();
  const head = document.createElement("div");
  head.className = "widget-head";
  dateEl = document.createElement("span");
  dateEl.className = "w-date";
  dateEl.textContent = `${now.getMonth() + 1}/${now.getDate()}`;
  headSub = document.createElement("span");
  headSub.className = "w-sub";
  headSub.textContent = WD[now.getDay()];
  const sp = document.createElement("span");
  sp.className = "spacer";
  const liveDot = document.createElement("span");
  liveDot.className = "widget-live-dot";
  liveDot.title = "实时同步中";
  const headStack = document.createElement("div");
  headStack.className = "widget-head-stack";
  headStack.append(dateEl, headSub);

  const pinBtn = mkBtn("📌", "置顶开关", async () => {
    const pinned = !pinBtn.classList.contains("pinned");
    try {
      await invoke("fe_widget_pin", { pinned });
      pinBtn.classList.toggle("pinned", pinned);
    } catch {
      // Keep the visual state aligned with the persisted setting.
    }
  });
  const mainBtn = mkBtn("⤢", "打开主窗口", () => invoke("fe_show_main", {}));
  const closeBtn = mkBtn("✕", "隐藏悬浮窗", async () => {
    await flushBoundsSave();
    await invoke("fe_widget_close", {});
  });
  head.append(liveDot, headStack, sp, pinBtn, mainBtn, closeBtn);
  head.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).closest(".widget-btn")) return;
    invoke("fe_widget_drag", {});
  });

  listEl = document.createElement("div");
  listEl.className = "widget-list";

  // 底部：快速添加 + 摘要
  footEl = document.createElement("div");
  footEl.className = "w-foot";
  addInput = document.createElement("input");
  addInput.placeholder = "添加待办 · 明天 9:30 开会";
  addInput.setAttribute("aria-label", "快速添加待办");
  addInput.addEventListener("input", () => addInput.setCustomValidity(""));
  addInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      void quickAdd();
    }
  });
  const addBtn = document.createElement("button");
  addBtn.textContent = "＋";
  addBtn.title = "添加";
  addBtn.setAttribute("aria-label", "添加待办");
  addBtn.addEventListener("click", () => void quickAdd());
  const row = document.createElement("div");
  row.className = "w-addrow";
  row.append(addInput, addBtn);
  summaryEl = document.createElement("div");
  summaryEl.className = "w-summary";
  footEl.append(row, summaryEl);

  const resize = document.createElement("div");
  resize.className = "widget-resize";
  resize.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    // @ts-expect-error Tauri window API
    window.__TAURI__.window.getCurrentWindow().startResizeDragging('SouthEast');
  });

  const wrap = document.createElement("div");
  wrap.className = "widget";
  wrap.append(head, listEl, footEl);
  app.append(wrap, resize);

  // 置顶状态初始化
  invoke<{ settings: { widget_pinned: boolean } }>("fe_load").then((d) => {
    pinBtn.classList.toggle("pinned", d.settings.widget_pinned);
  }).catch(() => showWidgetToast("读取悬浮窗设置失败"));

  const nativeWindow = getCurrentWindow();
  void nativeWindow.onMoved(scheduleBoundsSave).catch(() => undefined);
  void nativeWindow.onResized(scheduleBoundsSave).catch(() => undefined);

  async function quickAdd() {
    const raw = addInput.value.trim();
    if (!raw || saving) return;
    const parsed = parseQuickAdd(raw);
    if (!parsed.title) {
      addInput.setCustomValidity("请输入待办内容");
      addInput.reportValidity();
      return;
    }
    const args = ["task", "add", parsed.title];
    if (parsed.date) args.push("--date", parsed.date);
    if (parsed.start) args.push("--start", parsed.start);

    saving = true;
    try {
      const result = await invoke<{ ok: boolean; error?: string }>("fe_call", { args });
      if (!result.ok) {
        addInput.setCustomValidity(result.error || "添加失败，请检查输入");
        addInput.reportValidity();
        return;
      }
      addInput.value = "";
      addInput.setCustomValidity("");
    } catch {
      addInput.setCustomValidity("添加失败，输入已保留，请重试");
      addInput.reportValidity();
      return;
    } finally {
      saving = false;
    }
    await reload();
  }

  let boundsSaveTimer: number | undefined;
  let lastSavedBounds = "";
  let boundsSaveChain: Promise<void> = Promise.resolve();
  function scheduleBoundsSave() {
    window.clearTimeout(boundsSaveTimer);
    boundsSaveTimer = window.setTimeout(() => {
      boundsSaveTimer = undefined;
      void saveBounds();
    }, 350);
  }
  async function flushBoundsSave() {
    window.clearTimeout(boundsSaveTimer);
    boundsSaveTimer = undefined;
    await saveBounds();
  }
  function saveBounds(): Promise<void> {
    boundsSaveChain = boundsSaveChain.then(persistBounds);
    return boundsSaveChain;
  }
  async function persistBounds(): Promise<void> {
    try {
      const [position, size, monitor] = await Promise.all([
        nativeWindow.outerPosition(),
        nativeWindow.innerSize(),
        currentMonitor(),
      ]);
      const scale = monitor?.scaleFactor || await nativeWindow.scaleFactor();
      const workAreaPosition = monitor?.workArea.position ?? { x: 0, y: 0 };
      const x = Math.round((position.x - workAreaPosition.x) / scale);
      const y = Math.round((position.y - workAreaPosition.y) / scale);
      const w = Math.round(size.width / scale);
      const h = Math.round(size.height / scale);
      const monitorId = monitor?.name?.trim() || (monitor ? `@${monitor.position.x},${monitor.position.y}` : "");
      const key = `${monitorId}|${x},${y},${w},${h}`;
      if (key === lastSavedBounds) return;
      await invoke("fe_widget_set_pos", { x, y, w, h, monitor: monitorId });
      lastSavedBounds = key;
    } catch {
      showWidgetToast("悬浮窗位置保存失败");
    }
  }

  function mkBtn(text: string, title: string, fn: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "widget-btn";
    b.textContent = text;
    b.title = title;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      fn();
    });
    return b;
  }
}

function render() {
  dismissTaskMenu();
  const { overdue, moreOverdue, tasks, completed, deadlines, moreDeadlines, goals, moreGoals, done, total } = currentData;
  listEl.innerHTML = "";
  if (!overdue.length && !moreOverdue.length && !tasks.length && !completed.length && !deadlines.length && !moreDeadlines.length && !goals.length && !moreGoals.length) {
    listEl.append(
      el("div", { class: "w-empty" }, el("div", { class: "big" }, "—"), el("strong", {}, "今天没有安排"), el("div", {}, "在下方捕捉一项计划")),
    );
  } else {
    if (overdue.length) {
      listEl.append(groupLabel("逾期", overdue.length, "w-group-overdue"));
      appendRows(overdue);
    }
    if (moreOverdue.length) {
      appendCollapsedGroup("更多逾期", moreOverdue, moreOverdueExpanded, (expanded) => { moreOverdueExpanded = expanded; }, "w-group-overdue");
    }
    if (tasks.length) {
      listEl.append(groupLabel("今日待办", tasks.length, ""));
      appendRows(tasks);
    }
    if (deadlines.length) {
      listEl.append(groupLabel("近期截止", deadlines.length, "w-group-deadline"));
      appendRows(deadlines);
    }
    if (moreDeadlines.length) {
      appendCollapsedGroup("更多截止", moreDeadlines, moreDeadlinesExpanded, (expanded) => { moreDeadlinesExpanded = expanded; }, "w-group-deadline");
    }
    if (goals.length) {
      listEl.append(groupLabel("长期目标", goals.length, "w-group-goal"));
      appendRows(goals);
    }
    if (moreGoals.length) {
      appendCollapsedGroup("更多目标", moreGoals, moreGoalsExpanded, (expanded) => { moreGoalsExpanded = expanded; }, "w-group-goal");
    }
    if (completed.length) {
      appendCollapsedGroup("已完成", completed, completedExpanded, (expanded) => { completedExpanded = expanded; }, "w-group-completed");
    }
  }
  const pct = total ? Math.round((done / total) * 100) : 0;
  summaryEl.innerHTML = "";
  const bar = document.createElement("span");
  bar.className = "bar";
  const fill = document.createElement("i");
  fill.style.width = `${pct}%`;
  bar.append(fill);
  summaryEl.append(el("span", {}, `${done}/${total}`), bar, el("span", {}, `${pct}%`));
  if (headSub) {
    const now = new Date();
    headSub.textContent = `${WD[now.getDay()]}${total ? ` · ${done}/${total} 完成` : " · 空闲"}`;
  }
  if (dateEl) {
    // 跨天自动更新头部日期
    const now = new Date();
    dateEl.textContent = `${now.getMonth() + 1}/${now.getDate()}`;
  }
}

function appendRows(tasks: Task[]): void {
  appendRowsTo(listEl, tasks);
}

function appendRowsTo(target: HTMLElement, tasks: Task[]): void {
  for (const task of tasks) target.append(taskRow(task));
}

function appendCollapsedGroup(
  label: string,
  tasks: Task[],
  expanded: boolean,
  setExpanded: (expanded: boolean) => void,
  tone: string,
): void {
  const section = document.createElement("div");
  section.className = "w-collapsible-group";
  const items = document.createElement("div");
  items.className = "w-group-items";
  items.hidden = !expanded;
  const button = groupToggle(label, tasks.length, expanded, tone);
  let nextIndex = 0;
  let frame: number | undefined;

  const appendBatch = () => {
    frame = undefined;
    if (items.hidden || !items.isConnected) return;
    const batch = document.createDocumentFragment();
    const end = Math.min(nextIndex + 40, tasks.length);
    for (; nextIndex < end; nextIndex++) batch.append(taskRow(tasks[nextIndex]));
    items.append(batch);
    if (nextIndex < tasks.length) frame = requestAnimationFrame(appendBatch);
  };

  button.addEventListener("click", () => {
    expanded = !expanded;
    setExpanded(expanded);
    button.classList.toggle("expanded", expanded);
    button.setAttribute("aria-expanded", String(expanded));
    items.hidden = !expanded;
    if (expanded && nextIndex < tasks.length && frame === undefined) {
      frame = requestAnimationFrame(appendBatch);
    } else if (!expanded && frame !== undefined) {
      cancelAnimationFrame(frame);
      frame = undefined;
    }
  });

  section.append(button, items);
  listEl.append(section);
  if (expanded) appendBatch();
}

function groupLabel(label: string, count: number, tone: string): HTMLElement {
  return el("div", { class: `w-group ${tone}` },
    el("span", { class: "w-group-rule", "aria-hidden": "true" }),
    el("span", {}, label),
    el("strong", {}, String(count)),
  );
}

function groupToggle(label: string, count: number, expanded: boolean, tone: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `w-group w-group-toggle ${tone}${expanded ? " expanded" : ""}`;
  button.setAttribute("aria-expanded", String(expanded));
  button.append(
    el("span", { class: "w-group-rule", "aria-hidden": "true" }),
    el("span", {}, label),
    el("strong", {}, String(count)),
    el("span", { class: "w-group-caret", "aria-hidden": "true" }),
  );
  return button;
}

function taskRow(t: Task): HTMLElement {
  const isGoal = t.kind === "goal";
  const isDeadline = t.kind === "deadline";
  const quadrant = t.quadrant || "q2";
  const row = el("div", { class: `w-task w-q-${quadrant}${t.done ? " done" : ""}${isGoal ? " is-goal" : ""}${isDeadline ? " is-deadline" : ""}` });
  const pri = document.createElement("span");
  pri.className = `w-pri${t.priority === "high" ? " high" : t.priority === "low" ? " low" : ""}`;
  const body = el("div", { class: "w-body" });
  const title = el("div", { class: "w-title" }, t.title);
  title.title = t.title;
  const meta = el("div", { class: "w-meta" });
  meta.append(el("span", { class: `w-quad w-quad-${quadrant}` }, quadrant.toUpperCase()));
  if (t.start) meta.append(el("span", { class: "w-time" }, `${t.start}${t.end ? "–" + t.end : ""}`));
  if (isDeadline && t.date && t.date !== todayStr()) {
    meta.append(el("span", { class: "w-time w-deadline" }, `${t.date.slice(5)} 截止`));
  }
  if (isGoal) {
    meta.append(el("span", { class: "w-time w-goal" }, t.date ? `目标日 ${t.date.slice(5)}` : "长期"));
  }
  if (t.repeat && t.repeat !== "none") {
    const repeatLabel = { daily: "每天", weekly: "每周", monthly: "每月" }[t.repeat];
    meta.append(el("span", { class: "w-time w-repeat" }, repeatLabel));
  }
  body.append(title, meta);
  row.append(pri, body);
  row.tabIndex = 0;
  row.title = "右键打开操作菜单";
  row.setAttribute("aria-haspopup", "menu");
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    showTaskMenu(t, event.clientX, event.clientY);
  });
  row.addEventListener("keydown", (event) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    const bounds = row.getBoundingClientRect();
    showTaskMenu(t, bounds.left + 12, bounds.top + Math.min(bounds.height, 24));
  });
  return row;
}

function dismissTaskMenu(): void {
  closeActiveTaskMenu?.();
}

function showTaskMenu(task: Task, x: number, y: number): void {
  dismissTaskMenu();
  const menu = document.createElement("div");
  menu.className = "widget-context-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `任务操作：${task.title}`);

  const close = () => {
    menu.remove();
    document.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("keydown", onKeyDown);
    if (closeActiveTaskMenu === close) closeActiveTaskMenu = undefined;
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!menu.contains(event.target as Node)) close();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };
  const action = (label: string, run: () => void | Promise<void>, danger = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `widget-menu-item${danger ? " danger" : ""}`;
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    button.addEventListener("click", () => {
      close();
      void Promise.resolve(run()).catch(() => showWidgetToast("操作失败，请稍后重试"));
    });
    menu.append(button);
  };

  action(task.done ? "取消完成" : "标记完成", async () => {
    await runTaskAction(["task", task.done ? "undone" : "done", task.id]);
  });
  action("编辑", async () => {
    try {
      await invoke("fe_show_main", {});
      await emitTo("main", "widget-edit-task", { id: task.id });
    } catch {
      showWidgetToast("无法打开任务编辑");
    }
  });
  const divider = document.createElement("div");
  divider.className = "widget-menu-divider";
  divider.setAttribute("role", "separator");
  menu.append(divider);
  action("删除", async () => {
    if (await runTaskAction(["task", "delete", task.id])) {
      showWidgetToast("已删除任务", async () => {
        if (await runTaskAction(["undo", task.id])) showWidgetToast("已撤销删除");
      });
    }
  }, true);

  document.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
  closeActiveTaskMenu = close;
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("keydown", onKeyDown);
  requestAnimationFrame(() => menu.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }));
}

async function runTaskAction(args: string[]): Promise<boolean> {
  if (saving) {
    showWidgetToast("正在保存，请稍后重试");
    return false;
  }
  saving = true;
  let result: { ok: boolean; error?: string };
  try {
    result = await invoke<{ ok: boolean; error?: string }>("fe_call", { args });
  } catch {
    saving = false;
    showWidgetToast("操作失败，请稍后重试");
    return false;
  }
  saving = false;
  if (!result.ok) {
    showWidgetToast(result.error || "操作失败");
    return false;
  }
  await reload();
  return true;
}

function showWidgetToast(message: string, onUndo?: () => Promise<void>): void {
  document.querySelector(".widget-toast")?.remove();
  window.clearTimeout(toastTimer);
  const toast = document.createElement("div");
  toast.className = "widget-toast";
  const text = document.createElement("span");
  text.textContent = message;
  toast.append(text);
  if (onUndo) {
    const undo = document.createElement("button");
    undo.type = "button";
    undo.textContent = "撤销";
    undo.addEventListener("click", () => {
      undo.disabled = true;
      toast.remove();
      void onUndo();
    });
    toast.append(undo);
  }
  document.body.append(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  toastTimer = window.setTimeout(() => toast.remove(), onUndo ? 5000 : 2600);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) {
    if (c == null) continue;
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}
