import { invoke } from "@tauri-apps/api/core";
import { el } from "./ui-shared.ts";

interface CliPathStatus {
  executableDirectory: string;
  inCurrentPath: boolean;
  inUserPath: boolean;
}

export function openCliPathPanel(): void {
  document.querySelector(".theme-panel")?.remove();
  document.querySelector(".theme-backdrop")?.remove();

  const backdrop = el("div", { class: "theme-backdrop" });
  const panel = el("section", {
    class: "theme-panel settings-panel cli-path-panel",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "cli-path-title",
  });
  let statusValue: CliPathStatus | null = null;
  let busy = false;
  const isPreview = !("__TAURI__" in window);
  let observer: MutationObserver | undefined;

  const statusDot = el("span", { class: "cli-path-dot", "aria-hidden": "true" });
  const statusLabel = el("strong", { class: "settings-status-label" }, "检查中");
  const statusText = el("p", { class: "cli-path-status-text", role: "status", "aria-live": "polite" }, "正在检测 PATH...");
  const statusRow = el("div", { class: "cli-path-status" }, statusDot, el("div", { class: "settings-status-copy" }, statusLabel, statusText));
  const directoryValue = el("code", { class: "cli-path-directory" }, "检测后显示");
  const checkButton = el("button", {
    class: "tp-btn",
    onclick: () => void checkPath(),
  }, "检测状态");
  const addButton = el("button", {
    class: "tp-btn primary",
    onclick: () => void addToPath(),
  }, "加入用户 PATH");
  const autostart = document.createElement("input");
  autostart.type = "checkbox";
  autostart.checked = window.__dailyflow.data.settings.autostart;
  autostart.setAttribute("aria-label", "登录 Windows 时启动 DailyFlow");
  autostart.addEventListener("change", async () => {
    const requested = autostart.checked;
    autostart.disabled = true;
    const saved = await window.__dailyflow.saveSettings({ autostart: requested });
    if (!saved) autostart.checked = window.__dailyflow.data.settings.autostart;
    autostart.disabled = false;
  });
  const autostartRow = el("label", { class: "settings-toggle-row" },
    autostart,
    el("span", { class: "settings-option-copy" },
      el("strong", {}, "登录 Windows 时启动"),
      el("small", {}, "打开电脑后自动运行 DailyFlow"),
    ),
  );
  const widgetPolicy = document.createElement("select");
  widgetPolicy.className = "cli-path-policy-select";
  widgetPolicy.setAttribute("aria-label", "悬浮窗启动策略");
  widgetPolicy.append(
    new Option("记住上次状态", "last_state"),
    new Option("每次启动都显示", "always"),
    new Option("只在主动打开时显示", "manual"),
  );
  widgetPolicy.value = window.__dailyflow.data.settings.widget_policy;
  widgetPolicy.addEventListener("change", async () => {
    widgetPolicy.disabled = true;
    const policy = widgetPolicy.value as "always" | "last_state" | "manual";
    try {
      const saved = await window.__dailyflow.saveSettings({
        widget_policy: policy,
        ...(policy !== "last_state" && { widget_visible: policy === "always" }),
      });
      if (!saved) widgetPolicy.value = window.__dailyflow.data.settings.widget_policy;
    } finally {
      widgetPolicy.disabled = false;
      widgetPolicy.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  const widgetPolicyRow = el("div", { class: "settings-option-row" },
    el("div", { class: "settings-option-copy" },
      el("strong", {}, "悬浮窗启动策略"),
      el("small", {}, "决定 DailyFlow 启动时是否显示今日悬浮窗"),
    ),
    widgetPolicy,
  );

  const closePanel = () => {
    panel.remove();
    backdrop.remove();
    window.removeEventListener("keydown", onKeydown);
    observer?.disconnect();
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") closePanel();
  };

  function setBusy(value: boolean): void {
    busy = value;
    checkButton.disabled = busy;
    addButton.disabled = busy || statusValue?.inUserPath === true;
    addButton.textContent = statusValue?.inUserPath ? "已加入用户 PATH" : "一键配置";
    panel.setAttribute("aria-busy", String(busy));
  }

  function showStatus(status: CliPathStatus): void {
    statusValue = status;
    directoryValue.textContent = status.executableDirectory;
    statusRow.classList.remove("is-error", "is-preview");
    statusDot.classList.remove("is-error", "is-ready");
    if (status.inUserPath) {
      statusLabel.textContent = "已配置";
      statusText.textContent = "新开的终端和 AI 助手可以直接运行 dailyflow。";
      statusDot.classList.add("is-ready");
    } else if (status.inCurrentPath) {
      statusLabel.textContent = "当前可用";
      statusText.textContent = "当前程序环境可以运行，但还没有写入用户 PATH。";
    } else {
      statusLabel.textContent = "未配置";
      statusText.textContent = "将应用目录加入当前用户 PATH，终端即可直接调用。";
    }
    setBusy(false);
  }

  function showPreviewStatus(): void {
    statusValue = null;
    statusLabel.textContent = "预览模式";
    statusRow.classList.remove("is-error");
    statusRow.classList.add("is-preview");
    statusDot.classList.remove("is-error", "is-ready");
    statusText.textContent = "浏览器预览不会访问 Windows PATH；打包应用中可检测和配置。";
    directoryValue.textContent = "仅桌面应用可用";
    checkButton.disabled = true;
    addButton.disabled = true;
    panel.classList.add("is-preview");
  }

  function showError(error: unknown): void {
    statusValue = null;
    statusLabel.textContent = "检测失败";
    statusRow.classList.add("is-error");
    statusDot.classList.remove("is-ready");
    statusDot.classList.add("is-error");
    statusText.textContent = `请稍后重试：${String(error)}`;
    setBusy(false);
  }

  async function checkPath(): Promise<void> {
    if (isPreview) {
      showPreviewStatus();
      return;
    }
    setBusy(true);
    statusText.textContent = "正在检测 PATH...";
    try {
      showStatus(await invoke<CliPathStatus>("fe_cli_path_status"));
    } catch (error) {
      showError(error);
    }
  }

  async function addToPath(): Promise<void> {
    if (isPreview) {
      showPreviewStatus();
      return;
    }
    setBusy(true);
    statusText.textContent = "正在写入当前用户 PATH...";
    try {
      showStatus(await invoke<CliPathStatus>("fe_cli_path_add"));
      if (statusValue?.inUserPath) {
        statusText.textContent = "配置完成。请重新打开终端后运行 dailyflow。";
      }
    } catch (error) {
      showError(error);
    }
  }

  const closeButton = el("button", {
    class: "cli-path-close",
    type: "button",
    title: "关闭设置",
    "aria-label": "关闭设置",
    onclick: closePanel,
  }, "×");
  const actions = el("div", { class: "cli-path-actions" }, checkButton, addButton);

  panel.append(
    el("div", { class: "settings-heading" },
      el("div", {},
        el("div", { class: "settings-eyebrow" }, "DAILYFLOW"),
        el("h2", { id: "cli-path-title", class: "tp-title" }, "应用设置"),
      ),
      closeButton,
    ),
    el("p", { class: "settings-intro" }, "管理 DailyFlow 的启动方式、悬浮窗行为，以及终端和 AI 助手的访问方式。"),
    el("section", { class: "settings-section" },
      el("div", { class: "settings-section-head" },
        el("h3", {}, "启动与悬浮窗"),
        el("p", {}, "控制登录启动和今日悬浮窗的显示策略。"),
      ),
      autostartRow,
      widgetPolicyRow,
    ),
    el("section", { class: "settings-section settings-cli-section" },
      el("div", { class: "settings-section-head" },
        el("h3", {}, "命令行与 AI"),
        el("p", {}, "让终端和 AI 助手可以直接调用 DailyFlow。"),
      ),
      statusRow,
      el("div", { class: "cli-path-directory-field" },
        el("span", { class: "cli-path-label" }, "安装目录"),
        directoryValue,
      ),
      actions,
      el("p", { class: "cli-path-hint" }, "只修改当前用户环境变量，不需要管理员权限。配置后请重新打开终端。"),
    ),
  );

  backdrop.addEventListener("click", closePanel);
  window.addEventListener("keydown", onKeydown);
  document.body.append(backdrop, panel);
  observer = new MutationObserver(() => {
    if (!document.body.contains(panel)) closePanel();
  });
  observer.observe(document.body, { childList: true });
  void checkPath();
  checkButton.focus({ preventScroll: true });
}
