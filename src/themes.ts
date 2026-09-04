/* ============================================================
   DailyFlow 主题系统
   - preset = 完整 CSS（每主题一份，vite ?raw 注入 <style>）
   - data.settings.theme_preset 选择 preset；classic = index.html 里的 styles.css
   - data.settings.theme_overrides 覆盖任意 CSS 变量（用户自定义，最后叠加）
   ============================================================ */

import refinedMinimalCss from "./themes/refined-minimal.css?raw";
import glassmorphismCss from "./themes/glassmorphism.css?raw";
import warmJournalCss from "./themes/warm-journal.css?raw";

export interface ThemeOverrides {
  [cssVar: string]: string;
}

/** CSS 变量清单（用户在自定义面板里能改的全部） */
export const THEME_VARS: Array<{ key: string; label: string; kind: "color" | "number" | "text"; def?: string }> = [
  { key: "--bg", label: "页面底色", kind: "color" },
  { key: "--bg-soft", label: "次级底色", kind: "color" },
  { key: "--card", label: "卡片底色", kind: "color" },
  { key: "--card-hover", label: "卡片悬停", kind: "color" },
  { key: "--border", label: "边框", kind: "color" },
  { key: "--border-soft", label: "细边框", kind: "color" },
  { key: "--text", label: "正文文字", kind: "color" },
  { key: "--text-dim", label: "次要文字", kind: "color" },
  { key: "--text-faint", label: "弱化文字", kind: "color" },
  { key: "--accent", label: "强调色", kind: "color" },
  { key: "--accent-soft", label: "强调色淡底", kind: "color" },
  { key: "--teal", label: "时间青", kind: "color" },
  { key: "--red", label: "警示红", kind: "color" },
  { key: "--green", label: "完成绿", kind: "color" },
  { key: "--blue", label: "蓝色", kind: "color" },
  { key: "--pri-high", label: "高优先级", kind: "color" },
  { key: "--pri-normal", label: "普通优先级", kind: "color" },
  { key: "--pri-low", label: "低优先级", kind: "color" },
  { key: "--radius", label: "圆角(px)", kind: "number" },
  { key: "--radius-lg", label: "大圆角(px)", kind: "number" },
  { key: "--font", label: "字体栈", kind: "text" },
];

/** 主题名 → 完整 CSS。classic（classic-dark/classic-light）用 index.html 静态引入的 styles.css */
const PRESET_CSS: Record<string, string> = {
  "refined-minimal": refinedMinimalCss,
  "glassmorphism": glassmorphismCss,
  "warm-journal": warmJournalCss,
};

export const PRESET_NAMES = ["classic-dark", "classic-light", ...Object.keys(PRESET_CSS)] as const;

export interface ThemePresetMeta {
  name: string;
  label: string;
  /** 供预览色卡的四个代表色（从 CSS 变量抽） */
  swatch: { bg: string; card: string; accent: string; text: string };
}

export const PRESETS: ThemePresetMeta[] = [
  { name: "classic-dark", label: "经典 · 深色", swatch: { bg: "#14161a", card: "#1d2026", accent: "#ff9f43", text: "#e8eaf0" } },
  { name: "classic-light", label: "经典 · 浅色", swatch: { bg: "#f5f6f8", card: "#ffffff", accent: "#ff9f43", text: "#22252b" } },
  { name: "refined-minimal", label: "精致留白", swatch: { bg: "#0e1013", card: "#17191e", accent: "#d9a05b", text: "#e6e8ee" } },
  { name: "glassmorphism", label: "玻璃拟态", swatch: { bg: "#0d1220", card: "#1a2133", accent: "#ff9f52", text: "#eaedf5" } },
  { name: "warm-journal", label: "暖色手账", swatch: { bg: "#faf5ec", card: "#fffdf8", accent: "#e8965a", text: "#4a4238" } },
];

export function presetByName(name: string): ThemePresetMeta {
  return PRESETS.find((p) => p.name === name) ?? PRESETS[0];
}

/**
 * 应用主题：preset CSS（动态注入 <style id="theme-preset">）+ overrides（写 root inline 变量）。
 * classic 主题 = 移除注入（回落到静态 styles.css）。
 * 明暗由调用方先设置 document.documentElement.dataset.theme 再调本函数。
 */
export function applyTheme(presetName: string, isLight: boolean, overrides: ThemeOverrides): void {
  const root = document.documentElement;
  root.dataset.theme = isLight ? "light" : "dark";

  // 1) preset CSS
  let styleEl = document.getElementById("theme-preset") as HTMLStyleElement | null;
  const css = PRESET_CSS[presetName];
  if (!css) {
    styleEl?.remove(); // classic：回落静态 CSS
  } else {
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "theme-preset";
      document.head.append(styleEl);
    }
    if (styleEl.textContent !== css) styleEl.textContent = css;
  }

  // 2) 用户 overrides（清空后重写，保证删除的覆盖项复原）
  for (const prop of Object.keys(root.style)) {
    if (prop.startsWith("--")) root.style.removeProperty(prop);
  }
  for (const [k, v] of Object.entries(overrides || {})) {
    if (k.startsWith("--") && v) root.style.setProperty(k, v);
  }
}
