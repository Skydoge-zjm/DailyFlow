export type Priority = "low" | "normal" | "high";

export interface Task {
  id: string;
  title: string;
  notes: string;
  date: string;
  start: string | null;
  end: string | null;
  done: boolean;
  priority: Priority;
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

export interface Data {
  version: number;
  tasks: Task[];
  notes: Note[];
  settings: {
    theme: string;
    sticky_opacity: number;
    autostart: boolean;
  };
}
