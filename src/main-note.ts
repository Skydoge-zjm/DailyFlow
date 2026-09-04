// 便签窗口逻辑：URL ?note=<id>
export {};

import { invoke } from "@tauri-apps/api/core";

interface NoteData {
  id: string;
  title: string;
  body: string;
  color: string;
  pinned: boolean;
}

const params = new URLSearchParams(location.search);
const noteId = params.get("note");

let wrap: HTMLElement;
let titleEl: HTMLInputElement;
let bodyEl: HTMLTextAreaElement;

if (noteId) {
  window.addEventListener("DOMContentLoaded", () => {
    setupNote(noteId);
    // 监听数据刷新（CLI 改了便签内容 → 更新编辑区）
    // @ts-expect-error Tauri event API
    const { listen } = window.__TAURI__.event;
    listen("data-changed", (evt: { payload: { notes?: NoteData[] } }) => {
      const n = evt.payload?.notes?.find((x) => x.id === noteId);
      if (n && document.activeElement !== bodyEl) {
        titleEl.value = n.title;
        bodyEl.value = n.body;
      }
      if (n) {
        wrap.classList.toggle("pinned", n.pinned);
      }
    });
  });
}

function setupNote(id: string): void {
  const app = document.getElementById("app")!;
  document.body.dataset.view = "note";

  titleEl = document.createElement("input");
  titleEl.className = "note-title-input";
  titleEl.placeholder = "标题";
  titleEl.style.cssText =
    "flex:1;min-width:0;background:transparent;border:none;outline:none;font-size:12px;font-weight:700;color:var(--note-text);padding:0;";
  titleEl.addEventListener("input", saveSoon);

  bodyEl = document.createElement("textarea");
  bodyEl.className = "note-body";
  bodyEl.placeholder = "写点什么…";
  bodyEl.addEventListener("input", saveSoon);

  const bar = document.createElement("div");
  bar.className = "note-bar";
  bar.append(titleEl);

  const pin = mkBtn("📌", "置顶", togglePin);
  const cycle = mkBtn("🎨", "换色", cycleColor);
  const close = mkBtn("✕", "隐藏", hide);
  bar.append(pin, cycle, close);

  wrap = document.createElement("div");
  wrap.className = "note-win";
  wrap.append(bar, bodyEl);
  app.append(wrap);

  bar.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).closest(".note-btn")) return;
    invoke("fe_note_drag", {});
  });

  let saveT: number | undefined;
  function saveSoon() {
    window.clearTimeout(saveT);
    saveT = window.setTimeout(save, 400);
  }
  async function save() {
    await invoke("fe_call", {
      args: ["note", "edit", id, "--title", titleEl.value, "--body", bodyEl.value],
    });
  }
  async function togglePin() {
    const cur = wrap.classList.contains("pinned");
    await invoke("fe_call", { args: ["note", "pin", id, cur ? "off" : "on"] });
    wrap.classList.toggle("pinned", !cur);
    await invoke("fe_note_pin_window", { id, pin: !cur });
  }
  async function cycleColor() {
    const colors = ["yellow", "green", "blue", "pink", "purple", "dark"];
    const cur = colors.indexOf(wrap.dataset.color || "yellow");
    const next = colors[(cur + 1) % colors.length];
    setColor(next);
    await invoke("fe_call", { args: ["note", "edit", id, "--color", next] });
  }
  async function hide() {
    await invoke("fe_call", { args: ["note", "hide", id] });
    await invoke("fe_close_note_window", { id });
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
    wrap.dataset.color = c;
    wrap.className = `note-win note-${c}`;
  }

  // 初始加载内容
  (async () => {
    const data = await invoke<{ notes: NoteData[] }>("fe_load");
    const n = data.notes.find((x) => x.id === id);
    if (n) {
      titleEl.value = n.title;
      bodyEl.value = n.body;
      setColor(n.color || "yellow");
      if (n.pinned) wrap.classList.add("pinned");
    }
  })();

  // 保存窗口位置/大小
  window.addEventListener("resize", savePos);
  window.setInterval(savePos, 3000);
  async function savePos() {
    // @ts-expect-error Tauri window API
    const win = window.__TAURI__.window.getCurrentWindow();
    const pos = await win.outerPosition();
    const size = await win.outerSize();
    const f = await win.scaleFactor();
    await invoke("fe_set_note_pos", {
      id,
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      w: size.width / f,
      h: size.height / f,
    });
  }
}
