# DailyFlow CLI 参考（AI 必读）

> 本文档面向 **AI agent**。读完即可用 CLI 完成对 DailyFlow 的全部操作，无需任何 GUI。
> 每条命令输出**单行 JSON**：`{"ok":true,"data":...}` 或 `{"ok":false,"error":"..."}`；exit code 0=成功，1=失败。

## 0. 可执行文件位置

- 开发调试：`E:\dailytool\dailyflow\src-tauri\target\debug\dailyflow.exe`
- 发布版：安装后在 PATH 中，直接 `dailyflow <cmd>`
- 数据文件：`%APPDATA%\com.dailyflow.app\data.json`（可用环境变量 `DAILYFLOW_HOME` 重定向）

⚠️ 若 GUI 正在运行，CLI 修改会**实时同步**到界面与便签（约 1 秒内），无需任何额外操作。

## 1. 命令速查表

### 任务 / 日程（三种类型）

| kind | 含义 | date 语义 |
|---|---|---|
| `normal`（默认） | 短期待办 / 日程 | 归属日：当天做，做完结案 |
| `deadline` | 截止任务 | **截止日**：必须在这天前（含）完成，列表显示剩余天数 |
| `goal` | 长期任务 / 目标 | 可选目标日（`--date ""` 可无日期）：常驻「长期目标」区直到完成 |

```bash
dailyflow task add "<标题>" [--kind normal|deadline|goal] [--date D] [--start T] [--end T] [--priority low|normal|high] [--tags a,b] [--notes "备注"]
dailyflow task list [today|week|all|overdue|goal|deadline|open|YYYY-MM-DD|<关键词>] [--tag X]
dailyflow task goals              # = list goal
dailyflow task get <id>
dailyflow task edit <id> [--title S] [--kind K] [--date D] [--start T] [--end T] [--priority P] [--tags A] [--notes S]
dailyflow task done <id>          # 完成
dailyflow task undone <id>        # 取消完成
dailyflow task toggle <id>        # 切换
dailyflow task delete <id>
dailyflow task move <id> <date>   # 改期
dailyflow task clear-done [date]  # 清理已完成
```

- goal 类型 `--date` 可省略（无目标日）；`task edit <id> --date ""` 可清掉目标日。
- `task list today` 只显示 normal/deadline 中属于今天的任务（长期目标不掺进来，另有 `list goal`）。
- `day today` 的返回额外带 `goals_open`（进行中的长期目标数），并把这些目标附在 tasks 尾部，方便 AI 一并播报。

### 桌面便签

```bash
dailyflow note add "<内容>" [--title T] [--color yellow|green|blue|pink|purple|dark]
dailyflow note list
dailyflow note edit <id> [--title T] [--body S] [--color C]
dailyflow note delete <id>
dailyflow note show <id>          # 显示便签窗口（GUI 运行时）
dailyflow note hide <id>          # 隐藏
dailyflow note pin <id> on|off    # 置顶
```

### 查询 / 汇总

```bash
dailyflow day [date]    # 某天总览：任务列表 + 完成/待办数 + 星期
dailyflow stats [date]  # 全局统计：总数/完成/逾期/便签数
dailyflow dump          # 完整 data.json（适合 AI 快速了解全部状态）
dailyflow help          # 命令速查（JSON）
dailyflow version
```

### 今日悬浮窗

```bash
dailyflow widget show|hide   # 显示/隐藏桌面右上角的今日待办悬浮窗
dailyflow widget pin on|off  # 悬浮窗置顶开关（默认置顶，类似输入法悬浮窗）
```

### 主题与外观

```bash
dailyflow theme <preset>                                # 切换主题预设
dailyflow theme <preset> --light                        # 切换预设并启用浅色
dailyflow theme <preset> --overrides '{"--accent":"#ff5722"}'   # 切换 + 覆盖 CSS 变量
```

- 可选 preset：`classic-dark` / `classic-light` / `refined-minimal`（精致留白）/ `glassmorphism`（玻璃拟态）/ `warm-journal`（暖色手账）
- overrides 为 CSS 变量 → 值 的 JSON，如 `{"--accent":"#ff5722","--radius":"18px"}`；传空串 `{}` 清空自定义
- GUI 的 🎨 面板可实时预览逐变量取色，导出/导入主题 JSON 与此处的 overrides 格式一致

## 2. 参数格式

### 日期 `D`（宽松）

| 输入 | 含义 |
|---|---|
| `today` / `明天` | 今天 / 明天 |
| `tomorrow` / `昨天` | 明天 / 昨天 |
| `+3` / `-1` | 3 天后 / 1 天前 |
| `mon`…`sun` / `周一`…`周日` | 下一个周 X |
| `2026-09-04` | 指定日期 |

### 时间 `T`（宽松）

`9` → 09:00 · `930` → 09:30 · `9:30` → 09:30 · `下午3` → 15:00 · `18点` → 18:00

不传 `--start` 的任务 = 全天待办；传了 = 有具体时间的日程。

## 3. 典型 AI 工作流

### 场景 A：用户说「帮我安排明天上午开周会，下午 2 点提醒我交报表」

```bash
dailyflow task add "团队周会" --date tomorrow --start 10:00 --end 11:00 --tags work
dailyflow task add "提交周报表" --date tomorrow --start 14:00 --priority high
```

### 场景 A2：用户说「我下周五要交论文，还有个健身计划要坚持」

```bash
dailyflow task add "论文终稿" --kind deadline --date fri --priority high
dailyflow task add "每周健身 3 次" --kind goal --tags 健康
```

### 场景 B：用户说「看看我今天还剩什么」

```bash
dailyflow day today
# → 把 data.pending 与 tasks 中 done=false 的项总结给用户
```

### 场景 C：用户说「把体检改到周五，加个高优先级」

```bash
dailyflow task list 体检          # 关键词查找，拿到 id
dailyflow task edit t_xxx --date fri --priority high
```

### 场景 D：用户说「给我桌面加个便签：周三下午 3 点拿快递」

```bash
dailyflow note add "周三 15:00 拿快递" --color yellow
dailyflow task add "拿快递" --date wed --start 15:00   # 顺手建个任务提醒
```

### 场景 E：每日总结（AI 定时执行）

```bash
dailyflow stats today
dailyflow task list overdue
# → 汇总生成日报给用户
```

## 4. 行为约定（给 AI 的注意事项）

1. **幂等谨慎**：`task add` 会直接创建，建议先 `task list <关键词>` 查重。
2. **ID 是唯一句柄**：所有 edit/done/delete 都用 `t_xxxxxx` / `n_xxxxxx` 形式的 id。
3. **错误处理**：收到 `{"ok":false,"error":...}` 时把 error 转述给用户，不要重试同一条命令超过 1 次。
4. **便签显示**：`note add` 默认 visible=true；GUI 运行中会立即弹出到桌面。
5. **批量操作**：逐条执行即可，CLI 每次运行 <50ms。
6. **改期语义**：`task move <id> tomorrow` = 保留时间改日期。
7. **时间冲突**：CLI 目前不校验冲突；AI 添加日程前可先 `day <date>` 检查当天安排。
