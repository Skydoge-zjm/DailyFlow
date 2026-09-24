import type { Settings } from "./types.ts";
import { PRESETS, PRESET_NAMES, THEME_VARS, sanitizeThemeOverrides, type ThemeOverrides } from "./themes.ts";
import { el, type RenderOpts } from "./ui-shared.ts";

export function openThemePanel(opts: RenderOpts): void {
  document.querySelector(".cli-path-panel")?.remove();
  document.querySelector(".theme-panel")?.remove();
  document.querySelector(".theme-backdrop")?.remove();
  const settings = opts.data.settings;
  const overrides: ThemeOverrides = { ...(settings.theme_overrides || {}) };
  const panel = el("div", { class: "theme-panel" });
  const backdrop = el("div", { class: "theme-backdrop" });

  const presetRow = el("div", { class: "tp-presets" });
  const rebuildPresetRow = () => {
    presetRow.replaceChildren();
    for (const preset of PRESETS) {
      const chip = el(
        "button",
        {
          class: `tp-preset${(settings.theme_preset || "classic-dark") === preset.name ? " active" : ""}`,
          title: preset.label,
          onclick: async () => {
            const patch: Partial<Settings> = { theme_preset: preset.name };
            if (preset.name === "classic-light") patch.theme = "light";
            else if (preset.name === "classic-dark") patch.theme = "dark";
            if (await opts.onSettings(patch)) {
              settings.theme_preset = preset.name;
              if (patch.theme) settings.theme = patch.theme;
              rebuildPresetRow();
              rebuildVars();
            }
          },
        },
        el("span", { class: "tp-swatch" },
          el("i", { style: `background:${preset.swatch.bg}` }),
          el("i", { style: `background:${preset.swatch.card}` }),
          el("i", { style: `background:${preset.swatch.accent}` }),
          el("i", { style: `background:${preset.swatch.text}` }),
        ),
        el("span", { class: "tp-name" }, preset.label),
      );
      presetRow.append(chip);
    }
  };
  rebuildPresetRow();

  const varsGrid = el("div", { class: "tp-vars" });
  const rebuildVars = () => {
    varsGrid.replaceChildren();
    for (const variable of THEME_VARS) {
      const current = overrides[variable.key] ?? "";
      const row = el("div", { class: "tp-var" });
      const label = el("label", {}, variable.label);
      label.title = variable.key;
      row.append(label);
      if (variable.kind === "color") {
        const swatch = el("button", { class: "tp-swatch-btn", title: "点击取色" });
        const colorInput = document.createElement("input");
        colorInput.type = "color";
        const computed = getComputedStyle(document.documentElement).getPropertyValue(variable.key).trim();
        colorInput.value = toHexColor(current || computed || "#888888");
        colorInput.className = "tp-color-input";
        swatch.style.background = colorInput.value;
        colorInput.addEventListener("input", () => {
          swatch.style.background = colorInput.value;
          overrides[variable.key] = colorInput.value;
          previewOverrides();
        });
        swatch.append(colorInput);
        row.append(swatch);
      } else {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "tp-text-input";
        input.placeholder = "默认";
        input.value = current;
        input.addEventListener("change", () => {
          if (input.value.trim()) overrides[variable.key] = input.value.trim();
          else delete overrides[variable.key];
          previewOverrides();
        });
        row.append(input);
      }
      row.append(el("button", {
        class: "tp-reset-one",
        title: "恢复默认",
        onclick: async () => {
          delete overrides[variable.key];
          void opts.onSettings({ theme_overrides: { ...overrides } });
        },
      }, "↺"));
      varsGrid.append(row);
    }
  };
  rebuildVars();

  function previewOverrides() {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(sanitizeThemeOverrides(overrides))) {
      root.style.setProperty(key, value);
    }
  }

  function cancelPreview() {
    panel.remove();
    backdrop.remove();
    void opts.onSettings({ theme_overrides: { ...(settings.theme_overrides || {}) } });
  }

  const applyButton = el("button", {
    class: "tp-btn primary",
    onclick: async () => {
      if (await opts.onSettings({ theme_overrides: { ...overrides } })) {
        panel.remove();
        backdrop.remove();
      }
    },
  }, "应用自定义");
  const resetButton = el("button", {
    class: "tp-btn",
    onclick: async () => {
      for (const key of Object.keys(overrides)) delete overrides[key];
      rebuildVars();
      previewOverrides();
      await opts.onSettings({ theme_overrides: {} });
    },
  }, "全部恢复默认");
  const exportButton = el("button", {
    class: "tp-btn",
    title: "复制当前主题 JSON（可分享/导入）",
    onclick: async () => {
      const json = JSON.stringify({
        preset: settings.theme_preset,
        theme: settings.theme,
        overrides: sanitizeThemeOverrides(overrides),
      }, null, 2);
      try {
        await navigator.clipboard.writeText(json);
        window.__dailyflow.toast("主题 JSON 已复制到剪贴板");
      } catch {
        window.__dailyflow.toast("复制失败，请手动选择文本", true);
      }
    },
  }, "导出");
  const importInput = document.createElement("textarea");
  importInput.className = "tp-import";
  importInput.placeholder = '粘贴主题 JSON 导入，如 {"preset":"warm-journal","overrides":{"--accent":"#e8965a"}}';
  const importButton = el("button", {
    class: "tp-btn",
    onclick: async () => {
      try {
        const parsed: unknown = JSON.parse(importInput.value);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("主题 JSON 必须是对象");
        }
        const record = parsed as Record<string, unknown>;
        const themeValue = record.theme;
        if (themeValue !== undefined && !["dark", "light", "auto"].includes(String(themeValue))) {
          throw new Error("theme 必须是 dark、light 或 auto");
        }
        const presetValue = record.preset;
        if (presetValue !== undefined && (typeof presetValue !== "string" || !PRESET_NAMES.some((name) => name === presetValue))) {
          throw new Error("preset 不是受支持的主题");
        }
        const overridesValue = record.overrides;
        if (overridesValue !== undefined && (!overridesValue || typeof overridesValue !== "object" || Array.isArray(overridesValue))) {
          throw new Error("overrides 必须是对象");
        }
        const imported = await opts.onSettings({
          theme: (themeValue as Settings["theme"] | undefined) || settings.theme,
          theme_preset: (presetValue as string | undefined) || settings.theme_preset,
          theme_overrides: (overridesValue as ThemeOverrides | undefined) || {},
        });
        if (imported) {
          panel.remove();
          backdrop.remove();
          window.__dailyflow.toast("主题已导入");
        }
      } catch {
        window.__dailyflow.toast("主题 JSON 格式无效", true);
      }
    },
  }, "导入");

  const actions = el("div", { class: "tp-actions" }, resetButton, exportButton, importButton, applyButton);
  panel.append(
    el("div", { class: "tp-title" }, "🎨 主题与外观"),
    el("div", { class: "tp-sub" }, "预设"),
    presetRow,
    el("div", { class: "tp-sub" }, "自定义变量（覆盖当前预设）"),
    varsGrid,
    importInput,
    actions,
  );
  backdrop.addEventListener("click", cancelPreview);
  const escHandler = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      cancelPreview();
      window.removeEventListener("keydown", escHandler);
    }
  };
  window.addEventListener("keydown", escHandler);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(panel)) {
      window.removeEventListener("keydown", escHandler);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
  document.body.append(backdrop, panel);
}

function toHexColor(color: string): string {
  const value = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    const toHex = (component: string) => Number(component).toString(16).padStart(2, "0");
    return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`;
  }
  return "#888888";
}
