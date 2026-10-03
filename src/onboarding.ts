import { el } from "./ui-shared.ts";

let selectedPolicy: "always" | "last_state" | "manual" = "last_state";

export function closeOnboarding(): void {
  document.querySelector(".onboarding-backdrop")?.remove();
  document.querySelector(".onboarding-panel")?.remove();
}

export function openOnboarding(): void {
  if (document.querySelector(".onboarding-panel")) return;
  selectedPolicy = window.__dailyflow.data.settings.widget_policy || "last_state";

  const backdrop = el("div", { class: "onboarding-backdrop" });
  const panel = el("section", {
    class: "onboarding-panel",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "onboarding-title",
  });
  const policyOptions = el("div", { class: "onboarding-policy-options" });
  const completeButton = el("button", { class: "tp-btn primary onboarding-complete", type: "button" }, "开始使用");

  const options: Array<["always" | "last_state" | "manual", string, string]> = [
    ["last_state", "记住上次状态", "你显示过它，它就会继续显示；隐藏后下次保持隐藏。"],
    ["always", "每次启动都显示", "打开 DailyFlow 时自动显示今日悬浮窗。"],
    ["manual", "只在我主动打开时显示", "应用启动时保持安静，需要时从托盘或主窗口打开。"],
  ];
  for (const [value, title, description] of options) {
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "widget-policy";
    input.value = value;
    input.checked = selectedPolicy === value;
    input.addEventListener("change", () => {
      if (input.checked) selectedPolicy = value;
    });
    const label = el("label", { class: `onboarding-policy${input.checked ? " selected" : ""}` },
      input,
      el("span", { class: "onboarding-policy-copy" },
        el("strong", {}, title),
        el("small", {}, description),
      ),
    );
    input.addEventListener("change", () => {
      for (const node of policyOptions.querySelectorAll(".onboarding-policy")) node.classList.remove("selected");
      if (input.checked) label.classList.add("selected");
    });
    policyOptions.append(label);
  }

  completeButton.addEventListener("click", async () => {
    completeButton.disabled = true;
    const saved = await window.__dailyflow.saveSettings({
      widget_policy: selectedPolicy,
      widget_visible: selectedPolicy !== "manual",
      onboarding_completed: true,
    });
    if (!saved) completeButton.disabled = false;
  });
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) window.__dailyflow.toast("请先选择悬浮窗策略并完成设置", true);
  });

  panel.append(
    el("div", { class: "onboarding-mark", "aria-hidden": "true" }, "df"),
    el("div", { class: "panel-eyebrow" }, "WELCOME TO DAILYFLOW"),
    el("h1", { id: "onboarding-title", class: "onboarding-title" }, "让今天的安排清楚可见"),
    el("p", { class: "onboarding-lead" }, "任务、项目、桌面便签和 AI 助手都可以使用同一份本地数据。先选择你希望如何使用今日悬浮窗。"),
    el("h2", { class: "onboarding-section-title" }, "悬浮窗启动策略"),
    policyOptions,
    el("div", { class: "onboarding-shortcuts" },
      el("strong", {}, "几个常用快捷键"),
      el("span", {}, "Ctrl + K 快速添加 · Ctrl + F 搜索 · Ctrl + 1/2/3 切换视图 · Esc 关闭面板"),
    ),
    el("div", { class: "onboarding-actions" }, completeButton),
  );
  document.body.append(backdrop, panel);
  completeButton.focus({ preventScroll: true });
}
