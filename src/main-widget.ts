// 今日待办悬浮窗：URL ?view=widget
import { invoke } from "@tauri-apps/api/core";
import type { Data, Task } from "./types.ts";

export {};

const WD = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

interface WidgetData {
  tasks: Task[];
  done: number;
  total: number;
}

let listEl: HTMLElement;
let footEl: HTMLElement;
let summaryEl: HTMLElement;
let addInput: HTMLInputElement;
let headSub: HTMLElement;
let currentData: WidgetData = { tasks: [], done: 0, total: 0 };
let saving = false;

window.addEventListener("DOMContentLoaded", () => {
  document.body.dataset.view = "widget";
  build();
  void reload();
  window.setInterval(reload, 5000);

  // 后端推送
  // @ts-expect-error Tauri event API
  const { listen } = window.__TAURI__.event;
  listen("data-changed", (evt: { payload: Data }) => {
    apply(evt.payload);
  });
});

async function reload() {
  if (saving) return; // 避免保存中覆盖输入
  const d = await invoke<Data>("fe_load");
  apply(d);
}

function apply(d: Data) {
  const today = todayStr();
  // 今日任务（normal/deadline 到期日）+ 3 天内将到期的截止任务（长期目标不进悬浮窗，避免噪音）
  const tasks = d.tasks
    .filter((t) => t.date === today && t.kind !== "goal")
    .sort((a, b) => (a.start ?? "99:99").localeCompare(b.start ?? "99:99") || a.id.localeCompare(b.id));
  const deadlinesSoon = d.tasks
    .filter((t) => t.kind === "deadline" && !t.done && t.date > today && t.date <= plusDays(today, 3))
    .sort((a, b) => a.date.localeCompare(b.date));
  const all = [...tasks, ...deadlinesSoon];
  currentData = { tasks: all, done: tasks.filter((t) => t.done).length, total: tasks.length };
  render();
  document.documentElement.dataset.theme = d.settings.theme === "light" ? "light" : "dark";
}

function plusDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function build() {
  const app = document.getElementById("app")!;

  // 头部（拖拽区）
  const now = new Date();
  const head = document.createElement("div");
  head.className = "widget-head";
  const dateEl = document.createElement("span");
  dateEl.className = "w-date";
  dateEl.textContent = `${now.getMonth() + 1}/${now.getDate()}`;
  headSub = document.createElement("span");
  headSub.className = "w-sub";
  headSub.textContent = WD[now.getDay()];
  const sp = document.createElement("span");
  sp.className = "spacer";

  const pinBtn = mkBtn("📌", "置顶开关", async () => {
    const pinned = !pinBtn.classList.contains("pinned");
    pinBtn.classList.toggle("pinned", pinned);
    await invoke("fe_widget_pin", { pinned });
  });
  const mainBtn = mkBtn("⤢", "打开主窗口", () => invoke("fe_show_main", {}));
  const closeBtn = mkBtn("✕", "隐藏悬浮窗", async () => {
    await invoke("fe_widget_close", {});
  });
  head.append(dateEl, headSub, sp, pinBtn, mainBtn, closeBtn);
  head.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).closest(".widget-btn")) return;
    invoke("fe_widget_drag", {});
    savePosSoon();
  });

  listEl = document.createElement("div");
  listEl.className = "widget-list";

  // 底部：快速添加 + 摘要
  footEl = document.createElement("div");
  footEl.className = "w-foot";
  addInput = document.createElement("input");
  addInput.placeholder = "＋ 添加待办（9:30 开会）";
  addInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void quickAdd();
  });
  const addBtn = document.createElement("button");
  addBtn.textContent = "＋";
  addBtn.title = "添加";
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
    window.__TAURI__.window.getCurrentWindow().startResizeDragging(2); // 2 = East? 实际枚举见下
  });

  const wrap = document.createElement("div");
  wrap.className = "widget";
  wrap.append(head, listEl, footEl);
  app.append(wrap, resize);

  // 置顶状态初始化
  invoke<{ settings: { widget_pinned: boolean } }>("fe_load").then((d) => {
    pinBtn.classList.toggle("pinned", d.settings.widget_pinned);
  });

  // 周期性保存位置
  window.setInterval(savePos, 4000);
  window.addEventListener("resize", savePos);

  async function quickAdd() {
    const raw = addInput.value.trim();
    if (!raw) return;
    // 简易解析 "9:30 开会" / "930 开会" / "下午3 体检"
    const m = raw.match(/^(\d{1,2}(?::?\d{2})?|上午\d{1,2}|下午\d{1,2}|晚上\d{1,2})\s+(.+)$/);
    let args: string[];
    if (m) {
      args = ["task", "add", m[2], "--start", m[1]];
    } else {
      args = ["task", "add", raw];
    }
    const res = await invoke<{ ok: boolean; error?: string }>("fe_call", { args });
    if (!res.ok) {
      // 时间解析失败则去掉时间重试
      args = ["task", "add", raw];
      await invoke("fe_call", { args });
    }
    addInput.value = "";
    await reload();
  }

  let posT: number | undefined;
  let lastSavedPos = "";
  function savePosSoon() {
    window.clearTimeout(posT);
    posT = window.setTimeout(savePos, 600);
  }
  async function savePos() {
    // @ts-expect-error Tauri window API
    const win = window.__TAURI__.window.getCurrentWindow();
    const pos = await win.outerPosition();
    const f = await win.scaleFactor();
    // outerPosition 返回物理像素，需整体除以缩放得到逻辑坐标
    const x = Math.round(pos.x / f);
    const y = Math.round(pos.y / f);
    // 位置没变就不写盘：避免 mtime 抖动触发主窗口无谓重渲染
    const key = `${x},${y}`;
    if (key === lastSavedPos) return;
    lastSavedPos = key;
    await invoke("fe_widget_set_pos", { x, y });
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
  const { tasks, done, total } = currentData;
  listEl.innerHTML = "";
  if (!tasks.length) {
    listEl.append(
      el("div", { class: "w-empty" }, el("div", { class: "big" }, "🌤"), "今天没有安排", el("div", {}, "下方输入框快速添加")),
    );
  } else {
    for (const t of tasks) listEl.append(taskRow(t));
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
    headSub.textContent = `${WD[now.getDay()]}${total ? ` · ${done}/${total}` : ""}`;
  }
}

function taskRow(t: Task): HTMLElement {
  const row = el("div", { class: `w-task${t.done ? " done" : ""}` });
  const pri = document.createElement("span");
  pri.className = `w-pri${t.priority === "high" ? " high" : t.priority === "low" ? " low" : ""}`;
  const check = document.createElement("button");
  check.className = "w-check";
  check.textContent = t.done ? "✓" : "";
  check.addEventListener("click", async (e) => {
    e.stopPropagation();
    saving = true;
    try {
      await invoke("fe_call", { args: ["task", "toggle", t.id] });
    } finally {
      saving = false;
    }
    await reload();
  });
  const body = el("div", { class: "w-body" });
  const title = el("div", { class: "w-title" }, t.title);
  body.append(title);
  if (t.start) body.append(el("div", { class: "w-time" }, `🕐 ${t.start}${t.end ? "–" + t.end : ""}`));
  if (t.kind === "deadline" && t.date && t.date !== todayStr()) {
    body.append(el("div", { class: "w-time" }, `⏳ ${t.date.slice(5)} 截止`));
  }
  row.append(pri, check, body);
  return row;
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
