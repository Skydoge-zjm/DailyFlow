use serde_json::{json, Value};

use crate::domain::Ctx;
use crate::store::Store;

/// CLI 入口：args 为去掉 argv[0] 后的参数。
/// 返回 (exit_code, stdout_json)
pub fn run_cli(args: Vec<String>) -> i32 {
    let ctx = Ctx {
        store: Store::new(crate::app_paths()),
    };
    match dispatch(&ctx, &args) {
        Ok(v) => {
            println!("{}", serde_json::to_string(&v).unwrap_or_else(|_| "{\"ok\":true}".into()));
            0
        }
        Err(e) => {
            println!(
                "{}",
                serde_json::to_string(&json!({ "ok": false, "error": e }))
                    .unwrap_or_else(|_| "{\"ok\":false}".into())
            );
            1
        }
    }
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
        .position(|a| a.as_str() == name || a.as_str() == with_dashes || a.as_str() == with_under)
        .and_then(|i| args.get(i + 1).cloned())
}

fn has_flag(args: &[String], name: &str) -> bool {
    let with_dashes = format!("--{}", name);
    args.iter().any(|a| a.as_str() == with_dashes)
}

fn opt_positional(args: &[String], i: usize) -> Option<String> {
    args.get(i).cloned()
}

fn dispatch(ctx: &Ctx, args: &[String]) -> Result<Value, String> {
    let cmd = need(args, 0, "command")?.to_lowercase();
    let rest = &args[1..];

    match cmd.as_str() {
        "help" | "--help" | "-h" => Ok(help_markdown_value()),

        "version" | "--version" | "-v" => Ok(json!({
            "ok": true,
            "name": "DailyFlow",
            "version": env!("CARGO_PKG_VERSION"),
        })),

        // ---------------- tasks ----------------
        "task" => {
            let sub = need(rest, 0, "task 子命令")?.to_lowercase();
            let r = &rest[1..];
            match sub.as_str() {
                "add" => {
                    let title = need(r, 0, "标题")?;
                    ctx.task_add(
                        &title,
                        &flag(r, "date").unwrap_or_default(),
                        &flag(r, "start").unwrap_or_default(),
                        &flag(r, "end").unwrap_or_default(),
                        &flag(r, "priority").unwrap_or_default(),
                        &flag(r, "tags").unwrap_or_default(),
                        &flag(r, "notes").unwrap_or_default(),
                    )
                }
                "list" | "ls" => {
                    let scope = opt_positional(r, 0).unwrap_or_else(|| "today".into());
                    ctx.task_list(&scope, &flag(r, "tag").unwrap_or_default())
                }
                "today" => ctx.task_list("today", &flag(r, "tag").unwrap_or_default()),
                "get" => ctx.task_get(&need(r, 0, "id")?),
                "edit" => {
                    let id = need(r, 0, "id")?;
                    ctx.task_edit(
                        &id,
                        flag(r, "title").as_deref(),
                        flag(r, "date").as_deref(),
                        flag(r, "start").as_deref(),
                        flag(r, "end").as_deref(),
                        flag(r, "priority").as_deref(),
                        flag(r, "tags").as_deref(),
                        flag(r, "notes").as_deref(),
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
            match sub.as_str() {
                "add" => {
                    let body = need(r, 0, "内容")?;
                    ctx.note_add(
                        &body,
                        &flag(r, "title").unwrap_or_default(),
                        &flag(r, "color").unwrap_or_default(),
                    )
                }
                "list" | "ls" => ctx.note_list(),
                "edit" => {
                    let id = need(r, 0, "id")?;
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
                    let onoff = opt_positional(r, 1).unwrap_or_else(|| "on".into());
                    let pin = !matches!(onoff.as_str(), "off" | "0" | "false" | "no");
                    ctx.note_pin(&id, pin)
                }
                other => Err(format!("未知 note 子命令: {} (见 help)", other)),
            }
        }

        // ---------------- aggregates ----------------
        "day" => ctx.day(&opt_positional(rest, 0).unwrap_or_default()),
        "stats" => ctx.stats(&opt_positional(rest, 0).unwrap_or_default()),
        "dump" => ctx.dump(),

        other => Err(format!(
            "未知命令: {}。运行 dailyflow help 查看全部命令。",
            other
        )),
    }
}

/// help 输出：结构化命令表，AI 可直接消费
fn help_markdown_value() -> Value {
    json!({
        "ok": true,
        "name": "DailyFlow CLI",
        "version": env!("CARGO_PKG_VERSION"),
        "output_format": "所有命令输出单行 JSON：{\"ok\":true,\"data\":...} 或 {\"ok\":false,\"error\":\"...\"}。exit 0=成功 1=失败。",
        "date_formats": ["today", "tomorrow", "yesterday", "+N", "-N", "mon/tue/wed/thu/fri/sat/sun", "周一..周日", "YYYY-MM-DD"],
        "time_formats": ["9", "930", "9:30", "09:30", "下午3", "18点"],
        "commands": {
            "task add <title> [--date D] [--start T] [--end T] [--priority low|normal|high] [--tags a,b] [--notes S]": "添加任务/日程（不传 --start 则是普通待办）",
            "task list [today|tomorrow|week|all|overdue|YYYY-MM-DD|关键词] [--tag X]": "列出任务，默认 today",
            "task get <id>": "查看单个任务",
            "task edit <id> [--title|--date|--start|--end|--priority|--tags|--notes S]": "编辑任务；--tags \"\" 清空标签",
            "task done|undone|toggle <id>": "完成/取消完成/切换",
            "task delete <id>": "删除任务",
            "task move <id> <date>": "改期",
            "task clear-done [date]": "清理已完成任务",
            "note add <body> [--title T] [--color yellow|green|blue|pink|purple|dark]": "新建桌面便签",
            "note list": "列出便签",
            "note edit <id> [--title T] [--body S] [--color C]": "编辑便签",
            "note delete <id>": "删除便签",
            "note show|hide <id>": "显示/隐藏便签窗口",
            "note pin <id> on|off": "置顶便签",
            "day [date]": "某天总览（任务+完成统计）",
            "stats [date]": "统计",
            "dump": "输出完整数据 (data.json)",
            "help": "本帮助",
            "version": "版本"
        },
        "examples": [
            "dailyflow task add \"团队周会\" --start 10:00 --end 11:00 --tags work",
            "dailyflow task add \"review PR\" --priority high --date tomorrow",
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
#[allow(dead_code)]
fn _unused() {
    let _ = has_flag(&[], "x");
}
