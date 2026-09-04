// 主窗口 UI 渲染（无框架，纯 DOM）
import type { Data, Note, Settings, Task } from "./types.ts";
import { PRESETS, THEME_VARS, type ThemeOverrides } from "./themes.ts";

export interface RenderOpts {
  data: Data;
  selectedDate: string;
  onSelectDate: (d: string) => void;
  onCall: (args: string[]) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  onSettings: (patch: Partial<Settings>) => Promise<void>;
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
  const dayCount = data.tasks.filter((t) => t.date === selectedDate && t.kind !== "goal").length;
  const progress = dayProgress(data, selectedDate);
  const ring = buildRing(progress, dayCount > 0 && progress >= 1);

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
      title: "明暗切换",
      onclick: () => void opts.onSettings({ theme: data.settings.theme === "dark" ? "light" : "dark" }),
    }, data.settings.theme === "dark" ? "☀️" : "🌙"),
    el("button", { class: "icon-btn", title: "主题与外观", onclick: () => openThemePanel(opts) }, "🎨"),
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

  // 逾期任务（所有日期早于今天、未完成、非 goal）单独成组置顶
  const overdueTasks = data.tasks
    .filter((t) => !t.done && t.kind !== "goal" && t.date !== "" && t.date < today)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (overdueTasks.length && selectedDate === today) {
    any = true;
    listEl.append(
      el("div", { class: "time-group overdue-group" },
        el("div", { class: "time-group-label overdue-label" }, `⚠ 已逾期（${overdueTasks.length}）`),
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

  if (!any && !overdueTasks.length) {
    listEl.append(
      el("div", { class: "empty-state" },
        el("div", { class: "big" }, "🌤"),
        el("div", { class: "empty-title" }, "这一天还没有安排"),
        el("div", { class: "empty-hint" }, "双击标题可改任务 · 右侧快速添加 · 或让 AI 通过 CLI 帮你安排"),
      ),
    );
  }

  const openCount = dayTasks.filter((t) => !t.done).length;
  const tasksCol = el(
    "div",
    { class: "tasks-col" },
    el("div", { class: "section-head" },
      el("h2", {}, "日程与待办"),
      openCount > 0 ? el("span", { class: "count-badge" }, String(openCount)) : null,
      el("div", { class: "spacer" }),
      selectedDate !== today
        ? el("button", { class: "mini-btn", onclick: () => opts.onSelectDate(today) }, "← 回到今天")
        : null,
      el("button", { class: "mini-btn", onclick: async () => { await opts.onCall(["task", "clear-done", selectedDate]); window.__dailyflow.rerender(); } }, "清理已完成"),
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

  const titleEl = el("div", { class: "task-title" }, t.title);
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
      titleEl,
      el("div", { class: "task-meta" }, ...meta),
      t.notes ? el("div", { class: "task-meta" }, t.notes) : null,
    ),
    el("button", {
      class: "task-del",
      title: "删除",
      onclick: async () => {
        // 删除前记下快照，误删可一键撤销
        const snapshot = JSON.stringify(t);
        const res = await opts.onCall(["task", "delete", t.id]);
        if (res.ok) {
          window.__dailyflow.rerender();
          window.__dailyflow.undoToast("已删除任务", async () => {
            const old = JSON.parse(snapshot) as Task;
            const args = ["task", "add", old.title, "--kind", old.kind, "--date", old.date || "today"];
            if (old.start) args.push("--start", old.start);
            if (old.end) args.push("--end", old.end);
            if (old.priority !== "normal") args.push("--priority", old.priority);
            if (old.tags.length) args.push("--tags", old.tags.join(","));
            if (old.notes) args.push("--notes", old.notes);
            if (old.done) {
              await opts.onCall(args);
              const all = window.__dailyflow.data.tasks;
              const newly = all.length ? all[all.length - 1] : undefined;
              await opts.onCall(["task", "done", (newly as Task | undefined)?.id ?? ""]);
            }
            window.__dailyflow.rerender();
          });
        }
      },
    }, "✕"),
  );
  if (t.kind === "goal") item.classList.add("is-goal");
  if (t.kind === "deadline") item.classList.add("is-deadline");

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
      await opts.onCall(["task", "edit", t.id, "--title", val]);
    }
    window.__dailyflow.rerender();
  };
  input.addEventListener("keydown", (e) => {
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
  // 选中日的月分标题（跨月导航时给用户方位感）
  const selMonth = `${base.getFullYear() % 100}年${base.getMonth() + 1}月`;
  return el(
    "div",
    { class: "week-cal" },
    el("div", { class: "week-cal-head" },
      el("h3", {}, selMonth),
      el("button", {
        class: "week-nav",
        title: "上一周（含更早日期）",
        onclick: () => {
          const d = new Date(selected + "T00:00:00");
          d.setDate(d.getDate() - 7);
          opts.onSelectDate(fmtDate(d));
        },
      }, "‹"),
      el("button", {
        class: "week-nav",
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
  const submitBtn = el("button", { class: "qa-submit", type: "submit" }, "＋ 添加到 " + selectedDate.slice(5));
  const syncKindUi = () => {
    if (kind.value === "goal") {
      time.placeholder = "目标日期(可空, 如 2026-12-31)";
      submitBtn.textContent = "＋ 新长期目标";
    } else if (kind.value === "deadline") {
      time.placeholder = "时间(可空, 如 9:30)";
      submitBtn.textContent = "＋ 截止于 " + selectedDate.slice(5);
    } else {
      time.placeholder = "时间(可空, 如 9:30)";
      submitBtn.textContent = "＋ 添加到 " + selectedDate.slice(5);
    }
  };
  kind.addEventListener("change", syncKindUi);
  syncKindUi();
  const form = el("form", {},
    title,
    el("div", { class: "qa-row" }, time, pri),
    el("div", { class: "qa-row" }, kind),
    submitBtn,
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

/* ============ 主题与外观面板 ============ */

function openThemePanel(opts: RenderOpts): void {
  document.querySelector(".theme-panel")?.remove();
  const s = opts.data.settings;
  const overrides: ThemeOverrides = { ...(s.theme_overrides || {}) };

  const panel = el("div", { class: "theme-panel" });
  const backdrop = el("div", { class: "theme-backdrop" });

  // ---- preset 选择 ----
  const presetRow = el("div", { class: "tp-presets" });
  const rebuildPresetRow = () => {
    presetRow.innerHTML = "";
    for (const p of PRESETS) {
      const chip = el(
        "button",
        {
          class: `tp-preset${(s.theme_preset || "classic-dark") === p.name ? " active" : ""}`,
          title: p.label,
          onclick: async () => {
            await opts.onSettings({ theme_preset: p.name });
          },
        },
        el("span", { class: "tp-swatch" },
          el("i", { style: `background:${p.swatch.bg}` }),
          el("i", { style: `background:${p.swatch.card}` }),
          el("i", { style: `background:${p.swatch.accent}` }),
          el("i", { style: `background:${p.swatch.text}` }),
        ),
        el("span", { class: "tp-name" }, p.label),
      );
      presetRow.append(chip);
    }
  };
  rebuildPresetRow();

  // ---- 变量自定义 ----
  const varsGrid = el("div", { class: "tp-vars" });
  const rebuildVars = () => {
    varsGrid.innerHTML = "";
    for (const v of THEME_VARS) {
      const cur = overrides[v.key] ?? "";
      const row = el("div", { class: "tp-var" });
      const label = el("label", {}, v.label);
      label.title = v.key;
      row.append(label);
      if (v.kind === "color") {
        const swatch = el("button", { class: "tp-swatch-btn", title: "点击取色" });
        const colorInput = document.createElement("input");
        colorInput.type = "color";
        colorInput.value = toHexColor(cur || "#888888");
        colorInput.className = "tp-color-input";
        swatch.style.background = colorInput.value;
        colorInput.addEventListener("input", async () => {
          swatch.style.background = colorInput.value;
          overrides[v.key] = colorInput.value;
          previewOverrides();
        });
        swatch.append(colorInput);
        row.append(swatch);
      } else {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "tp-text-input";
        input.placeholder = "默认";
        input.value = cur;
        input.addEventListener("change", async () => {
          if (input.value.trim()) overrides[v.key] = input.value.trim();
          else delete overrides[v.key];
          previewOverrides();
        });
        row.append(input);
      }
      const resetOne = el("button", {
        class: "tp-reset-one",
        title: "恢复默认",
        onclick: async () => {
          delete overrides[v.key];
          void opts.onSettings({ theme_overrides: { ...overrides } });
        },
      }, "↺");
      row.append(resetOne);
      varsGrid.append(row);
    }
  };
  rebuildVars();

  // 实时预览：不落盘，只改 document 变量
  function previewOverrides() {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(overrides)) {
      if (k.startsWith("--") && v) root.style.setProperty(k, v);
    }
  }
  // 关闭面板且未应用时，撤销预览残留（重新按已保存设置应用一遍）
  function cancelPreview() {
    panel.remove();
    backdrop.remove();
    // 已保存的 overrides 之外的预览值要清掉：直接全量重放当前持久化设置
    void opts.onSettings({ theme_overrides: { ...(s.theme_overrides || {}) } });
  }

  // ---- 底部操作 ----
  const applyBtn = el("button", {
    class: "tp-btn primary",
    onclick: async () => {
      await opts.onSettings({ theme_overrides: { ...overrides } });
      panel.remove();
      backdrop.remove();
    },
  }, "应用自定义");
  const resetBtn = el("button", {
    class: "tp-btn",
    onclick: async () => {
      for (const k of Object.keys(overrides)) delete overrides[k];
      rebuildVars();
      previewOverrides();
      await opts.onSettings({ theme_overrides: {} });
    },
  }, "全部恢复默认");
  const exportBtn = el("button", {
    class: "tp-btn",
    title: "复制当前主题 JSON（可分享/导入）",
    onclick: async () => {
      const json = JSON.stringify({ preset: s.theme_preset, theme: s.theme, overrides: { ...overrides } }, null, 2);
      try {
        await navigator.clipboard.writeText(json);
        window.__dailyflow.toast("主题 JSON 已复制到剪贴板");
      } catch {
        window.__dailyflow.toast("复制失败，请手动选择文本", true);
      }
    },
  }, "导出");
  const importInput = document.createElement("textarea");
  importInput.className = "tp-import";
  importInput.placeholder = '粘贴主题 JSON 导入，如 {"preset":"warm-journal","overrides":{"--accent":"#e8965a"}}';
  const importBtn = el("button", {
    class: "tp-btn",
    onclick: async () => {
      try {
        const parsed = JSON.parse(importInput.value) as { preset?: string; overrides?: ThemeOverrides };
        await opts.onSettings({
          theme_preset: parsed.preset || s.theme_preset,
          theme_overrides: parsed.overrides || {},
        });
        panel.remove();
        backdrop.remove();
        window.__dailyflow.toast("主题已导入");
      } catch {
        window.__dailyflow.toast("JSON 解析失败", true);
      }
    },
  }, "导入");

  const actions = el("div", { class: "tp-actions" }, resetBtn, exportBtn, importBtn, applyBtn);

  panel.append(
    el("div", { class: "tp-title" }, "🎨 主题与外观"),
    el("div", { class: "tp-sub" }, "预设"),
    presetRow,
    el("div", { class: "tp-sub" }, "自定义变量（覆盖当前预设）"),
    varsGrid,
    importInput,
    actions,
  );
  backdrop.addEventListener("click", cancelPreview);
  // Esc 关闭面板（等同点遮罩：撤销未应用的预览）
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      cancelPreview();
      window.removeEventListener("keydown", escHandler);
    }
  };
  window.addEventListener("keydown", escHandler);
  // 面板移除时清理 Esc 监听（应用/导入路径也会 remove panel）
  const observer = new MutationObserver(() => {
    if (!document.body.contains(panel)) {
      window.removeEventListener("keydown", escHandler);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
  document.body.append(backdrop, panel);
}

function toHexColor(c: string): string {
  const s = c.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  // rgba(r,g,b,a) → hex（丢弃 alpha）
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) {
    const hex = (n: string) => Number(n).toString(16).padStart(2, "0");
    return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
  }
  return "#888888";
}
