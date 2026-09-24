import type { Task } from "./types.ts";
import { taskEditArgs } from "./cli-args.ts";
import { el, taskQuadrant, type RenderOpts } from "./ui-shared.ts";

let closeTaskEditor: (() => void) | undefined;

export function openTaskEditor(task: Task, opts: RenderOpts): void {
  closeTaskEditor?.();
  const backdrop = el("div", { class: "task-editor-backdrop" });
  const dialog = el("div", { class: "task-editor", role: "dialog", "aria-modal": "true", "aria-label": "编辑任务" });
  dialog.tabIndex = -1;
  const appRoot = document.getElementById("app");
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const form = document.createElement("form");
  const input = (type: string, value: string) => {
    const control = document.createElement("input");
    control.type = type;
    control.value = value;
    return control;
  };
  const select = (items: ReadonlyArray<readonly [string, string]>, value: string) => {
    const control = document.createElement("select");
    for (const [key, label] of items) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = label;
      control.append(option);
    }
    control.value = value;
    return control;
  };
  const field = (name: string, control: HTMLElement) =>
    el("label", { class: "task-editor-field" }, el("span", {}, name), control);
  const title = input("text", task.title);
  title.required = true;
  const date = input("date", task.date);
  const start = input("time", task.start || "");
  const end = input("time", task.end || "");
  const remind = input("time", task.remind_at || "");
  const kind = select([["normal", "待办"], ["deadline", "截止"], ["goal", "长期目标"]], task.kind);
  const quadrant = select(
    [["q1", "Q1 · 重要且紧急"], ["q2", "Q2 · 重要不紧急"], ["q3", "Q3 · 不重要但紧急"], ["q4", "Q4 · 不重要不紧急"]],
    taskQuadrant(task),
  );
  const repeat = select([["none", "不重复"], ["daily", "每天"], ["weekly", "每周"], ["monthly", "每月"]], task.repeat || "none");
  const priority = select([["normal", "普通"], ["high", "高"], ["low", "低"]], task.priority);
  const tags = input("text", task.tags.join(","));
  const notes = document.createElement("textarea");
  notes.value = task.notes;
  notes.rows = 3;
  const syncKind = () => {
    date.required = kind.value !== "goal";
    repeat.disabled = kind.value === "goal";
    if (repeat.disabled) repeat.value = "none";
    remind.disabled = kind.value === "goal" && !date.value;
    if (remind.disabled) remind.value = "";
  };
  kind.addEventListener("change", syncKind);
  date.addEventListener("change", syncKind);
  start.addEventListener("change", () => {
    if (task.start && remind.value === task.start) remind.value = start.value;
    else if (!task.start && !task.remind_at && !remind.value) remind.value = start.value;
  });
  syncKind();

  const close = () => {
    document.removeEventListener("keydown", onKeyDown);
    if (appRoot) appRoot.inert = false;
    backdrop.remove();
    if (closeTaskEditor === close) closeTaskEditor = undefined;
    if (previouslyFocused?.isConnected) previouslyFocused.focus();
  };
  closeTaskEditor = close;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getAttribute("aria-hidden") !== "true" && element.getClientRects().length > 0);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", onKeyDown);
  backdrop.addEventListener("mousedown", (event) => { if (event.target === backdrop) close(); });
  const cancel = el("button", { type: "button", class: "task-editor-cancel" }, "取消");
  cancel.addEventListener("click", close);
  const save = el("button", { type: "submit", class: "task-editor-save" }, "保存");
  form.append(
    field("标题", title),
    el("div", { class: "task-editor-grid" }, field("类型", kind), field("四象限", quadrant)),
    field("日期", date),
    el("div", { class: "task-editor-grid" }, field("开始", start), field("结束", end)),
    el("div", { class: "task-editor-grid" }, field("重复", repeat), field("提醒时间", remind)),
    el("div", { class: "task-editor-grid" }, field("优先级", priority), field("标签（逗号分隔）", tags)),
    field("备注", notes),
    el("div", { class: "task-editor-actions" }, cancel, save),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (start.value && end.value && end.value < start.value) {
      end.setCustomValidity("结束时间不能早于开始时间");
      end.reportValidity();
      return;
    }
    end.setCustomValidity("");
    const args = taskEditArgs(task.id, [
      ["title", task.title, title.value.trim()],
      ["kind", task.kind, kind.value],
      ["quadrant", taskQuadrant(task), quadrant.value],
      ["date", task.date, date.value],
      ["start", task.start || "", start.value],
      ["end", task.end || "", end.value],
      ["repeat", task.repeat || "none", repeat.value],
      ["remind", task.remind_at || "", remind.value],
      ["priority", task.priority, priority.value],
      ["tags", task.tags.join(","), tags.value.trim()],
      ["notes", task.notes, notes.value],
    ]);
    if (args.length === 3 || (await opts.onCall(args)).ok) {
      close();
      window.__dailyflow.rerender();
    }
  });
  dialog.append(el("div", { class: "task-editor-head" }, el("h2", {}, "编辑任务"), el("span", {}, task.id)), form);
  backdrop.append(dialog);
  document.body.append(backdrop);
  if (appRoot) appRoot.inert = true;
  title.focus();
}
