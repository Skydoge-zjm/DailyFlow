import { taskAddArgs } from "./cli-args.ts";
import { el, type RenderOpts } from "./ui-shared.ts";

let state = {
  title: "",
  time: "",
  kind: "normal",
  quadrant: "q2",
  priority: "",
  repeat: "none",
  remindMode: "start",
  remindTime: "",
};

export function quickAdd(opts: RenderOpts, selectedDate: string): HTMLElement {
  const title = el("input", { placeholder: "捕捉一项计划…", "aria-label": "任务标题", "data-focus-key": "quick-title" });
  const time = el("input", { placeholder: "时间 / 目标日", "aria-label": "时间或目标日期", "data-focus-key": "quick-time" });
  const priority = document.createElement("select");
  priority.dataset.focusKey = "quick-priority";
  for (const [value, label] of [["", "普通"], ["high", "高"], ["low", "低"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    priority.append(option);
  }
  const kind = document.createElement("select");
  kind.dataset.focusKey = "quick-kind";
  for (const [value, label] of [["normal", "✓ 待办"], ["deadline", "⏳ 截止"], ["goal", "🌱 长期"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    kind.append(option);
  }
  const quadrant = document.createElement("select");
  quadrant.dataset.focusKey = "quick-quadrant";
  quadrant.setAttribute("aria-label", "四象限");
  for (const [value, label] of [["q1", "Q1 重要且紧急"], ["q2", "Q2 重要不紧急"], ["q3", "Q3 不重要但紧急"], ["q4", "Q4 不重要不紧急"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    quadrant.append(option);
  }
  const repeat = document.createElement("select");
  repeat.dataset.focusKey = "quick-repeat";
  repeat.setAttribute("aria-label", "重复规则");
  for (const [value, label] of [["none", "不重复"], ["daily", "每天"], ["weekly", "每周"], ["monthly", "每月"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    repeat.append(option);
  }
  const remindMode = document.createElement("select");
  remindMode.dataset.focusKey = "quick-remind-mode";
  remindMode.setAttribute("aria-label", "提醒方式");
  for (const [value, label] of [["start", "随日程时间"], ["off", "不提醒"], ["custom", "指定提醒"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    remindMode.append(option);
  }
  const remindTime = el("input", { type: "time", "aria-label": "指定提醒时间", "data-focus-key": "quick-remind-time" });

  title.value = state.title;
  time.value = state.time;
  kind.value = state.kind;
  quadrant.value = state.quadrant;
  priority.value = state.priority;
  repeat.value = state.repeat;
  remindMode.value = state.remindMode;
  remindTime.value = state.remindTime;
  title.addEventListener("input", () => (state.title = title.value));
  time.addEventListener("input", () => (state.time = time.value));
  kind.addEventListener("change", () => (state.kind = kind.value));
  quadrant.addEventListener("change", () => (state.quadrant = quadrant.value));
  priority.addEventListener("change", () => (state.priority = priority.value));
  repeat.addEventListener("change", () => (state.repeat = repeat.value));
  remindTime.addEventListener("change", () => (state.remindTime = remindTime.value));

  const submitButton = el("button", { class: "qa-submit", type: "submit" },
    el("span", { class: "qa-submit-glyph", "aria-hidden": "true" }, "+"),
    el("span", { class: "qa-submit-label" }, "添加到 " + selectedDate.slice(5)),
  );
  const syncKind = () => {
    repeat.disabled = kind.value === "goal";
    remindMode.disabled = kind.value === "goal";
    if (repeat.disabled) { repeat.value = "none"; state.repeat = "none"; }
    if (remindMode.disabled) { remindMode.value = "off"; state.remindMode = "off"; }
    remindTime.hidden = remindMode.value !== "custom" || remindMode.disabled;
    remindTime.required = !remindTime.hidden;
    if (kind.value === "goal") {
      time.placeholder = "目标日期（可空，如 2026-12-31）";
      submitButton.querySelector(".qa-submit-label")!.textContent = "新长期目标";
    } else if (kind.value === "deadline") {
      time.placeholder = "时间（可空，如 9:30）";
      submitButton.querySelector(".qa-submit-label")!.textContent = "截止于 " + selectedDate.slice(5);
    } else {
      time.placeholder = "时间（可空，如 9:30）";
      submitButton.querySelector(".qa-submit-label")!.textContent = "添加到 " + selectedDate.slice(5);
    }
  };
  kind.addEventListener("change", syncKind);
  remindMode.addEventListener("change", () => {
    state.remindMode = remindMode.value;
    syncKind();
  });
  syncKind();

  const form = el("form", {},
    title,
    el("div", { class: "qa-row" }, time, priority),
    el("div", { class: "qa-row" }, kind, quadrant),
    el("div", { class: "qa-row" }, repeat, remindMode),
    el("div", { class: "qa-row" }, remindTime),
    submitButton,
    el("div", { class: "qa-hint" }, "截止日会自动进入追踪 · 长期目标会常驻列表"),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const titleText = title.value.trim();
    if (!titleText) return;
    const isGoal = kind.value === "goal";
    const result = await opts.onCall(taskAddArgs(titleText, {
      kind: kind.value,
      date: isGoal ? time.value.trim() || undefined : selectedDate,
      start: !isGoal ? time.value.trim() || undefined : undefined,
      priority: priority.value || undefined,
      quadrant: quadrant.value,
      repeat: !isGoal && repeat.value !== "none" ? repeat.value : undefined,
      remind: !isGoal
        ? remindMode.value === "off"
          ? "off"
          : remindMode.value === "custom"
            ? remindTime.value
            : undefined
        : undefined,
    }));
    if (!result.ok) return;
    state = {
      title: "",
      time: "",
      kind: "normal",
      quadrant: "q2",
      priority: "",
      repeat: "none",
      remindMode: "start",
      remindTime: "",
    };
    window.__dailyflow.rerender();
  });
  return el("div", { class: "quick-add" },
    el("div", { class: "panel-heading" },
      el("div", { class: "panel-eyebrow" }, "CAPTURE"),
      el("h3", {}, "快速添加"),
    ),
    form,
  );
}
