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

export function buildRing(p: number, allDone: boolean): HTMLElement {
  const r = 21;
  const c = 2 * Math.PI * r;
  const wrap = el("div", { class: "progress-ring", title: allDone ? "全部完成 🎉" : "完成率" });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "52");
  svg.setAttribute("height", "52");
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  const fg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  for (const [circle, cls] of [[bg, "ring-bg"], [fg, "ring-fg"]] as const) {
    circle.setAttribute("cx", "26");
    circle.setAttribute("cy", "26");
    circle.setAttribute("r", String(r));
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke-width", "4");
    circle.setAttribute("class", cls);
  }
  if (allDone) {
    fg.classList.add("done-all");
  }
  fg.setAttribute("stroke-dasharray", String(c));
  fg.setAttribute("stroke-dashoffset", String(c * (1 - p)));
  fg.setAttribute("stroke-linecap", "round");
  svg.append(bg, fg);
  const label = el("div", { class: `ring-label${allDone ? " done-all" : ""}` }, allDone ? "✓" : `${Math.round(p * 100)}%`);
  wrap.append(svg, label);
  return wrap;
}

