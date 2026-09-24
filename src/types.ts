export type Priority = "low" | "normal" | "high";
export type TaskKind = "normal" | "deadline" | "goal";
export type RepeatRule = "none" | "daily" | "weekly" | "monthly";
export type Quadrant = "q1" | "q2" | "q3" | "q4";

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
  quadrant: Quadrant;
  repeat: RepeatRule;
  repeat_day?: number | null;
  repeat_parent_id?: string | null;
  remind_at?: string | null;
  reminded_at?: string | null;
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
  monitor?: string;
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
  widget_w: number;
  widget_h: number;
  widget_monitor: string;
}

export interface Data {
  version: number;
  tasks: Task[];
  notes: Note[];
  settings: Settings;
}
