---
name: dailyflow-cli
description: 当 DailyFlow 已安装，且用户要求查询或修改任务、日程、目标、桌面便签、提醒、悬浮窗或主题设置时，使用 DailyFlow CLI 完成操作。
---

# 使用 DailyFlow CLI

用户要求操作 DailyFlow 数据时使用本技能。CLI 与桌面应用共用本地数据。普通数据操作无需启动图形界面。

## 直接执行

- 用户的请求、常用命令格式和已知参数足以构造命令时，直接执行；不要为了例行确认而先运行 `help`、重复查询数据或询问用户。
- 只有在命令语法未知、CLI 不可用或命令失败时，才查看 `dailyflow help`；若能访问项目仓库，也可查阅 `docs/CLI.md`。不同版本说明不一致时，以已安装 CLI 的帮助输出为准。
- 始终传入命令或子命令。直接运行 `dailyflow` 可能会打开图形界面；查询帮助请使用 `dailyflow help`。
- `dailyflow help` 默认输出可读文本；需要机器可读帮助时用 `dailyflow help --json`。其他命令输出 JSON，检查进程退出码和 `ok` 字段（0 表示成功，1 表示失败）。若 `ok: false`，根据错误检查语法或参数，修正后最多重试一次；不要原样重复失败命令。
- 如果找不到 `dailyflow`，先确认用户是否正在 DailyFlow 仓库中，并能否使用仓库内已构建的可执行文件。否则说明需要安装 CLI 或将其加入 `PATH`；用户未要求时，不要自行安装软件或改用图形界面操作。

## 用户需求到命令

先将用户的自然语言请求归入下表，再直接运行对应命令。只有命令需要 ID 而上下文没有可用 ID 时，才先查找目标。

| 用户需求 | 命令 |
| --- | --- |
| 看今天或某天的完整安排 | `dailyflow day today` 或 `dailyflow day <日期>` |
| 查看未完成、未来一周或逾期任务 | `dailyflow task list open`、`dailyflow task list week`、`dailyflow task list overdue` |
| 查看截止事项、长期目标或指定日期任务 | `dailyflow task list deadline`、`dailyflow task list goal`、`dailyflow task list <日期>` |
| 按关键词查找任务，或查看某任务详情 | `dailyflow task list "<关键词>"`；`dailyflow task get <任务ID>` |
| 查看统计或四象限矩阵 | `dailyflow stats [<日期>]`；`dailyflow matrix [<日期或 all>]` |
| 新增待办或日程 | `dailyflow task add "<标题>" [--date <日期>] [--start <时间>] [--end <时间>] [--priority <优先级>] [--tags <标签列表>] [--notes "<备注>"]` |
| 新增截止事项 | `dailyflow task add "<标题>" --kind deadline --date <日期>` |
| 新增长期目标 | `dailyflow task add "<标题>" --kind goal [--date <日期>]` |
| 设置提醒或重复规则 | 新增时用 `dailyflow task add "<标题>" [--remind <时间或 off>] [--repeat <规则>]`；编辑时用 `dailyflow task edit <任务ID> [--remind <时间或 off>] [--repeat <规则>]` |
| 完成、恢复或切换任务状态 | `dailyflow task done <任务ID>`、`dailyflow task undone <任务ID>`、`dailyflow task toggle <任务ID>` |
| 改期或修改任务内容 | `dailyflow task move <任务ID> <日期>`；编辑用 `dailyflow task edit <任务ID> [--title "<标题>"] [--date <日期>] [--start <时间>] [--end <时间>] [--kind <类型>] [--quadrant <象限>] [--priority <优先级>] [--tags <标签列表>] [--notes "<备注>"] [--repeat <规则>] [--remind <时间或 off>]` |
| 删除任务、清理已完成任务或撤销删除 | `dailyflow task delete <任务ID>`、`dailyflow task clear-done [<日期>]`、`dailyflow undo [<被删项目ID>]` |
| 查看或新建便签 | `dailyflow note list`；`dailyflow note add "<内容>" [--title "<标题>"] [--color <颜色>]` |
| 修改或删除便签 | `dailyflow note edit <便签ID> [--title "<标题>"] [--body "<内容>"] [--color <颜色>]`；`dailyflow note delete <便签ID>` |
| 显示、隐藏或置顶某张便签 | `dailyflow note show <便签ID>`、`dailyflow note hide <便签ID>`、`dailyflow note pin <便签ID> on` 或 `dailyflow note pin <便签ID> off` |
| 显示、隐藏或置顶今日悬浮窗 | `dailyflow widget show`、`dailyflow widget hide`、`dailyflow widget pin on`、`dailyflow widget pin off` |
| 切换主题或自定义主题变量 | `dailyflow theme <预设> [--light] [--overrides '<JSON>']` |
| 导出完整数据或查询版本 | 用户明确需要完整数据时运行 `dailyflow dump`；查询版本用 `dailyflow version` |

用户给出名称而命令需要 ID 时，先查询以取得 ID；只有多个匹配项且上下文无法判断时才询问用户。若上下文已有准确 ID，直接执行。新增请求直接创建，不默认查重。

## 参数说明

- `<任务ID>` 和 `<便签ID>` 必须使用 CLI 返回的 ID，例如 `t_a1b2c3`；不要用标题代替 ID 执行修改或删除。
- `normal` 表示普通任务或日程，`deadline` 表示有截止日期的事项，`goal` 表示长期目标；目标日期可选。`--kind` 可用 `normal`、`deadline`、`goal`；`--quadrant` 可用 `q1` 到 `q4`；`--repeat` 可用 `none`、`daily`、`weekly`、`monthly`；`--priority` 可用 `low`、`normal`、`high`。便签颜色可用 `yellow`、`green`、`blue`、`pink`、`purple`、`dark`。
- `task list` 的常用范围有 `today`、`week`、`all`、`overdue`、`goal`、`deadline`、`open`、`q1` 至 `q4`，也可以传日期或关键词。
- 日期常用格式包括 `today`、`tomorrow`、`+3`、星期名称和 `YYYY-MM-DD`；时间常用格式包括 `9`、`930`、`9:30` 和 `09:30`。完整格式及本地化写法以 `dailyflow help` 和 `docs/CLI.md` 为准。
- `--tags` 接收逗号分隔的标签；`--tag` 是查询过滤条件。`task add` 的标题是位置参数，其余设置通过选项传入。
- 相对日期按用户所在地的当前日期和通常语义解析；CLI 支持该表达时直接传入。只有日期含义无法合理判断且会导致不同结果时才追问。

## 谨慎修改数据

- 对明确指定且目标清楚的删除请求，直接执行 `task delete`、`note delete` 或 `task clear-done`，无需再次向用户确认。只有目标或清理范围不明确时才追问；不要把未请求的清理当作附带操作。
- 按当前 shell 的引用规则，将标题、备注等用户文本作为带引号的参数传入。不要把未经信任的文本拼接进可执行命令。
- 任务设置 `--start` 后，默认会在该时间提醒。用户不需要提醒时，使用 `--remind off`。只有桌面应用运行时才会发送提醒。
- 完成重复任务后，CLI 会创建下一次任务。除非用户另有要求，不要再手动创建重复项。
- `note add` 默认会显示便签；若图形界面正在运行，便签可能会立即出现在桌面上。只有用户要求调整窗口状态时，才使用悬浮窗或便签的 show、hide、pin 命令。
- CLI 不支持拖动或缩放等桌面交互。遇到这类要求时，应说明需要在图形界面中操作，不要声称已通过 CLI 完成。

## 汇报结果

每次修改后都要检查 JSON 返回结果。根据返回的事项、日期或 ID 告知用户具体改动。如果结果缺失或含义不明确，应说明不确定性，不要声称操作成功。回答时避免复述与请求无关的私人任务或便签内容。
