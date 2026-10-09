import type { Task } from "./types.ts";
import type { RenderOpts } from "./ui-shared.ts";
import { el, taskQuadrant } from "./ui-shared.ts";
import { taskDeleteArgs, taskEditArgs, taskToggleArgs, undoArgs } from "./cli-args.ts";
import { openTaskEditor } from "./task-editor.ts";

const QUADRANT_META = {
  q1: { label: "重要且紧急", short: "Q1" },
  q2: { label: "重要不紧急", short: "Q2" },
  q3: { label: "不重要但紧急", short: "Q3" },
  q4: { label: "不重要不紧急", short: "Q4" },
} as const;

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysUntil(date: string): number {
  const target = new Date(date + "T00:00:00");
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86400000);
}

export function taskItem(
  t: Task,
  opts: RenderOpts,
  showDate = false,
  treeChildren?: Map<string, Task[]>,
  ancestors: ReadonlySet<string> = new Set(),
): HTMLElement {
  const today = fmtDate(new Date());
  const overdue = !t.done && t.date !== "" && t.date < today && t.kind !== "goal";
  const children = treeChildren?.get(t.id) || [];
  const meta: (Node | string | null)[] = [];
  const quadrant = taskQuadrant(t);
  meta.push(el("span", { class: `quadrant-chip quadrant-chip-${quadrant}` }, QUADRANT_META[quadrant].short));
  if (t.project_id && !treeChildren) {
    const project = opts.data.projects.find((item) => item.id === t.project_id);
    if (project) meta.push(el("span", { class: "project-chip" }, project.name));
  }
  if (t.parent_id && !treeChildren) {
    const parent = opts.data.tasks.find((item) => item.id === t.parent_id);
    if (parent) meta.push(el("span", { class: "task-parent-chip" }, `↳ ${parent.title}`));
  }
  if (showDate) meta.push(el("span", { class: "date-chip" }, t.date || "无目标日"));
  if (t.start) meta.push(el("span", { class: "time-chip" }, `◷ ${t.start}${t.end ? "–" + t.end : ""}`));
  if (t.remind_at) meta.push(el("span", { class: "remind-chip" }, `提醒 ${t.remind_at}`));
  if (t.repeat && t.repeat !== "none") {
    const labels = { daily: "每天", weekly: "每周", monthly: "每月" };
    meta.push(el("span", { class: "repeat-chip" }, labels[t.repeat]));
  }
  if (overdue) meta.push(el("span", { class: "overdue" }, "已逾期"));
  if (t.kind === "deadline" && t.date) {
    const n = daysUntil(t.date);
    const label = n === 0 ? "今天截止" : n === 1 ? "明天截止" : `剩 ${n} 天`;
    meta.push(el("span", { class: n <= 1 ? "overdue" : "kind-chip" }, `↘ ${label}`));
  }
  if (t.kind === "goal") {
    if (t.date) meta.push(el("span", { class: "kind-chip goal-chip" }, `◎ 目标日 ${t.date.slice(5)}`));
    else meta.push(el("span", { class: "kind-chip goal-chip" }, "◎ 长期"));
  }
  if (treeChildren && children.length) {
    const doneChildren = children.filter((child) => child.done).length;
    meta.push(el("span", { class: "subtask-chip" }, `子任务 ${doneChildren}/${children.length}`));
  }
  meta.push(...t.tags.map((tag) => el("span", { class: "tag-chip" }, tag)));

  const titleEl = el("div", { class: "task-title" }, t.title);
  const project = t.project_id ? opts.data.projects.find((item) => item.id === t.project_id) : undefined;
  let childTitle: HTMLInputElement | undefined;
  let childForm: HTMLFormElement | undefined;
  if (treeChildren && t.repeat === "none" && !project?.archived && !ancestors.has(t.id)) {
    childTitle = el("input", {
      type: "text",
      placeholder: "子任务名称",
      "aria-label": `为 ${t.title} 添加子任务`,
    });
    childForm = el("form", { class: "task-child-form", hidden: "" },
      childTitle,
      el("button", { type: "submit", class: "task-child-submit" }, "添加"),
      el("button", { type: "button", class: "task-child-cancel" }, "取消"),
    );
    childForm.querySelector<HTMLButtonElement>(".task-child-cancel")!.addEventListener("click", () => {
      childForm!.hidden = true;
      childTitle!.value = "";
    });
    childForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const title = childTitle!.value.trim();
      if (!title) {
        childTitle!.focus();
        return;
      }
      const args = ["task", "add", title, "--parent", t.id];
      if (t.date) args.push("--date", t.date);
      const result = await opts.onCall(args);
      if (result.ok) {
        childTitle!.value = "";
        childForm!.hidden = true;
      }
    });
  }
  const addChild = childForm
    ? el("button", {
        class: "task-child-add",
        type: "button",
        title: "添加子任务",
        "aria-label": `为 ${t.title} 添加子任务`,
        onclick: () => {
          childForm!.hidden = !childForm!.hidden;
          if (!childForm!.hidden) childTitle!.focus();
        },
      }, "+")
    : null;
  const item = el(
    "div",
    { class: `task-item pri-${t.priority}${t.done ? " done" : ""}` },
    el("button", {
      class: "task-check",
      title: t.done ? "标记未完成" : "完成",
      onclick: async () => {
        await opts.onCall(taskToggleArgs(t.id));
      },
    }, t.done ? el("span", { class: "task-checkmark", "aria-hidden": "true" }) : null),
    el("div", { class: "task-body" },
      titleEl,
      el("div", { class: "task-meta" }, ...meta),
      t.notes ? el("div", { class: "task-meta" }, t.notes) : null,
    ),
    el("button", {
      class: "task-edit",
      title: "编辑任务",
      "aria-label": `编辑 ${t.title}`,
      "data-focus-key": `task-edit-${t.id}`,
      onclick: () => openTaskEditor(t, opts),
    }, "编辑"),
    addChild,
    el("button", {
      class: "task-del",
      title: "删除",
      onclick: async () => {
        const res = await opts.onCall(taskDeleteArgs(t.id));
        if (res.ok) {
            window.__dailyflow.undoToast("已删除任务", async () => {
            await opts.onCall(undoArgs(t.id));
          });
        }
      },
    }, "✕"),
  );
  if (t.kind === "goal") item.classList.add("is-goal");
  if (t.kind === "deadline") item.classList.add("is-deadline");
  item.classList.add(`quadrant-${quadrant}`);

  // 双击标题 → 行内编辑（标题 + 时间），Enter 保存 / Esc 取消
  titleEl.addEventListener("dblclick", () => beginInlineEdit(titleEl, t, opts));
  titleEl.title = "双击编辑";

  if (!treeChildren) return item;
  if (ancestors.has(t.id)) return item;
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(t.id);
  const node = el("div", { class: `task-tree-node${children.length ? " has-children" : ""}` }, item);
  if (childForm) node.append(childForm);
  for (const child of children) {
    node.append(taskItem(child, opts, true, treeChildren, nextAncestors));
  }
  return node;
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
      await opts.onCall(taskEditArgs(t.id, [["title", old, val]]));
    }
    window.__dailyflow.rerender();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.isComposing || e.keyCode === 229)) return;
    if (e.key === "Enter") void finish(true);
    else if (e.key === "Escape") void finish(false);
    e.stopPropagation();
  });
  input.addEventListener("blur", () => void finish(true));
}

