import type { Data, Project, Task } from "./types.ts";
import { el } from "./ui-shared.ts";

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()#+.!|>~-]/g, "\\$&");
}

function taskOrder(left: Task, right: Task): number {
  return (left.date || "9999").localeCompare(right.date || "9999")
    || (left.start || "99:99").localeCompare(right.start || "99:99")
    || Number(left.done) - Number(right.done)
    || left.title.localeCompare(right.title)
    || left.id.localeCompare(right.id);
}

function taskLine(task: Task, indent = ""): string {
  const checkbox = task.done ? "x" : " ";
  const timing = [task.date, task.start && `${task.start}${task.end ? `–${task.end}` : ""}`].filter(Boolean).join(" ");
  const meta = [
    timing,
    task.priority !== "normal" ? `优先级:${task.priority === "high" ? "高" : "低"}` : "",
    task.kind !== "normal" ? `类型:${task.kind === "deadline" ? "截止" : "长期"}` : "",
    task.tags.length ? `标签:${task.tags.join(", ")}` : "",
  ].filter(Boolean).join(" · ");
  const notes = task.notes.trim() ? `\n${indent}  > ${escapeMarkdown(task.notes.trim())}` : "";
  return `${indent}- [${checkbox}] ${escapeMarkdown(task.title)}${meta ? ` — ${escapeMarkdown(meta)}` : ""}${notes}`;
}

function markdownFor(data: Data): string {
  const lines = [
    "# DailyFlow 导出",
    "",
    `导出时间：${new Date().toLocaleString()}`,
    "",
    "## 项目",
    "",
  ];
  const byProject = new Map<string, Task[]>();
  for (const task of data.tasks) {
    const key = task.project_id || "__unassigned__";
    const tasks = byProject.get(key) || [];
    tasks.push(task);
    byProject.set(key, tasks);
  }
  const projects = [...data.projects].sort((a, b) => a.name.localeCompare(b.name));
  const renderProject = (project: Project | undefined, tasks: Task[]) => {
    lines.push(`### ${escapeMarkdown(project?.name || "未归属项目")}`, "");
    if (project?.description) lines.push(escapeMarkdown(project.description), "");
    const sorted = [...tasks].sort(taskOrder);
    if (!sorted.length) lines.push("_暂无任务_", "");
    else lines.push(...sorted.map((task) => taskLine(task)), "");
  };
  for (const project of projects) renderProject(project, byProject.get(project.id) || []);
  renderProject(undefined, byProject.get("__unassigned__") || []);

  lines.push("## 桌面便签", "");
  if (data.notes.length) {
    for (const note of data.notes) {
      lines.push(`### ${escapeMarkdown(note.title || "未命名便签")}`, "", note.body.trim() || "_空便签_", "");
    }
  } else {
    lines.push("_暂无便签_", "");
  }
  return lines.join("\n");
}

function jsonFor(data: Data): string {
  return JSON.stringify({
    format: "dailyflow-export",
    format_version: 1,
    exported_at: new Date().toISOString(),
    data: {
      version: data.version,
      tasks: data.tasks,
      projects: data.projects,
      notes: data.notes,
      settings: data.settings,
    },
  }, null, 2);
}

function downloadText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function openExportPanel(data: Data): void {
  document.querySelector(".theme-panel")?.remove();
  document.querySelector(".theme-backdrop")?.remove();

  const backdrop = el("div", { class: "theme-backdrop" });
  const panel = el("section", {
    class: "theme-panel export-panel",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "export-title",
  });
  const format = document.createElement("select");
  format.className = "export-format-select";
  format.setAttribute("aria-label", "导出格式");
  format.append(new Option("Markdown（适合阅读和分享）", "markdown"));
  format.append(new Option("JSON（适合备份和程序处理）", "json"));

  const close = () => {
    panel.remove();
    backdrop.remove();
    window.removeEventListener("keydown", onKeydown);
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  const exportNow = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (format.value === "json") {
      downloadText(`dailyflow-export-${stamp}.json`, jsonFor(data), "application/json");
      window.__dailyflow.toast("JSON 导出已开始");
    } else {
      downloadText(`dailyflow-export-${stamp}.md`, markdownFor(data), "text/markdown");
      window.__dailyflow.toast("Markdown 导出已开始");
    }
    close();
  };

  panel.append(
    el("div", { class: "export-heading" },
      el("div", {},
        el("div", { class: "panel-eyebrow" }, "EXPORT"),
        el("h2", { id: "export-title", class: "tp-title" }, "导出工作区"),
      ),
      el("button", { class: "cli-path-close", type: "button", "aria-label": "关闭导出面板", onclick: close }, "×"),
    ),
    el("p", { class: "export-description" }, "导出任务、项目、桌面便签和必要设置。撤销历史不会包含在工作区导出中。"),
    el("label", { class: "export-field" }, el("span", {}, "格式"), format),
    el("div", { class: "export-actions" },
      el("button", { class: "tp-btn", type: "button", onclick: close }, "取消"),
      el("button", { class: "tp-btn primary", type: "button", onclick: exportNow }, "开始导出"),
    ),
  );
  backdrop.addEventListener("click", close);
  window.addEventListener("keydown", onKeydown);
  document.body.append(backdrop, panel);
  format.focus({ preventScroll: true });
}
