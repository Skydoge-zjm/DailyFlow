use serde_json::Value;

use crate::domain::{Ctx, TaskAddInput, TaskEditPatch};
use crate::error::{AppError, AppResult};

/// Typed application commands shared by the CLI and Tauri frontend.
/// `Legacy` is deliberately kept as a compatibility escape hatch for commands
/// whose parser has not yet moved to the typed surface.
#[derive(Debug, Clone)]
pub enum Command {
    TaskAdd(TaskAddInput),
    TaskEdit {
        id: String,
        patch: TaskEditPatchOwned,
    },
    TaskSetDone {
        id: String,
        done: bool,
    },
    TaskToggle {
        id: String,
    },
    TaskDelete {
        id: String,
    },
    TaskMove {
        id: String,
        date: String,
    },
    TaskClearDone {
        date: String,
    },
    ProjectAdd {
        name: String,
        description: String,
    },
    ProjectEdit {
        id: String,
        name: Option<String>,
        description: Option<String>,
    },
    ProjectArchive {
        id: String,
        archived: bool,
    },
    ProjectDelete {
        id: String,
    },
    NoteAdd {
        body: String,
        title: String,
        color: String,
    },
    NoteEdit {
        id: String,
        title: Option<String>,
        body: Option<String>,
        color: Option<String>,
    },
    NoteDelete {
        id: String,
    },
    NoteVisibility {
        id: String,
        visible: bool,
    },
    NotePin {
        id: String,
        pinned: bool,
    },
    WidgetVisibility {
        visible: bool,
    },
    WidgetPin {
        pinned: bool,
    },
    Legacy(Vec<String>),
}

#[derive(Debug, Clone, Default)]
pub struct TaskEditPatchOwned {
    pub title: Option<String>,
    pub date: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub priority: Option<String>,
    pub tags: Option<String>,
    pub notes: Option<String>,
    pub kind: Option<String>,
    pub quadrant: Option<String>,
    pub repeat: Option<String>,
    pub remind: Option<String>,
    pub project: Option<String>,
    pub parent: Option<String>,
}

impl TaskEditPatchOwned {
    fn as_borrowed(&self) -> TaskEditPatch<'_> {
        TaskEditPatch {
            title: self.title.as_deref(),
            date: self.date.as_deref(),
            start: self.start.as_deref(),
            end: self.end.as_deref(),
            priority: self.priority.as_deref(),
            tags: self.tags.as_deref(),
            notes: self.notes.as_deref(),
            kind: self.kind.as_deref(),
            quadrant: self.quadrant.as_deref(),
            repeat: self.repeat.as_deref(),
            remind: self.remind.as_deref(),
            project: self.project.as_deref(),
            parent: self.parent.as_deref(),
        }
    }
}

impl Command {
    pub fn parse(args: &[String]) -> AppResult<Self> {
        let Some(group) = args.first().map(String::as_str) else {
            return Err(AppError::from("缺少参数: <command>"));
        };
        let command = match group {
            "task" => parse_task(args),
            "project" => parse_project(args),
            "note" => parse_note(args),
            "widget" => parse_widget(args),
            _ => None,
        };
        Ok(command.unwrap_or_else(|| Self::Legacy(args.to_vec())))
    }
}

pub fn execute(ctx: &Ctx, command: Command) -> AppResult<Value> {
    let result = match command {
        Command::TaskAdd(input) => ctx.task_add(input),
        Command::TaskEdit { id, patch } => ctx.task_edit(&id, patch.as_borrowed()),
        Command::TaskSetDone { id, done } => ctx.task_set_done(&id, done),
        Command::TaskToggle { id } => ctx.task_toggle(&id),
        Command::TaskDelete { id } => ctx.task_delete(&id),
        Command::TaskMove { id, date } => ctx.task_move(&id, &date),
        Command::TaskClearDone { date } => ctx.task_clear_done(&date),
        Command::ProjectAdd { name, description } => ctx.project_add(&name, &description),
        Command::ProjectEdit {
            id,
            name,
            description,
        } => ctx.project_edit(&id, name.as_deref(), description.as_deref()),
        Command::ProjectArchive { id, archived } => ctx.project_archive(&id, archived),
        Command::ProjectDelete { id } => ctx.project_delete(&id),
        Command::NoteAdd { body, title, color } => ctx.note_add(&body, &title, &color),
        Command::NoteEdit {
            id,
            title,
            body,
            color,
        } => ctx.note_edit(&id, title.as_deref(), body.as_deref(), color.as_deref()),
        Command::NoteDelete { id } => ctx.note_delete(&id),
        Command::NoteVisibility { id, visible } => ctx.note_show(&id, visible),
        Command::NotePin { id, pinned } => ctx.note_pin(&id, pinned),
        Command::WidgetVisibility { visible } => ctx.widget_show(visible),
        Command::WidgetPin { pinned } => ctx.widget_pin(pinned),
        Command::Legacy(args) => {
            return crate::cli::dispatch_legacy(ctx, &args).map_err(AppError::from)
        }
    }?;
    Ok(result)
}

fn parse_task(args: &[String]) -> Option<Command> {
    let sub = args.get(1)?.as_str();
    let positional_count = positionals(&args[2..]).len();
    let count_ok = match sub {
        "add" | "edit" | "done" | "undone" | "toggle" | "delete" | "del" | "rm" => {
            positional_count == 1
        }
        "move" => positional_count == 2,
        "clear-done" | "cleardone" => positional_count <= 1,
        _ => false,
    };
    if !count_ok {
        return None;
    }
    match sub {
        "add" => {
            if !flags_are_known(
                &args[2..],
                &[
                    "date", "start", "end", "priority", "tags", "notes", "kind", "quadrant",
                    "repeat", "remind", "project", "parent",
                ],
            ) {
                return None;
            }
            let title = first_positional(&args[2..])?;
            Some(Command::TaskAdd(TaskAddInput {
                title,
                date: flag(&args[2..], "date").unwrap_or_default(),
                start: flag(&args[2..], "start").unwrap_or_default(),
                end: flag(&args[2..], "end").unwrap_or_default(),
                priority: flag(&args[2..], "priority").unwrap_or_default(),
                tags: flag(&args[2..], "tags").unwrap_or_default(),
                notes: flag(&args[2..], "notes").unwrap_or_default(),
                kind: flag(&args[2..], "kind").unwrap_or_default(),
                quadrant: flag(&args[2..], "quadrant").unwrap_or_default(),
                repeat: flag(&args[2..], "repeat").unwrap_or_default(),
                remind: optional_flag(&args[2..], "remind"),
                project: flag(&args[2..], "project").unwrap_or_default(),
                parent: flag(&args[2..], "parent").unwrap_or_default(),
            }))
        }
        "edit" => {
            if !flags_are_known(
                &args[2..],
                &[
                    "title", "date", "start", "end", "priority", "tags", "notes", "kind",
                    "quadrant", "repeat", "remind", "project", "parent",
                ],
            ) {
                return None;
            }
            let id = first_positional(&args[2..])?;
            Some(Command::TaskEdit {
                id,
                patch: TaskEditPatchOwned {
                    title: flag(&args[2..], "title"),
                    date: flag(&args[2..], "date"),
                    start: flag(&args[2..], "start"),
                    end: flag(&args[2..], "end"),
                    priority: flag(&args[2..], "priority"),
                    tags: flag(&args[2..], "tags"),
                    notes: flag(&args[2..], "notes"),
                    kind: flag(&args[2..], "kind"),
                    quadrant: flag(&args[2..], "quadrant"),
                    repeat: flag(&args[2..], "repeat"),
                    remind: flag(&args[2..], "remind"),
                    project: flag(&args[2..], "project"),
                    parent: flag(&args[2..], "parent"),
                },
            })
        }
        "done" | "undone" => {
            if flags_are_known(&args[2..], &[]) {
                Some(Command::TaskSetDone {
                    id: first_positional(&args[2..])?,
                    done: sub == "done",
                })
            } else {
                None
            }
        }
        "toggle" => {
            if flags_are_known(&args[2..], &[]) {
                Some(Command::TaskToggle {
                    id: first_positional(&args[2..])?,
                })
            } else {
                None
            }
        }
        "delete" | "del" | "rm" => {
            if flags_are_known(&args[2..], &[]) {
                Some(Command::TaskDelete {
                    id: first_positional(&args[2..])?,
                })
            } else {
                None
            }
        }
        "move" => {
            if !flags_are_known(&args[2..], &[]) {
                return None;
            }
            let positionals = positionals(&args[2..]);
            Some(Command::TaskMove {
                id: positionals.first()?.clone(),
                date: positionals.get(1)?.clone(),
            })
        }
        "clear-done" | "cleardone" => {
            if flags_are_known(&args[2..], &[]) {
                Some(Command::TaskClearDone {
                    date: first_positional(&args[2..]).unwrap_or_default(),
                })
            } else {
                None
            }
        }
        _ => None,
    }
}

fn parse_project(args: &[String]) -> Option<Command> {
    let sub = args.get(1)?.as_str();
    let pos = positionals(&args[2..]);
    let expected = match sub {
        "add" | "edit" | "archive" | "unarchive" | "delete" | "del" | "rm" => 1,
        _ => 0,
    };
    if pos.len() != expected {
        return None;
    }
    let allowed = match sub {
        "add" => &["description"][..],
        "edit" => &["name", "description"][..],
        _ => &[][..],
    };
    if !flags_are_known(&args[2..], allowed) {
        return None;
    }
    match sub {
        "add" => Some(Command::ProjectAdd {
            name: pos.first()?.clone(),
            description: flag(&args[2..], "description").unwrap_or_default(),
        }),
        "edit" => Some(Command::ProjectEdit {
            id: pos.first()?.clone(),
            name: flag(&args[2..], "name"),
            description: flag(&args[2..], "description"),
        }),
        "archive" | "unarchive" => Some(Command::ProjectArchive {
            id: pos.first()?.clone(),
            archived: sub == "archive",
        }),
        "delete" | "del" | "rm" => Some(Command::ProjectDelete {
            id: pos.first()?.clone(),
        }),
        _ => None,
    }
}

fn parse_note(args: &[String]) -> Option<Command> {
    let sub = args.get(1)?.as_str();
    let pos = positionals(&args[2..]);
    let expected = match sub {
        "add" | "edit" | "delete" | "del" | "rm" | "show" | "hide" => 1,
        "pin" => 2,
        _ => 0,
    };
    if pos.len() != expected {
        return None;
    }
    let allowed = match sub {
        "add" => &["title", "color"][..],
        "edit" => &["title", "body", "color"][..],
        _ => &[][..],
    };
    if !flags_are_known(&args[2..], allowed) {
        return None;
    }
    match sub {
        "add" => Some(Command::NoteAdd {
            body: pos.first()?.clone(),
            title: flag(&args[2..], "title").unwrap_or_default(),
            color: flag(&args[2..], "color").unwrap_or_default(),
        }),
        "edit" => Some(Command::NoteEdit {
            id: pos.first()?.clone(),
            title: flag(&args[2..], "title"),
            body: flag(&args[2..], "body"),
            color: flag(&args[2..], "color"),
        }),
        "delete" | "del" | "rm" => Some(Command::NoteDelete {
            id: pos.first()?.clone(),
        }),
        "show" | "hide" => Some(Command::NoteVisibility {
            id: pos.first()?.clone(),
            visible: sub == "show",
        }),
        "pin" => {
            let state = pos.get(1)?.to_ascii_lowercase();
            let pinned = match state.as_str() {
                "on" | "1" | "true" | "yes" => true,
                "off" | "0" | "false" | "no" => false,
                _ => return None,
            };
            Some(Command::NotePin {
                id: pos.first()?.clone(),
                pinned,
            })
        }
        _ => None,
    }
}

fn parse_widget(args: &[String]) -> Option<Command> {
    let sub = args.get(1)?.as_str();
    let pos = positionals(&args[2..]);
    let expected = match sub {
        "show" | "hide" => 0,
        "pin" => 1,
        _ => 0,
    };
    if pos.len() != expected {
        return None;
    }
    if !flags_are_known(&args[2..], &[]) {
        return None;
    }
    match sub {
        "show" | "hide" => Some(Command::WidgetVisibility {
            visible: sub == "show",
        }),
        "pin" => {
            let state = args.get(2)?.to_ascii_lowercase();
            let pinned = match state.as_str() {
                "on" | "1" | "true" | "yes" => true,
                "off" | "0" | "false" | "no" => false,
                _ => return None,
            };
            Some(Command::WidgetPin { pinned })
        }
        _ => None,
    }
}

fn flags_are_known(args: &[String], allowed: &[&str]) -> bool {
    let mut index = 0;
    while index < args.len() {
        if let Some(raw) = args[index].strip_prefix("--") {
            let name = raw.replace('_', "-");
            if !allowed.contains(&name.as_str())
                || index + 1 >= args.len()
                || args[index + 1].starts_with("--")
            {
                return false;
            }
            index += 2;
        } else {
            index += 1;
        }
    }
    true
}

fn positionals(args: &[String]) -> Vec<String> {
    let mut result = Vec::new();
    let mut skip = false;
    for arg in args {
        if skip {
            skip = false;
            continue;
        }
        if arg.starts_with("--") {
            skip = true;
            continue;
        }
        result.push(arg.clone());
    }
    result
}

fn first_positional(args: &[String]) -> Option<String> {
    positionals(args).into_iter().next()
}

fn flag(args: &[String], name: &str) -> Option<String> {
    let key = format!("--{}", name);
    args.windows(2)
        .find(|pair| pair[0] == key)
        .map(|pair| pair[1].clone())
}

fn optional_flag(args: &[String], name: &str) -> Option<String> {
    flag(args, name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_string()).collect()
    }

    #[test]
    fn parses_typed_task_add_command() {
        let command = Command::parse(&args(&[
            "task",
            "add",
            "写周报",
            "--date",
            "tomorrow",
            "--priority",
            "high",
        ]))
        .unwrap();
        match command {
            Command::TaskAdd(input) => {
                assert_eq!(input.title, "写周报");
                assert_eq!(input.date, "tomorrow");
                assert_eq!(input.priority, "high");
            }
            other => panic!("expected typed task add, got {other:?}"),
        }
    }

    #[test]
    fn invalid_typed_flags_fall_back_to_legacy_validation() {
        let command = Command::parse(&args(&["task", "add", "任务", "--unknown", "x"])).unwrap();
        assert!(matches!(command, Command::Legacy(_)));
    }

    #[test]
    fn parses_project_and_widget_commands() {
        assert!(matches!(
            Command::parse(&args(&["project", "archive", "p_1"])).unwrap(),
            Command::ProjectArchive { archived: true, .. }
        ));
        assert!(matches!(
            Command::parse(&args(&["widget", "pin", "off"])).unwrap(),
            Command::WidgetPin { pinned: false }
        ));
    }

    #[test]
    fn classifies_domain_errors_with_stable_codes() {
        assert_eq!(AppError::from("任务不存在: t_1").code, ErrorCode::NotFound);
        assert_eq!(AppError::from("无效日期").code, ErrorCode::Validation);
        assert_eq!(
            AppError::from("缺少参数: <id>").code,
            ErrorCode::MissingArgument
        );
    }
}
