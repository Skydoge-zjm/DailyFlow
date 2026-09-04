import { invoke } from "@tauri-apps/api/core";
import "./main-note.ts";
import "./main-widget.ts";
import {
  renderApp,
  el,
} from "./ui.ts";
import { applyTheme } from "./themes.ts";
import type { Data, Note, Settings } from "./types.ts";

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

function normSettings(s: Partial<Settings> | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...(s || {}), theme_overrides: s?.theme_overrides || {} };
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

async function call(args: string[]): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const res = await invoke<{ ok: boolean; data?: unknown; error?: string }>("fe_call", { args });
  if (!res.ok) toast(res.error || "操作失败", true);
  return res;
}

async function reload(): Promise<void> {
  data = await invoke<Data>("fe_load");
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
  };

  reload();

  // 后端文件监听推送（CLI 修改 data.json 后自动刷新）
  // @ts-expect-error Tauri event API
  const { listen } = window.__TAURI__.event;
  listen("data-changed", async (evt: { payload: unknown }) => {
    data = evt.payload as Data;
    render();
  });
});
