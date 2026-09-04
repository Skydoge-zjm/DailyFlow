import { invoke } from "@tauri-apps/api/core";
import "./main-note.ts";
import {
  renderApp,
  el,
} from "./ui.ts";
import type { Data, Note } from "./types.ts";

export {};

declare global {
  interface Window {
    __dailyflow: {
      data: Data;
      selected: string;
      save: (d: Data) => Promise<void>;
      call: (args: string[]) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
      rerender: () => void;
      toast: (msg: string, isErr?: boolean) => void;
    };
  }
}

// 主窗口逻辑（body[data-view] 缺省为 main）
const appEl = document.getElementById("app")!;

let data: Data = { version: 1, tasks: [], notes: [], settings: { theme: "dark", sticky_opacity: 0.92, autostart: false } };
let selectedDate = todayStr();
let toastTimer: number | undefined;

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

function render(): void {
  renderApp(appEl, {
    data,
    selectedDate,
    onSelectDate: (d) => {
      selectedDate = d;
      render();
    },
    onCall: call,
    onTheme: async (theme) => {
      data.settings.theme = theme;
      await invoke("fe_save", { data: { ...data } });
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
  document.documentElement.dataset.theme = data.settings.theme === "light" ? "light" : "dark";
}

// ---------- 事件 ----------
window.addEventListener("DOMContentLoaded", () => {
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
