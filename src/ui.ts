// 主窗口 UI 渲染（无框架，纯 DOM）
import type { Data, Note, Task } from "./types.ts";

export interface RenderOpts {
  data: Data;
  selectedDate: string;
  onSelectDate: (d: string) => void;
  onCall: (args: string[]) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  onTheme: (t: "dark" | "light") => void;
  onOpenNote: (n: Note) => void;
  onNewNote: () => void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | ((...args: unknown[]) => unknown)> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "function") {
      (node as unknown as Record<string, unknown>)[k] = v;
    } else if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

const WD = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function renderApp(root: HTMLElement, opts: RenderOpts): void {
  root.innerHTML = "";
  const { data, selectedDate } = opts;
  const today = fmtDate(new Date());

  // ===== 顶栏 =====
  const sel = new Date(selectedDate + "T00:00:00");
  const progress = dayProgress(data, selectedDate);
  const ring = buildRing(progress);

  const topbar = el(
    "div",
    { class: "topbar" },
    el(
      "div",
      { class: "date-block" },
      el("div", { class: "date-main" }, `${sel.getMonth() + 1}月${sel.getDate()}日`),
      el("div", { class: "date-sub" }, `${WD[sel.getDay()]} · ${today === selectedDate ? "今天" : selectedDate}`),
    ),
    ring,
    el("div", { class: "spacer" }),
    el("button", { class: "icon-btn", title: "新建便签", onclick: () => opts.onNewNote() }, "🗒"),
    el("button", {
      class: "icon-btn",
      title: "切换主题",
      onclick: () => opts.onTheme(data.settings.theme === "dark" ? "light" : "dark"),
    }, data.settings.theme === "dark" ? "☀️" : "🌙"),
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
  for (const t of dayTasks) {
    if (!t.start) groups[3][1].push(t);
    else if (t.start < "12:00") groups[0][1].push(t);
    else if (t.start < "18:00") groups[1][1].push(t);
    else groups[2][1].push(t);
  }

  const listEl = el("div", { class: "task-list" });
  let any = false;
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
    .filter((t) => t.kind === "deadline" && !t.done && t.date !== "" && t.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (deadlines.length) {
    any = true;
    listEl.append(
      el("div", { class: "time-group" },
        el("div", { class: "time-group-label" }, "⏳ 截止任务"),
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
        el("div", { class: "time-group-label" }, "🌱 长期目标"),
        ...goals.map((t) => taskItem(t, opts)),
      ),
    );
  }

  if (!any) {
    listEl.append(
      el("div", { class: "empty-state" },
        el("div", { class: "big" }, "🌤"),
        el("div", {}, "这一天还没有安排"),
        el("div", { style: "font-size:11px;margin-top:6px" }, "右侧快速添加，或让 AI 通过 CLI 帮你安排"),
      ),
    );
  }

  const openCount = dayTasks.filter((t) => !t.done).length;
  const tasksCol = el(
    "div",
    { class: "tasks-col" },
    el("div", { class: "section-head" },
      el("h2", {}, "日程与待办"),
      el("span", { class: "count-badge" }, String(openCount)),
      el("div", { class: "spacer" }),
      el("button", { class: "mini-btn", onclick: async () => { await opts.onCall(["task", "clear-done", selectedDate]); opts.onCall([]); location.reload(); } }, "清理已完成"),
    ),
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
    "div",
    { class: "statusbar" },
    el("span", {}, "数据:"),
    el("span", { class: "mono" }, "%APPDATA%\\com.dailyflow.app\\data.json"),
    el("div", { class: "spacer" }),
    el("span", {}, `共 ${data.tasks.length} 项 · 便签 ${data.notes.length} 张`),
  );

  root.append(topbar, el("div", { class: "layout" }, tasksCol, sideCol), statusbar);
}

function dayProgress(data: Data, date: string): number {
  const ts = data.tasks.filter((t) => t.date === date);
  if (!ts.length) return 0;
  return ts.filter((t) => t.done).length / ts.length;
}

function buildRing(p: number): HTMLElement {
  const r = 21;
  const c = 2 * Math.PI * r;
  const wrap = el("div", { class: "progress-ring", title: "完成率" });
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
  fg.setAttribute("stroke-dasharray", String(c));
  fg.setAttribute("stroke-dashoffset", String(c * (1 - p)));
  fg.setAttribute("stroke-linecap", "round");
  svg.append(bg, fg);
  wrap.append(svg, el("div", { class: "ring-label" }, `${Math.round(p * 100)}%`));
  return wrap;
}

function daysUntil(date: string): number {
  if (!date) return Infinity;
  const d = new Date(date + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

function taskItem(t: Task, opts: RenderOpts): HTMLElement {
  const today = fmtDate(new Date());
  const overdue = !t.done && t.date !== "" && t.date < today && t.kind !== "goal";
  const meta: (Node | string | null)[] = [];
  if (t.start) meta.push(el("span", { class: "time-chip" }, `🕐 ${t.start}${t.end ? "–" + t.end : ""}`));
  if (overdue) meta.push(el("span", { class: "overdue" }, "已逾期"));
  if (t.kind === "deadline" && t.date) {
    const n = daysUntil(t.date);
    const label = n === 0 ? "今天截止" : n === 1 ? "明天截止" : `剩 ${n} 天`;
    meta.push(el("span", { class: n <= 1 ? "overdue" : "kind-chip" }, `⏳ ${label}`));
  }
  if (t.kind === "goal") {
    if (t.date) meta.push(el("span", { class: "kind-chip goal-chip" }, `🎯 目标日 ${t.date.slice(5)}`));
    else meta.push(el("span", { class: "kind-chip goal-chip" }, "🌱 长期"));
  }
  meta.push(...t.tags.map((tag) => el("span", { class: "tag-chip" }, `#${tag}`)));

  const item = el(
    "div",
    { class: `task-item pri-${t.priority}${t.done ? " done" : ""}` },
    el("button", {
      class: "task-check",
      title: t.done ? "标记未完成" : "完成",
      onclick: async () => {
        await opts.onCall(["task", "toggle", t.id]);
        window.__dailyflow.rerender();
      },
    }, t.done ? "✓" : ""),
    el("div", { class: "task-body" },
      el("div", { class: "task-title" }, t.title),
      el("div", { class: "task-meta" }, ...meta),
      t.notes ? el("div", { class: "task-meta" }, t.notes) : null,
    ),
    el("button", {
      class: "task-del",
      title: "删除",
      onclick: async () => {
        await opts.onCall(["task", "delete", t.id]);
        window.__dailyflow.rerender();
      },
    }, "✕"),
  );
  if (t.kind === "goal") item.classList.add("is-goal");
  if (t.kind === "deadline") item.classList.add("is-deadline");
  return item;
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
      "div",
      {
        class: `week-day${ds === selected ? " selected" : ""}${ds === today ? " today" : ""}`,
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
  return el("div", { class: "week-cal" }, el("h3", {}, "本周"), grid);
}

// 快速添加表单的跨重渲染状态（renderApp 会全量重建 DOM，
// 后端 data-changed 事件每 800ms 可能触发一次重建；若不保留，用户填到一半的
// 标题/时间/类型会被重置——例如选了"长期"后点别处又跳回"待办"）
let qaState = { title: "", time: "", kind: "normal", pri: "" };

function quickAdd(opts: RenderOpts, selectedDate: string): HTMLElement {
  const title = el("input", { placeholder: "要做什么？" });
  const time = el("input", { placeholder: "时间(可空, 如 9:30)", style: "max-width:130px" });
  const pri = document.createElement("select");
  for (const [v, label] of [["", "普通"], ["high", "高"], ["low", "低"]] as const) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = label;
    pri.append(o);
  }
  const kind = document.createElement("select");
  for (const [v, label] of [
    ["normal", "✓ 待办"],
    ["deadline", "⏳ 截止"],
    ["goal", "🌱 长期"],
  ] as const) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = label;
    kind.append(o);
  }
  // 恢复上次未提交的输入
  title.value = qaState.title;
  time.value = qaState.time;
  kind.value = qaState.kind;
  pri.value = qaState.pri;
  title.addEventListener("input", () => (qaState.title = title.value));
  time.addEventListener("input", () => (qaState.time = time.value));
  kind.addEventListener("change", () => (qaState.kind = kind.value));
  pri.addEventListener("change", () => (qaState.pri = pri.value));
  const form = el("form", {},
    title,
    el("div", { class: "qa-row" }, time, pri),
    el("div", { class: "qa-row" }, kind),
    el("button", { class: "qa-submit", type: "submit" }, "＋ 添加到 " + selectedDate.slice(5)),
    el("div", { class: "qa-hint" }, "截止: 日期即 DDL · 长期: 常驻列表 · AI 可直接 ", el("code", {}, "dailyflow task add")),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!title.value.trim()) return;
    const args = ["task", "add", title.value.trim(), "--kind", kind.value];
    if (kind.value === "goal") {
      // 长期目标：date 可空；用户手动选了日期则作为目标日
      if (time.value.trim() && /^\d{4}-\d{2}-\d{2}$/.test(time.value.trim())) {
        args.push("--date", time.value.trim());
      }
    } else {
      args.push("--date", selectedDate);
      if (time.value.trim()) args.push("--start", time.value.trim());
    }
    if (pri.value) args.push("--priority", pri.value);
    const res = await opts.onCall(args);
    if (res.ok) {
      title.value = "";
      time.value = "";
      kind.value = "normal";
      pri.value = "";
      qaState = { title: "", time: "", kind: "normal", pri: "" };
      window.__dailyflow.rerender();
    }
  });
  return el("div", { class: "quick-add" }, el("h3", {}, "快速添加"), form);
}

function notesPanel(data: Data, opts: RenderOpts): HTMLElement {
  const list = el("div", { style: "display:flex;flex-direction:column;gap:6px" });
  for (const n of data.notes) {
    list.append(
      el("div", {
        class: "task-item",
        style: "padding:8px 10px;cursor:pointer",
        onclick: () => opts.onOpenNote(n),
        title: "点击打开便签窗口",
      },
        el("div", { class: "task-body" },
          el("div", { class: "task-title", style: "font-size:13px" }, n.title || n.body.split("\n")[0] || "（空）"),
          el("div", { class: "task-meta" }, n.visible ? "已显示" : "已隐藏", ` · ${n.color}`),
        ),
        el("button", {
          class: "task-del",
          title: "删除便签",
          onclick: (e: unknown) => {
            (e as Event).stopPropagation();
            void (async () => {
              await opts.onCall(["note", "delete", n.id]);
              await invokeClose(n.id);
              window.__dailyflow.rerender();
            })();
          },
        }, "✕"),
      ),
    );
  }
  if (!data.notes.length) {
    list.append(el("div", { class: "qa-hint" }, "还没有便签。点顶栏 🗗 新建一张桌面便签。"));
  }
  return el("div", { class: "quick-add" }, el("h3", {}, "桌面便签"), list);
}

async function invokeClose(id: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("fe_close_note_window", { id });
}
