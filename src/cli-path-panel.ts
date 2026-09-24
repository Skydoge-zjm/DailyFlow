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
    class: "theme-panel cli-path-panel",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "cli-path-title",
  });
  let statusValue: CliPathStatus | null = null;
  let busy = false;
  let observer: MutationObserver | undefined;

  const statusDot = el("span", { class: "cli-path-dot", "aria-hidden": "true" });
  const statusText = el("p", { class: "cli-path-status-text", role: "status", "aria-live": "polite" }, "正在检测 PATH...");
  const statusRow = el("div", { class: "cli-path-status" }, statusDot, statusText);
  const directoryValue = el("code", { class: "cli-path-directory" }, "检测后显示");
  const checkButton = el("button", {
    class: "tp-btn",
    onclick: () => void checkPath(),
  }, "检测 PATH");
  const addButton = el("button", {
    class: "tp-btn primary",
    onclick: () => void addToPath(),
  }, "一键配置");

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
    statusRow.classList.remove("is-error");
    statusDot.classList.remove("is-error", "is-ready");
    if (status.inUserPath) {
      statusText.textContent = "已加入当前用户 PATH。新开的终端可以直接运行 dailyflow。";
      statusDot.classList.add("is-ready");
    } else if (status.inCurrentPath) {
      statusText.textContent = "当前程序环境中可用，但尚未写入当前用户 PATH。";
    } else {
      statusText.textContent = "当前用户 PATH 尚未包含此目录。";
    }
    setBusy(false);
  }

  function showError(error: unknown): void {
    statusValue = null;
    statusRow.classList.add("is-error");
    statusDot.classList.remove("is-ready");
    statusDot.classList.add("is-error");
    statusText.textContent = `操作失败：${String(error)}`;
    setBusy(false);
  }

  async function checkPath(): Promise<void> {
    setBusy(true);
    statusText.textContent = "正在检测 PATH...";
    try {
      showStatus(await invoke<CliPathStatus>("fe_cli_path_status"));
    } catch (error) {
      showError(error);
    }
  }

  async function addToPath(): Promise<void> {
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
    el("div", { class: "cli-path-heading" },
      el("h2", { id: "cli-path-title", class: "tp-title" }, "命令行设置"),
      closeButton,
    ),
    el("p", { class: "cli-path-description" }, "将 DailyFlow 所在目录加入当前 Windows 用户的 PATH，之后可在终端或 AI 助手中直接运行 dailyflow。"),
    el("div", { class: "tp-sub" }, "PATH 状态"),
    statusRow,
    el("div", { class: "cli-path-directory-field" },
      el("span", { class: "cli-path-label" }, "应用目录"),
      directoryValue,
    ),
    actions,
    el("p", { class: "cli-path-hint" }, "配置仅修改当前用户环境变量，不需要管理员权限。已打开的终端需要重新启动后才会读取新 PATH。"),
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
