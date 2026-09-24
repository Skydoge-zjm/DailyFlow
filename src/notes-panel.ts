import { invoke } from "@tauri-apps/api/core";
import type { Data } from "./types.ts";
import { noteDeleteArgs, noteVisibilityArgs, undoArgs } from "./cli-args.ts";
import { el, type RenderOpts } from "./ui-shared.ts";

export function notesPanel(data: Data, opts: RenderOpts): HTMLElement {
  const list = el("div", { class: "notes-list" });
  const colorDot: Record<string, string> = {
    yellow: "#fff3bf", green: "#d3f9d8", blue: "#d0ebff",
    pink: "#ffdeeb", purple: "#e5dbff", dark: "#25272e",
  };
  for (const note of data.notes) {
    const toggleButton = el("button", {
      class: "note-action",
      title: note.visible ? "隐藏便签窗口" : "显示便签窗口",
      onclick: (event: unknown) => {
        (event as Event).stopPropagation();
        void (async () => {
          const result = await opts.onCall(noteVisibilityArgs(note.id, !note.visible));
          if (!result.ok) return;
          if (note.visible) await invokeClose(note.id);
          window.__dailyflow.rerender();
        })();
      },
    }, note.visible ? "◉" : "○");
    list.append(
      el("div", {
        class: "note-row",
        onclick: () => opts.onOpenNote(note),
        title: "点击打开便签窗口",
      },
        el("span", {
          class: "note-dot",
          style: `background:${colorDot[note.color] || "#fff3bf"}`,
        }),
        el("div", { class: "task-body" },
          el("div", { class: "task-title", style: "font-size:13px" }, note.title || note.body.split("\n")[0] || "（空）"),
          el("div", { class: "task-meta" }, note.visible ? "已显示" : "已隐藏", ` · ${note.color}`),
        ),
        toggleButton,
        el("button", {
          class: "note-delete",
          title: "删除便签",
          onclick: (event: unknown) => {
            (event as Event).stopPropagation();
            void (async () => {
              const result = await opts.onCall(noteDeleteArgs(note.id));
              if (!result.ok) return;
              await invokeClose(note.id);
              window.__dailyflow.rerender();
              window.__dailyflow.undoToast("已删除便签", async () => {
                const restored = await opts.onCall(undoArgs(note.id));
                if (restored.ok) window.__dailyflow.rerender();
              });
            })();
          },
        }, "✕"),
      ),
    );
  }
  if (!data.notes.length) {
    list.append(el("div", { class: "notes-empty" }, "还没有便签 · 顶栏可新建"));
  }
  return el("div", { class: "quick-add notes-panel" },
    el("div", { class: "panel-heading" },
      el("div", { class: "panel-eyebrow" }, "MEMOS"),
      el("div", { class: "panel-title-row" },
        el("h3", {}, "桌面便签"),
        el("span", { class: "panel-count" }, String(data.notes.length)),
      ),
    ),
    list,
  );
}

async function invokeClose(id: string): Promise<void> {
  await invoke("fe_close_note_window", { id });
}
