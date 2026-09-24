export type TaskAddOptions = Partial<Record<
  "kind" | "date" | "start" | "end" | "priority" | "tags" | "notes" | "quadrant" | "repeat" | "remind",
  string
>>;

export type TaskEditChange = readonly [flag: string, before: string, after: string];

export function taskAddArgs(title: string, options: TaskAddOptions): string[] {
  const args = ["task", "add", title];
  for (const [flag, value] of Object.entries(options)) {
    if (value !== undefined && value !== "") args.push(`--${flag}`, value);
  }
  return args;
}

export function taskEditArgs(id: string, changes: readonly TaskEditChange[]): string[] {
  const args = ["task", "edit", id];
  for (const [flag, before, after] of changes) {
    if (after !== before) args.push(`--${flag}`, flag === "remind" && !after ? "off" : after);
  }
  return args;
}

export const taskToggleArgs = (id: string) => ["task", "toggle", id];
export const taskDeleteArgs = (id: string) => ["task", "delete", id];
export const noteVisibilityArgs = (id: string, visible: boolean) => ["note", visible ? "show" : "hide", id];
export const noteDeleteArgs = (id: string) => ["note", "delete", id];
export const taskClearDoneArgs = (date?: string) => date ? ["task", "clear-done", date] : ["task", "clear-done"];
export const undoArgs = (...ids: string[]) => ["undo", ...ids];
