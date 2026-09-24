use serde_json::{json, Value};
use std::io::Write;

use crate::domain::{Ctx, TaskAddInput, TaskEditPatch};
use crate::store::Store;

/// CLI 入口：args 为去掉 argv[0] 后的参数。
/// 返回 (exit_code, stdout)
pub fn run_cli(args: Vec<String>) -> i32 {
    if is_text_help_request(&args) {
        print_help_text();
        return 0;
    }

    let ctx = Ctx {
        store: Store::new(crate::app_paths()),
    };
    match dispatch(&ctx, &args) {
        Ok(v) => {
            print_json(&v);
            0
        }
        Err(e) => {
            print_json(&json!({ "ok": false, "error": e }));
            1
        }
    }
}

fn is_text_help_request(args: &[String]) -> bool {
    args.len() == 1 && matches!(args[0].as_str(), "help" | "--help" | "-h")
}

fn print_json(value: &Value) {
    let output = serde_json::to_string(value).unwrap_or_else(|_| "{\"ok\":false}".into());
    let _ = writeln!(std::io::stdout().lock(), "{}", output);
}

fn print_help_text() {
    let help = help_json_value();
    let commands = help["commands"].as_object().expect("help commands object");
    let sections = [
        ("任务与日程", "task "),
        ("便签", "note "),
        ("悬浮窗", "widget "),
        ("主题", "theme "),
    ];
    let name = help["name"].as_str().unwrap_or("DailyFlow CLI");
    let version = help["version"].as_str().unwrap_or("");
    let mut output = format!("{name} v{version}\n\n");
    output
        .push_str("用法\n  dailyflow <命令> [参数]\n  dailyflow help --json  输出机器可读帮助\n\n");

    for (title, prefix) in sections {
        append_help_section(&mut output, title, commands, |command| {
            command.starts_with(prefix)
        });
    }
    append_help_section(&mut output, "查询与其他", commands, |command| {
        !sections
            .iter()
            .any(|(_, prefix)| command.starts_with(prefix))
    });

    output.push_str("日期格式\n  ");
    output.push_str(&format_value_list(&help["date_formats"]));
    output.push_str("\n时间格式\n  ");
    output.push_str(&format_value_list(&help["time_formats"]));
    output.push_str("\n\n示例\n");
    if let Some(examples) = help["examples"].as_array() {
        for example in examples.iter().filter_map(Value::as_str) {
            output.push_str("  ");
            output.push_str(example);
            output.push('\n');
        }
    }
    output.push_str(
        "\n输出格式\n  help 默认输出文本；help --json 输出 JSON。其他命令输出单行 JSON，exit code 0 表示成功，1 表示失败。\n",
    );
    let _ = std::io::stdout().lock().write_all(output.as_bytes());
}

fn append_help_section<F>(
    output: &mut String,
    title: &str,
    commands: &serde_json::Map<String, Value>,
    belongs_to: F,
) where
    F: Fn(&str) -> bool,
{
    let entries: Vec<_> = commands
        .iter()
        .filter(|(command, _)| belongs_to(command.as_str()))
        .collect();
    if entries.is_empty() {
        return;
    }

    output.push_str(title);
    output.push('\n');
    for (command, description) in entries {
        output.push_str("  dailyflow ");
        output.push_str(command);
        output.push('\n');
        if let Some(description) = description.as_str() {
            output.push_str("    ");
            output.push_str(description);
            output.push('\n');
        }
    }
    output.push('\n');
}

fn format_value_list(value: &Value) -> String {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>()
        .join("、")
}

fn need(args: &[String], i: usize, what: &str) -> Result<String, String> {
    args.get(i)
        .cloned()
        .ok_or_else(|| format!("缺少参数: <{}>", what))
}

fn flag(args: &[String], name: &str) -> Option<String> {
    let with_dashes = format!("--{}", name);
    let with_under = format!("--{}", name.replace('-', "_"));
    args.iter()
        .position(|a| a.as_str() == with_dashes || a.as_str() == with_under)
        .and_then(|i| args.get(i + 1).cloned())
}

fn validate_flags(
    args: &[String],
    value_flags: &[&str],
    boolean_flags: &[&str],
) -> Result<(), String> {
    let mut index = 0;
    while index < args.len() {
        let Some(raw_name) = args[index].strip_prefix("--") else {
            index += 1;
            continue;
        };
        let name = raw_name.replace('_', "-");
        if boolean_flags.contains(&name.as_str()) {
            index += 1;
            continue;
        }
        if value_flags.contains(&name.as_str()) {
            if index + 1 >= args.len() || args[index + 1].starts_with("--") {
                return Err(format!("选项 --{} 缺少值", name));
            }
            index += 2;
            continue;
        }
        return Err(format!("未知选项: {}", args[index]));
    }
    Ok(())
}

fn validate_positional_count(
    args: &[String],
    value_flags: &[&str],
    boolean_flags: &[&str],
    min: usize,
    max: usize,
) -> Result<(), String> {
    let mut index = 0;
    let mut count = 0;
    while index < args.len() {
        if let Some(raw_name) = args[index].strip_prefix("--") {
            let name = raw_name.replace('_', "-");
            if value_flags.contains(&name.as_str()) {
                index += 2;
            } else if boolean_flags.contains(&name.as_str()) {
                index += 1;
            } else {
                return Err(format!("未知选项: {}", args[index]));
            }
        } else {
            count += 1;
            index += 1;
        }
    }
    if count < min {
        return Err("缺少位置参数".into());
    }
    if count > max {
        return Err("多余的位置参数".into());
    }
    Ok(())
}

fn has_flag(args: &[String], name: &str) -> bool {
    let with_dashes = format!("--{}", name);
    args.iter().any(|a| a.as_str() == with_dashes)
}

fn opt_positional(args: &[String], i: usize) -> Option<String> {
    args.get(i).cloned()
}

fn first_positional(
    args: &[String],
    value_flags: &[&str],
    boolean_flags: &[&str],
) -> Option<String> {
    let mut index = 0;
    while index < args.len() {
        if let Some(raw_name) = args[index].strip_prefix("--") {
            let name = raw_name.replace('_', "-");
            if value_flags.contains(&name.as_str()) {
                index += 2;
            } else if boolean_flags.contains(&name.as_str()) {
                index += 1;
            } else {
                return None;
            }
        } else {
            return Some(args[index].clone());
        }
    }
    None
}

fn dispatch(ctx: &Ctx, args: &[String]) -> Result<Value, String> {
    let cmd = need(args, 0, "command")?.to_lowercase();
    let rest = &args[1..];
    if matches!(cmd.as_str(), "help" | "--help" | "-h") {
        validate_flags(rest, &[], &["json"])?;
        validate_positional_count(rest, &[], &["json"], 0, 0)?;
    } else if matches!(cmd.as_str(), "version" | "--version" | "-v") {
        validate_flags(rest, &[], &[])?;
        validate_positional_count(rest, &[], &[], 0, 0)?;
    }

    match cmd.as_str() {
        "help" | "--help" | "-h" => Ok(help_json_value()),

        "version" | "--version" | "-v" => Ok(json!({
            "ok": true,
            "name": "DailyFlow",
            "version": env!("CARGO_PKG_VERSION"),
        })),

        // ---------------- tasks ----------------
        "task" => {
            let sub = need(rest, 0, "task 子命令")?.to_lowercase();
            let r = &rest[1..];
            let value_flags = match sub.as_str() {
                "add" => &[
                    "date", "start", "end", "priority", "tags", "notes", "kind", "quadrant",
                    "repeat", "remind",
                ][..],
                "edit" => &[
                    "title", "date", "start", "end", "priority", "tags", "notes", "kind",
                    "quadrant", "repeat", "remind",
                ][..],
                "list" | "ls" | "today" | "goals" => &["tag"][..],
                _ => &[],
            };
            validate_flags(r, value_flags, &[])?;
            let (min_positionals, max_positionals) = match sub.as_str() {
                "add" | "get" | "edit" | "done" | "undone" | "undo" | "toggle" | "delete"
                | "del" | "rm" => (1, 1),
                "move" => (2, 2),
                "clear-done" | "cleardone" | "list" | "ls" => (0, 1),
                "today" | "goals" => (0, 0),
                _ => (0, 0),
            };
            validate_positional_count(r, value_flags, &[], min_positionals, max_positionals)?;
            match sub.as_str() {
                "add" => {
                    let title = first_positional(r, value_flags, &[])
                        .ok_or_else(|| "缺少参数: <标题>".to_string())?;
                    ctx.task_add(TaskAddInput {
                        title,
                        date: flag(r, "date").unwrap_or_default(),
                        start: flag(r, "start").unwrap_or_default(),
                        end: flag(r, "end").unwrap_or_default(),
                        priority: flag(r, "priority").unwrap_or_default(),
                        tags: flag(r, "tags").unwrap_or_default(),
                        notes: flag(r, "notes").unwrap_or_default(),
                        kind: flag(r, "kind").unwrap_or_default(),
                        quadrant: flag(r, "quadrant").unwrap_or_default(),
                        repeat: flag(r, "repeat").unwrap_or_default(),
                        remind: flag(r, "remind"),
                    })
                }
                "list" | "ls" => {
                    let scope =
                        first_positional(r, value_flags, &[]).unwrap_or_else(|| "today".into());
                    ctx.task_list(&scope, &flag(r, "tag").unwrap_or_default())
                }
                "today" => ctx.task_list("today", &flag(r, "tag").unwrap_or_default()),
                "goals" => ctx.task_list("goal", &flag(r, "tag").unwrap_or_default()),
                "get" => ctx.task_get(&need(r, 0, "id")?),
                "edit" => {
                    let id = first_positional(r, value_flags, &[])
                        .ok_or_else(|| "缺少参数: <id>".to_string())?;
                    let title = flag(r, "title");
                    let date = flag(r, "date");
                    let start = flag(r, "start");
                    let end = flag(r, "end");
                    let priority = flag(r, "priority");
                    let tags = flag(r, "tags");
                    let notes = flag(r, "notes");
                    let kind = flag(r, "kind");
                    let quadrant = flag(r, "quadrant");
                    let repeat = flag(r, "repeat");
                    let remind = flag(r, "remind");
                    ctx.task_edit(
                        &id,
                        TaskEditPatch {
                            title: title.as_deref(),
                            date: date.as_deref(),
                            start: start.as_deref(),
                            end: end.as_deref(),
                            priority: priority.as_deref(),
                            tags: tags.as_deref(),
                            notes: notes.as_deref(),
                            kind: kind.as_deref(),
                            quadrant: quadrant.as_deref(),
                            repeat: repeat.as_deref(),
                            remind: remind.as_deref(),
                        },
                    )
                }
                "done" => ctx.task_set_done(&need(r, 0, "id")?, true),
                "undone" | "undo" => ctx.task_set_done(&need(r, 0, "id")?, false),
                "toggle" => ctx.task_toggle(&need(r, 0, "id")?),
                "delete" | "del" | "rm" => ctx.task_delete(&need(r, 0, "id")?),
                "move" => ctx.task_move(&need(r, 0, "id")?, &need(r, 1, "日期")?),
                "clear-done" | "cleardone" => {
                    ctx.task_clear_done(&opt_positional(r, 0).unwrap_or_default())
                }
                other => Err(format!("未知 task 子命令: {} (见 help)", other)),
            }
        }

        // ---------------- notes ----------------
        "note" | "sticky" => {
            let sub = need(rest, 0, "note 子命令")?.to_lowercase();
            let r = &rest[1..];
            let value_flags = match sub.as_str() {
                "add" => &["title", "color"][..],
                "edit" => &["title", "body", "color"][..],
                _ => &[],
            };
            validate_flags(r, value_flags, &[])?;
            let (min_positionals, max_positionals) = match sub.as_str() {
                "add" => (1, 1),
                "edit" | "delete" | "del" | "rm" | "show" | "hide" => (1, 1),
                "pin" => (1, 2),
                "list" | "ls" => (0, 0),
                _ => (0, 0),
            };
            validate_positional_count(r, value_flags, &[], min_positionals, max_positionals)?;
            match sub.as_str() {
                "add" => {
                    let body = first_positional(r, value_flags, &[])
                        .ok_or_else(|| "缺少参数: <内容>".to_string())?;
                    ctx.note_add(
                        &body,
                        &flag(r, "title").unwrap_or_default(),
                        &flag(r, "color").unwrap_or_default(),
                    )
                }
                "list" | "ls" => ctx.note_list(),
                "edit" => {
                    let id = first_positional(r, value_flags, &[])
                        .ok_or_else(|| "缺少参数: <id>".to_string())?;
                    ctx.note_edit(
                        &id,
                        flag(r, "title").as_deref(),
                        flag(r, "body").as_deref(),
                        flag(r, "color").as_deref(),
                    )
                }
                "delete" | "del" | "rm" => ctx.note_delete(&need(r, 0, "id")?),
                "show" => ctx.note_show(&need(r, 0, "id")?, true),
                "hide" => ctx.note_show(&need(r, 0, "id")?, false),
                "pin" => {
                    let id = need(r, 0, "id")?;
                    let onoff = opt_positional(r, 1)
                        .unwrap_or_else(|| "on".into())
                        .to_lowercase();
                    let pin = match onoff.as_str() {
                        "on" | "1" | "true" | "yes" => true,
                        "off" | "0" | "false" | "no" => false,
                        other => return Err(format!("无效参数: {} (可选 on/off)", other)),
                    };
                    ctx.note_pin(&id, pin)
                }
                other => Err(format!("未知 note 子命令: {} (见 help)", other)),
            }
        }

        // ---------------- widget ----------------
        "widget" => {
            let sub = need(rest, 0, "widget 子命令")?.to_lowercase();
            let r = &rest[1..];
            validate_flags(r, &[], &[])?;
            let (min_positionals, max_positionals) = match sub.as_str() {
                "show" | "hide" => (0, 0),
                "pin" => (0, 1),
                _ => (0, 0),
            };
            validate_positional_count(r, &[], &[], min_positionals, max_positionals)?;
            match sub.as_str() {
                "show" | "hide" => ctx.widget_show(sub == "show"),
                "pin" => {
                    let onoff = opt_positional(r, 0)
                        .unwrap_or_else(|| "on".into())
                        .to_lowercase();
                    match onoff.as_str() {
                        "on" | "1" | "true" | "yes" => ctx.widget_pin(true),
                        "off" | "0" | "false" | "no" => ctx.widget_pin(false),
                        other => Err(format!("无效参数: {} (可选 on/off)", other)),
                    }
                }
                other => Err(format!(
                    "未知 widget 子命令: {} (可选 show/hide/pin on|off)",
                    other
                )),
            }
        }

        // ---------------- theme ----------------
        "theme" => {
            validate_flags(rest, &["overrides"], &["light"])?;
            validate_positional_count(rest, &["overrides"], &["light"], 0, 1)?;
            let preset = first_positional(rest, &["overrides"], &["light"]).unwrap_or_default();
            let light = has_flag(rest, "light");
            let overrides = flag(rest, "overrides").unwrap_or_default();
            ctx.theme_set(&preset, light, &overrides)
        }

        // ---------------- aggregates ----------------
        "day" => {
            validate_flags(rest, &[], &[])?;
            validate_positional_count(rest, &[], &[], 0, 1)?;
            ctx.day(&opt_positional(rest, 0).unwrap_or_default())
        }
        "matrix" | "quadrants" => {
            validate_flags(rest, &[], &[])?;
            validate_positional_count(rest, &[], &[], 0, 1)?;
            ctx.matrix(&opt_positional(rest, 0).unwrap_or_default())
        }
        "stats" => {
            validate_flags(rest, &[], &[])?;
            validate_positional_count(rest, &[], &[], 0, 1)?;
            ctx.stats(&opt_positional(rest, 0).unwrap_or_default())
        }
        "dump" => {
            validate_flags(rest, &[], &[])?;
            validate_positional_count(rest, &[], &[], 0, 0)?;
            ctx.dump()
        }
        "undo" => {
            validate_flags(rest, &[], &[])?;
            validate_positional_count(rest, &[], &[], 0, usize::MAX)?;
            ctx.undo(rest)
        }

        other => Err(format!(
            "未知命令: {}。运行 dailyflow help 查看全部命令。",
            other
        )),
    }
}

/// 结构化 CLI 帮助数据，供文本和 JSON 输出共用。
fn help_json_value() -> Value {
    json!({
        "ok": true,
        "name": "DailyFlow CLI",
        "version": env!("CARGO_PKG_VERSION"),
        "output_format": "help 默认输出可读文本；help --json 输出此结构化 JSON。其他命令输出单行 JSON：{\"ok\":true,\"data\":...} 或 {\"ok\":false,\"error\":\"...\"}。exit 0=成功 1=失败。",
        "date_formats": ["today", "tomorrow", "yesterday", "+N", "-N", "mon/tue/wed/thu/fri/sat/sun", "周一..周日", "YYYY-MM-DD"],
        "time_formats": ["9", "930", "9:30", "09:30", "下午3", "18点"],
        "commands": {
            "task add <title> [--kind normal|deadline|goal] [--date D] [--start T] [--end T] [--quadrant q1|q2|q3|q4] [--repeat none|daily|weekly|monthly] [--remind T|off] [--priority low|normal|high] [--tags a,b] [--notes S]": "添加任务。四象限：q1 重要且紧急，q2 重要不紧急（默认），q3 不重要但紧急，q4 不重要不紧急。",
            "task list [today|week|all|overdue|goal|deadline|q1|q2|q3|q4|open|YYYY-MM-DD|关键词] [--tag X]": "列出任务，默认 today；q1-q4 按四象限筛选",
            "task get <id>": "查看单个任务",
            "task edit <id> [--title|--date|--start|--end|--kind|--quadrant|--priority|--tags|--notes|--repeat|--remind S]": "编辑任务；--quadrant 设置四象限；--remind off 关闭提醒；--repeat none 关闭重复",
            "task done|undone|toggle <id>": "完成/取消完成/切换",
            "task delete <id>": "删除任务",
            "task move <id> <date>": "改期",
            "task goals": "列出所有长期任务",
            "task clear-done [date]": "清理已完成任务",
            "note add <body> [--title T] [--color yellow|green|blue|pink|purple|dark]": "新建桌面便签",
            "note list": "列出便签",
            "note edit <id> [--title T] [--body S] [--color C]": "编辑便签",
            "note delete <id>": "删除便签",
            "note show|hide <id>": "显示/隐藏便签窗口",
            "note pin <id> on|off": "置顶便签",
            "widget show|hide": "显示/隐藏今日待办悬浮窗",
            "widget pin on|off": "悬浮窗置顶开关",
            "theme [preset] [--light] [--overrides JSON]": "设置主题。preset: classic-dark/classic-light/refined-minimal/glassmorphism/warm-journal；--overrides '{\"--accent\":\"#ff9f43\"}' 自定义 CSS 变量",
            "day [date]": "某天总览（任务+完成统计）",
            "matrix [date|all]": "输出未完成任务的四象限矩阵；默认今天，all 表示全部日期",
            "stats [date]": "统计",
            "dump": "输出完整数据 (data.json)",
            "undo [id ...]": "撤销最近一次删除；可传被删除项目 ID，避免撤销到另一笔并发删除",
            "help": "本帮助",
            "version": "版本"
        },
        "examples": [
            "dailyflow task add \"团队周会\" --start 10:00 --end 11:00 --tags work",
            "dailyflow task add \"review PR\" --priority high --date tomorrow",
            "dailyflow task add \"论文终稿\" --kind deadline --date +7 --priority high",
            "dailyflow task add \"每天读 30 分钟书\" --kind goal --tags 自我提升",
            "dailyflow task done t_a1b2c3",
            "dailyflow note add \"明天带伞\" --color blue",
            "dailyflow day today",
            "dailyflow stats"
        ]
    })
}

// 供 Tauri commands（fe_call）复用命令分发
pub fn dispatch_pub(ctx: &Ctx, args: &[String]) -> Result<Value, String> {
    dispatch(ctx, args)
}

// 保留 flag 函数的 has_flag 供未来布尔开关使用
