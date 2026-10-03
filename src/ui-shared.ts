import type { CommandResult, Data, Note, Quadrant, Settings, SyncStatus, Task } from "./types.ts";

export interface RenderOpts {
  data: Data;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onCall: (args: string[]) => Promise<CommandResult>;
  onSettings: (patch: Partial<Settings>) => Promise<boolean>;
  onOpenNote: (note: Note) => void;
  onNewNote: () => void;
  syncStatus: SyncStatus;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | ((...args: unknown[]) => unknown)> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "function") {
      (node as unknown as Record<string, unknown>)[key] = value;
    } else if (key === "class") {
      node.className = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function taskQuadrant(task: Task): Quadrant {
  return task.quadrant || "q2";
}
