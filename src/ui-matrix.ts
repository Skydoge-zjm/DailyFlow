import type { Task, Quadrant } from "./types.ts";
import type { RenderOpts } from "./ui-shared.ts";
import { el, taskQuadrant } from "./ui-shared.ts";

type TaskRenderer = (task: Task, opts: RenderOpts, showDate?: boolean) => HTMLElement;
const QUADRANT_META: Record<Quadrant, { label: string; short: string }> = {
  q1: { label: "重要且紧急", short: "Q1" },
  q2: { label: "重要不紧急", short: "Q2" },
  q3: { label: "不重要但紧急", short: "Q3" },
  q4: { label: "不重要不紧急", short: "Q4" },
};

export function renderMatrixBoard(tasks: Task[], opts: RenderOpts, renderTask: TaskRenderer): HTMLElement {
  const groups: Quadrant[] = ["q1", "q2", "q3", "q4"];
  const board = el("div", { class: "quadrant-board" });
  for (const quadrant of groups) {
    const items = tasks.filter((task) => taskQuadrant(task) === quadrant);
    const meta = QUADRANT_META[quadrant];
    const cell = el(
      "section",
      { class: `quadrant-cell quadrant-${quadrant}` },
      el("div", { class: "quadrant-head" },
        el("div", { class: "quadrant-code" }, meta.short),
        el("div", { class: "quadrant-heading" },
          el("strong", {}, meta.label),
          el("span", { class: "quadrant-count" }, String(items.length)),
        ),
      ),
      el("div", { class: "quadrant-hint" }, quadrant === "q1" ? "先处理，避免继续积压" : quadrant === "q2" ? "留出时间，安排进计划" : quadrant === "q3" ? "尽量委派或快速处理" : "减少、合并或稍后再做"),
      el("div", { class: "quadrant-items" },
        ...(items.length
          ? items.map((task) => renderTask(task, opts, true))
          : [el("div", { class: "quadrant-empty" }, "暂无任务")]),
      ),
    );
    board.append(cell);
  }
  return board;
}

