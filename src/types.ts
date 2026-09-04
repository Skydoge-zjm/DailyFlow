export type Priority = "low" | "normal" | "high";
export type TaskKind = "normal" | "deadline" | "goal";

export interface Task {
  id: string;
  title: string;
  notes: string;
  date: string; // normal=归属日; deadline=截止日; goal=可选目标日(""=无)
  start: string | null;
  end: string | null;
  done: boolean;
  priority: Priority;
  kind: TaskKind;
  tags: string[];
  created_at: string;
  completed_at: string | null;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  pinned: boolean;
  visible: boolean;
  created_at: string;
  updated_at: string;
}

export interface Settings {
  theme: string; // dark | light
  theme_preset: string; // 主题 preset 名，见 themes.ts PRESETS
  theme_overrides: Record<string, string>; // CSS 变量覆盖
  sticky_opacity: number;
  autostart: boolean;
  widget_visible: boolean;
  widget_pinned: boolean;
  widget_x: number;
  widget_y: number;
}

export interface Data {
  version: number;
  tasks: Task[];
  notes: Note[];
  settings: Settings;
}
