import type { Data } from "./types.ts";
import { el } from "./ui-shared.ts";

export function statCards(data: Data, today: string): HTMLElement {
  const todayAll = data.tasks.filter((t) => t.date === today && t.kind !== "goal");
  const todayOpen = todayAll.filter((t) => !t.done).length;
  const overdueN = data.tasks.filter((t) => !t.done && t.kind !== "goal" && t.date !== "" && t.date < today).length;
  const goalsN = data.tasks.filter((t) => t.kind === "goal" && !t.done).length;
  const deadlinesN = data.tasks.filter((t) => t.kind === "deadline" && !t.done && t.date !== "" && t.date >= today).length;
  const card = (label: string, value: string, cls: string, index: string) =>
    el("div", { class: `stat-card ${cls}` },
      el("div", { class: "stat-topline" },
        el("span", { class: "stat-index" }, index),
        el("span", { class: "stat-value" }, value),
      ),
      el("div", { class: "stat-label" }, label),
    );
  const cards: Array<[string, string, string]> = [
    ["今日待办", String(todayOpen), todayOpen > 0 ? "hot" : "calm"],
    ...(overdueN > 0 ? [["已逾期", String(overdueN), "danger"] as [string, string, string]] : []),
    ...(deadlinesN > 0 ? [["临近截止", String(deadlinesN), "warn"] as [string, string, string]] : []),
    ["长期目标", String(goalsN), "goal"],
  ];
  return el(
    "div",
    { class: "stat-cards" },
    ...cards.map(([label, value, cls], index) => card(label, value, cls, String(index + 1).padStart(2, "0"))),
  );
}

export function dayProgress(data: Data, date: string): number {
  const ts = data.tasks.filter((t) => t.date === date && t.kind !== "goal");
  if (!ts.length) return 0;
  return ts.filter((t) => t.done).length / ts.length;
}

export function buildProgressMeter(progress: number, done: number, total: number): HTMLElement {
  const percentage = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const complete = total > 0 && done >= total;
  const meter = el("div", {
    class: `progress-meter${complete ? " complete" : ""}`,
    title: complete ? "今日安排已完成" : `今日完成 ${percentage}%`,
    role: "progressbar",
    "aria-valuemin": "0",
    "aria-valuemax": "100",
    "aria-valuenow": String(percentage),
    "aria-label": `今日进度 ${done} / ${total || 0} 项完成`,
  });
  const fill = el("span", {
    class: "progress-meter-fill",
    style: `width:${percentage}%`,
  });
  meter.append(
    el("div", { class: "progress-meter-head" },
      el("span", { class: "progress-meter-label" }, "今日进度"),
      el("strong", { class: "progress-meter-value" }, `${done} / ${total || 0}`),
    ),
    el("div", { class: "progress-meter-track" }, fill),
    el("div", { class: "progress-meter-foot" },
      el("span", {}, complete ? "全部完成" : ""),
      el("span", {}, `${percentage}%`),
    ),
  );
  return meter;
}
