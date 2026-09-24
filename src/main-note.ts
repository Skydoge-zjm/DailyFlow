// 便签窗口逻辑：URL ?note=<id>
export {};

import { invoke } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { applyTheme } from "./themes.ts";
import type { Data } from "./types.ts";

const params = new URLSearchParams(location.search);
const noteId = params.get("note");

let wrap: HTMLElement;
let titleEl: HTMLInputElement;
let bodyEl: HTMLTextAreaElement;

if (noteId) {
  window.addEventListener("DOMContentLoaded", () => setupNote(noteId));
}

function setupNote(id: string): void {
  const app = document.getElementById("app")!;
  document.body.dataset.view = "note";
  document.documentElement.dataset.view = "note";

  titleEl = document.createElement("input");
  titleEl.className = "note-title-input";
  titleEl.placeholder = "标题";
  titleEl.style.cssText =
    "flex:1;min-width:0;background:transparent;border:none;outline:none;font-size:12px;font-weight:700;color:var(--note-text);padding:0;";
  let titleDirty = false;
  let bodyDirty = false;
  titleEl.addEventListener("input", () => {
    titleEl.setCustomValidity("");
    titleDirty = true;
    saveSoon();
  });

  bodyEl = document.createElement("textarea");
  bodyEl.className = "note-body";
  bodyEl.placeholder = "写点什么…";
  bodyEl.addEventListener("input", () => {
    bodyEl.setCustomValidity("");
    bodyDirty = true;
    saveSoon();
  });

  const bar = document.createElement("div");
  bar.className = "note-bar";
  bar.append(titleEl);

  const status = document.createElement("div");
  status.className = "note-status";
  status.hidden = true;
  const setStatus = (message?: string) => {
    status.textContent = message || "";
    status.hidden = !message;
  };

  const pin = mkBtn("📌", "置顶", togglePin);
  const cycle = mkBtn("🎨", "换色", cycleColor);
  const close = mkBtn("✕", "隐藏", hide);
  bar.append(pin, cycle, close);

  wrap = document.createElement("div");
  wrap.className = "note-win";
  wrap.append(bar, status, bodyEl);

  // 监听 CLI 和其他窗口推送的数据；保留尚未写盘的本地输入。
  // @ts-expect-error Tauri event API
  const { listen } = window.__TAURI__.event;
  let noteRevision = 0;
  let initialLoadComplete = false;
  listen("data-changed", (evt: { payload: Data }) => {
    noteRevision += 1;
    initialLoadComplete = true;
    const data = evt.payload;
    applyTheme(
      data.settings.theme_preset || "classic-dark",
      data.settings.theme === "light",
      data.settings.theme_overrides || {},
    );
    const note = data.notes?.find((item) => item.id === id);
    if (!note) return;
    if (!bodyDirty && document.activeElement !== bodyEl) bodyEl.value = note.body;
    if (!titleDirty && document.activeElement !== titleEl) titleEl.value = note.title;
    wrap.classList.toggle("pinned", note.pinned);
    pin.classList.toggle("pinned", note.pinned);
    if (titleDirty || bodyDirty) saveSoon();
  });

  // 右下角缩放手柄（无边框窗口的系统热区不可见，加个可发现的把手）
  const resizeHandle = document.createElement("div");
  resizeHandle.className = "note-resize";
  resizeHandle.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    // @ts-expect-error Tauri window API
    void window.__TAURI__.window.getCurrentWindow().startResizeDragging("SouthEast");
  });

  app.append(wrap, resizeHandle);

  bar.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).closest(".note-btn")) return;
    invoke("fe_note_drag", {});
  });

  let saveT: number | undefined;
  function saveSoon() {
    window.clearTimeout(saveT);
    saveT = window.setTimeout(() => { void save(); }, 400);
  }
  async function save(): Promise<boolean> {
    if (!initialLoadComplete) return false;
    const title = titleEl.value;
    const body = bodyEl.value;
    try {
      const result = await invoke<{ ok: boolean; error?: string }>("fe_call", {
        args: ["note", "edit", id, "--title", title, "--body", body],
      });
      if (!result.ok) {
        setStatus(result.error || "保存失败，输入内容仍保留。请检查数据文件后重试。");
        return false;
      }
      if (titleEl.value === title) titleDirty = false;
      if (bodyEl.value === body) bodyDirty = false;
      setStatus();
      return true;
    } catch (error) {
      console.error("保存便签失败", error);
      setStatus("保存失败，输入内容仍保留。请检查数据文件后重试。");
      return false;
    }
  }
  async function flushSave(): Promise<boolean> {
    if (saveT !== undefined) {
      window.clearTimeout(saveT);
      saveT = undefined;
    }
    return await save();
  }
  async function togglePin() {
    const cur = wrap.classList.contains("pinned");
    const result = await invoke<{ ok: boolean; error?: string }>("fe_call", { args: ["note", "pin", id, cur ? "off" : "on"] });
    if (!result.ok) return;
    wrap.classList.toggle("pinned", !cur);
    pin.classList.toggle("pinned", !cur);
    await invoke("fe_note_pin_window", { id, pin: !cur });
  }
  async function cycleColor() {
    const colors = ["yellow", "green", "blue", "pink", "purple", "dark"];
    const cur = colors.indexOf(wrap.dataset.color || "yellow");
    const next = colors[(cur + 1) % colors.length];
    const result = await invoke<{ ok: boolean; error?: string }>("fe_call", { args: ["note", "edit", id, "--color", next] });
    if (!result.ok) return;
    setColor(next);
  }
  async function hide() {
    if (!(await flushSave())) {
      const editor = bodyDirty ? bodyEl : titleEl;
      editor.setCustomValidity("保存失败，文本已保留，请检查后重试");
      editor.reportValidity();
      return;
    }
    await savePos();
    const result = await invoke<{ ok: boolean; error?: string }>("fe_call", { args: ["note", "hide", id] });
    if (result.ok) await invoke("fe_close_note_window", { id });
  }
  (wrap as unknown as { _handlers: unknown })._handlers = { togglePin, cycleColor };

  function mkBtn(text: string, title: string, fn: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "note-btn";
    b.textContent = text;
    b.title = title;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      fn();
    });
    return b;
  }
  function setColor(c: string) {
    const pinned = wrap.classList.contains("pinned");
    wrap.dataset.color = c;
    wrap.className = `note-win note-${c}${pinned ? " pinned" : ""}`;
  }

  // 初始加载内容
  (async () => {
    const revision = noteRevision;
    try {
      const data = await invoke<Data>("fe_load");
      if (revision !== noteRevision) return;
      initialLoadComplete = true;
      applyTheme(
        data.settings.theme_preset || "classic-dark",
        data.settings.theme === "light",
        data.settings.theme_overrides || {},
      );
      const n = data.notes.find((x) => x.id === id);
      if (n) {
        if (!titleDirty) titleEl.value = n.title;
        if (!bodyDirty) bodyEl.value = n.body;
        setColor(n.color || "yellow");
        wrap.classList.toggle("pinned", n.pinned);
        pin.classList.toggle("pinned", n.pinned);
      }
      if (titleDirty || bodyDirty) saveSoon();
    } catch (error) {
      console.error("读取便签失败", error);
      titleEl.disabled = true;
      bodyEl.disabled = true;
      setStatus("无法读取便签数据，编辑已暂停。请检查数据文件后重启应用。");
    }
  })();

  // 保存窗口位置/大小
  window.addEventListener("resize", savePos);
  window.setInterval(savePos, 3000);
  let lastSaved = "";
  async function savePos() {
    try {
      const win = getCurrentWindow();
      const pos = await win.outerPosition();
      const size = await win.outerSize();
      const f = await win.scaleFactor();
      const monitor = await currentMonitor();
      // Tauri outerPosition 使用物理像素，data.json 和 WindowBuilder 存取逻辑坐标。
      const x = Math.round(pos.x / f);
      const y = Math.round(pos.y / f);
      const w = Math.round(size.width / f);
      const h = Math.round(size.height / f);
      const monitorId = monitor
        ? (monitor.name?.trim() || `@${monitor.position.x},${monitor.position.y}`)
        : "";
      const key = `${x},${y},${w},${h},${monitorId}`;
      if (key === lastSaved) return;
      await invoke("fe_set_note_pos", { id, x, y, w, h, monitor: monitorId });
      lastSaved = key;
    } catch {
      // 窗口正在销毁或位置暂不可用时，下次 resize/interval 再试。
    }
  }
}
