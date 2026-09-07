import { invoke } from "@tauri-apps/api/core";
import "./main-note.ts";
import "./main-widget.ts";
import {
  renderApp,
  el,
} from "./ui.ts";
import { applyTheme } from "./themes.ts";
import type { Data, Note, Settings, Task } from "./types.ts";

export {};

declare global {
  interface Window {
    __dailyflow: {
      data: Data;
      selected: string;
      save: (d: Data) => Promise<void>;
      saveSettings: (patch: Partial<Settings>) => Promise<void>;
      call: (args: string[]) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
      rerender: () => void;
      toast: (msg: string, isErr?: boolean) => void;
      undoToast: (msg: string, onUndo: () => Promise<void>) => void;
    };
  }
}

const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  theme_preset: "classic-dark",
  theme_overrides: {},
  sticky_opacity: 0.92,
  autostart: false,
  widget_visible: true,
  widget_pinned: true,
  widget_x: 0,
  widget_y: 0,
};

// 主窗口逻辑（body[data-view] 缺省为 main）
const appEl = document.getElementById("app")!;

let data: Data = { version: 1, tasks: [], notes: [], settings: { ...DEFAULT_SETTINGS } };
let selectedDate = todayStr();
let toastTimer: number | undefined;
const previewMode = new URLSearchParams(location.search).has("preview");

function normSettings(s: Partial<Settings> | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...(s || {}), theme_overrides: s?.theme_overrides || {} };
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function previewData(): Data {
  const today = todayStr();
  const tasks: Task[] = [
    { id: "preview-1", title: "整理本周项目进展", notes: "发给团队的版本", date: today, start: "09:30", end: "10:15", done: false, priority: "high", kind: "normal", tags: ["工作"], created_at: "", completed_at: null },
    { id: "preview-2", title: "午间散步 20 分钟", notes: "离开屏幕，换个节奏", date: today, start: "12:30", end: null, done: true, priority: "low", kind: "normal", tags: ["生活"], created_at: "", completed_at: today },
    { id: "preview-3", title: "阅读产品反馈并标注重点", notes: "", date: today, start: "15:00", end: "16:00", done: false, priority: "normal", kind: "normal", tags: ["研究"], created_at: "", completed_at: null },
    { id: "preview-4", title: "准备周五演示稿", notes: "", date: today, start: null, end: null, done: false, priority: "normal", kind: "deadline", tags: ["重要"], created_at: "", completed_at: null },
    { id: "preview-5", title: "建立每周复盘习惯", notes: "", date: "", start: null, end: null, done: false, priority: "low", kind: "goal", tags: [], created_at: "", completed_at: null },
  ];
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    tasks,
    notes: [
      { id: "preview-note-1", title: "灵感收集", body: "把值得保留的想法先放在这里。", color: "yellow", x: 0, y: 0, w: 260, h: 220, pinned: false, visible: true, created_at: "", updated_at: "" },
      { id: "preview-note-2", title: "下次会议", body: "确认发布节奏和体验细节。", color: "blue", x: 0, y: 0, w: 260, h: 220, pinned: true, visible: false, created_at: "", updated_at: "" },
    ],
  };
}

function toast(msg: string, isErr = false) {
  document.querySelector(".toast")?.remove();
  const t = el("div", { class: `toast${isErr ? " error" : ""}` }, msg);
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 250);
  }, 2200);
}

/** 带撤销按钮的 toast（删除误操作恢复用） */
function undoToast(msg: string, onUndo: () => Promise<void>): void {
  document.querySelector(".toast")?.remove();
  const btn = el("button", { class: "toast-undo" }, "撤销");
  const t = el("div", { class: "toast" }, msg, btn);
  btn.addEventListener("click", () => {
    void onUndo();
    t.remove();
  });
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 250);
  }, 5000);
}

async function call(args: string[]): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const res = await invoke<{ ok: boolean; data?: unknown; error?: string }>("fe_call", { args });
  if (!res.ok) toast(res.error || "操作失败", true);
  return res;
}

async function reload(): Promise<void> {
  data = previewMode ? previewData() : await invoke<Data>("fe_load");
  render();
}

/** 应用主题：preset CSS + overrides → document；明暗切换 body[data-theme] */
function applyThemeNow(): void {
  const s = normSettings(data.settings);
  applyTheme(s.theme_preset || "classic-dark", s.theme === "light", s.theme_overrides);
}

function render(): void {
  applyThemeNow();
  renderApp(appEl, {
    data,
    selectedDate,
    onSelectDate: (d) => {
      selectedDate = d;
      render();
    },
    onCall: call,
    onSettings: async (patch) => {
      data.settings = normSettings({ ...data.settings, ...patch });
      await invoke("fe_save", { data: { ...data, settings: data.settings } });
      render();
    },
    onOpenNote: async (note: Note) => {
      await invoke("fe_note_window", { id: note.id, note: note as unknown as Record<string, unknown> });
    },
    onNewNote: async () => {
      const res = await call(["note", "add", "（在这里写下内容）"]);
      if (res.ok) {
        await reload();
        const notes = (res.data as { note: Note }).note;
        await invoke("fe_note_window", { id: (res.data as { id: string }).id, note: notes as unknown as Record<string, unknown> });
      }
    },
  });
}

// ---------- 事件 ----------
window.addEventListener("DOMContentLoaded", () => {
  // widget / note 子窗口有自己的入口模块；主逻辑只在主窗口跑
  if (new URLSearchParams(location.search).has("view") || new URLSearchParams(location.search).has("note")) {
    return;
  }

  window.__dailyflow = {
    get data() {
      return data;
    },
    selected: selectedDate,
    save: async (d: Data) => {
      data = d;
      await invoke("fe_save", { data: { ...d } });
      render();
    },
    saveSettings: async (patch: Partial<Settings>) => {
      data.settings = normSettings({ ...data.settings, ...patch });
      await invoke("fe_save", { data: { ...data, settings: data.settings } });
      render();
    },
    call,
    rerender: render,
    toast,
    undoToast,
  };

  reload();

  if (previewMode) return;

  // 后端文件监听推送（CLI 修改 data.json 后自动刷新）
  // @ts-expect-error Tauri event API
  const { listen } = window.__TAURI__.event;
  // rAF 合帧：连续事件（如批量 CLI 操作）只触发一次渲染，且不与浏览器绘制争帧
  let rafPending = false;
  listen("data-changed", async (evt: { payload: unknown }) => {
    data = evt.payload as Data;
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        render();
      });
    }
  });
});
