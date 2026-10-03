import type { Data } from "./types.ts";
import type { RenderOpts } from "./ui-shared.ts";
import { el } from "./ui-shared.ts";

const WD = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function weekCal(data: Data, selected: string, today: string, opts: RenderOpts): HTMLElement {
  const base = new Date(selected + "T00:00:00");
  const monday = new Date(base);
  monday.setDate(base.getDate() - ((base.getDay() + 6) % 7));
  const grid = el("div", { class: "week-grid" });
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const ds = fmtDate(d);
    const dayTasks = data.tasks.filter((t) => t.date === ds);
    const cell = el(
      "button",
      {
        class: `week-day${ds === selected ? " selected" : ""}${ds === today ? " today" : ""}`,
        type: "button",
        "aria-pressed": String(ds === selected),
        "aria-label": `${ds}，${dayTasks.length} 项任务${ds === selected ? "，当前日期" : ""}`,
        onclick: () => opts.onSelectDate(ds),
      },
      el("span", { class: "wd" }, WD[d.getDay()].slice(1)),
      el("span", { class: "dn" }, String(d.getDate())),
      el("span", { class: "dots" },
        ...dayTasks.filter((t) => !t.done).slice(0, 4).map(() => el("span", { class: "dot" })),
        ...dayTasks.filter((t) => t.done).slice(0, 2).map(() => el("span", { class: "dot done-dot" })),
      ),
    );
    grid.append(cell);
  }
  // 选中日的月分标题（跨月导航时给用户方位感）
  const selMonth = `${base.getFullYear() % 100}年${base.getMonth() + 1}月`;
  return el(
    "div",
    { class: "week-cal" },
    el("div", { class: "week-cal-head" },
      el("div", { class: "panel-heading" },
        el("div", { class: "panel-eyebrow" }, "WEEK VIEW"),
        el("h3", {}, selMonth),
      ),
      el("button", {
        class: "week-nav",
        "aria-label": "上一周",
        title: "上一周（含更早日期）",
        onclick: () => {
          const d = new Date(selected + "T00:00:00");
          d.setDate(d.getDate() - 7);
          opts.onSelectDate(fmtDate(d));
        },
      }, "‹"),
      el("button", {
        class: "week-nav",
        "aria-label": "下一周",
        title: "下一周",
        onclick: () => {
          const d = new Date(selected + "T00:00:00");
          d.setDate(d.getDate() + 7);
          opts.onSelectDate(fmtDate(d));
        },
      }, "›"),
    ),
    grid,
  );
}
