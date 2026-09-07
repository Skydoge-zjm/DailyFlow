# DailyFlow 设计文档

> AI 驱动的每日日程管理工具 —— Windows 桌面应用 + 常驻桌面便签 + 供 AI 调用的 CLI。

## 1. 核心理念

**AI 通过 CLI 驱动一切。** 应用把「任意人类操作」都暴露为 CLI 命令：

- 人在界面上能做的事（增删改任务、拖动便签、打标签、查看统计），CLI 都有对应命令。
- AI（如 Claude / ChatGPT 的 agent）拿到 `CLI.md` 后，不依赖任何私有 API，直接用 `dailyflow.exe <cmd>` 完成所有操作。
- CLI 与 GUI 共享同一份数据文件，GUI 实时刷新展示 CLI 造成的变更（通过文件监听）。

```
┌──────────────┐   CLI 调用    ┌────────────────┐   文件监听    ┌──────────────┐
│   AI Agent   │ ───────────▶ │  dailyflow.exe │             │              │
│ (Claude 等)  │              │  (CLI / headless)            │   GUI 窗口   │
└──────────────┘              └───────┬────────┘             │  (主窗口 +   │
                                      │ 读写                  │   桌面便签)  │
                                      ▼                      └──────▲───────┘
                              ┌────────────────┐   事件通知     │
                              │   data.json    │ ──────────────┘
                              │  (唯一数据源)   │  (tauri 文件监听)
                              └────────────────┘
```

## 2. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 外壳 | **Tauri 2**（Rust） | 体积小、内存低、原生窗口控制（无边框/置顶/透明）成熟，适合便签 |
| 前端 | **原生 TS + Vite**（无框架） | 界面不复杂，避免框架开销；CSS 手写设计系统 |
| 存储 | **单个 JSON 文件** `data.json` | 对 AI 最友好——CLI 可直接 `cat` 检查；带原子写+滚动备份 |
| CLI | **同一 exe 的子命令** `dailyflow.exe <cmd>` | 零分发成本，AI 用绝对路径即可调用 |
| 托盘 | tauri tray feature | 常驻 + 显示/隐藏主窗口/便签 |

## 3. 数据模型（`data.json`）

存放位置：`%APPDATA%/com.dailyflow.app/data.json`（Tauri app_data_dir）。

```jsonc
{
  "version": 1,
  "tasks": [
    {
      "id": "t_a1b2c3",              // 唯一 ID（t_ 前缀 + 6 位随机）
      "title": "写周报",
      "notes": "",                    // 补充说明
      "kind": "normal",               // 任务类型：normal 短期待办 | deadline 截止任务 | goal 长期目标
      "date": "2026-09-04",          // normal=归属日；deadline=截止日；goal=可选目标日（""=无）
      "start": "09:30",              // 可选，HH:MM
      "end": "10:00",                // 可选
      "done": false,
      "priority": "normal",          // low | normal | high
      "tags": ["work"],
      "created_at": "2026-09-04T08:00:00Z",
      "completed_at": null
    }
  ],
  "notes": [                         // 桌面便签（sticky note）
    {
      "id": "n_a1b2c3",
      "title": "备忘",
      "body": "多喝水\n下午 3 点开会",
      "color": "yellow",             // yellow | green | blue | pink | purple | dark
      "x": 1600, "y": 120,          // 屏幕坐标（记忆位置）
      "w": 260, "h": 220,
      "pinned": false,               // 是否置顶
      "visible": true,
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "settings": {
    "theme": "dark",                 // dark | light | auto
    "sticky_opacity": 0.92,
    "autostart": false
  }
}
```

设计要点：

- **三种任务类型**（`kind` 字段）：
  - `normal` 短期待办：归属于某天，当天做完即结案；
  - `deadline` 截止任务：date 是截止日，列表显示「剩 N 天」，逾期红色告警；
  - `goal` 长期目标：常驻「长期目标」区（绿色条），date 可空，不参与逾期统计、不混入今日列表。
- **一切皆任务**：日程 = 有 `start/end` 的任务；待办 = 无时间的任务。模型统一，CLI 简单。
- **时间用纯字符串**（`YYYY-MM-DD` / `HH:MM`），避免时区序列化坑，AI 也最容易生成。
- **便签位置持久化**，重启后回到原位。
- 写入策略：原子写（临时文件 + rename），写入前把旧文件滚动备份到 `backups/`（保留最近 10 份）。CLI 与 GUI 同时写也不会丢数据（短临界区，写频率低）。

## 4. CLI 协议（AI 的操作面）

统一形式：`dailyflow.exe <command> [args] [--flags]`

- 所有命令输出 **JSON 一行**（`{"ok":true,...}` / `{"ok":false,"error":"..."}`），AI 解析稳定。
- exit code：成功 0，失败 1。
- 时间参数宽松：`today` / `tomorrow` / `+1` / `mon` / `2026-09-04` 均可，由 Rust 解析。
- 启动分流：带参数 → CLI 模式；无参数（双击/开始菜单）→ 启动 GUI；显式 `dailyflow gui` 从任意上下文启动图形界面。

### 命令清单（覆盖全部人类操作）

```
# 任务/日程
task add <title> [--date today|YYYY-MM-DD] [--start HH:MM] [--end HH:MM]
          [--priority low|normal|high] [--tags a,b] [--notes "..."]
task list [date|today|week|all] [--tag x] [--json]
task get <id>
task edit <id> [--title s] [--date d] [--start t] [--end t] [--notes s]
          [--priority p] [--tags a,b]         # tags 传空串清空
task done <id> | task undone <id> | task toggle <id>
task delete <id>
task move <id> <date>                     # 改期
task today                                # = list today
task clear-done [date]                    # 清理已完成

# 便签
note add <body> [--title t] [--color c]
note list [--json]
note edit <id> [--title t] [--body s] [--color c]
note delete <id>
note show <id> | note hide <id>           # 显示/隐藏便签窗口
note pin <id> on|off                      # 置顶

# 通用
day [date]                                # 某天总览（任务+统计）
stats [date]                              # 统计：完成率等
undo                                      # 撤销最近一次删除（单级）
widget show|hide | widget pin on|off      # 今日悬浮窗控制
theme <preset> [--light] [--overrides JSON]
help                                      # 命令速查（AI 入口）
version
```

### AI 工作流示例

```
dailyflow.exe task add "团队周会" --start 10:00 --end 11:00 --tags work
dailyflow.exe task add "review PR #42" --priority high
dailyflow.exe task done t_a1b2c3
dailyflow.exe note add "明天带伞" --color blue
dailyflow.exe day today
```

## 5. GUI 设计

### 5.1 主窗口（920×640，可缩放）

- 顶栏：日期大字 + 农历式点缀（周几）、今日进度环、主题切换。
- 左侧：**今日任务列表**（时间线分组：早上/下午/晚上/无时间；完成划线动画；优先级色条）。
- 右侧：**周视图迷你日历**（7 列，任务点密度着色）+ 快速添加框（自然语言提示，如「明天 9 点 开会」——解析交给 AI，GUI 只做简单拆分）。
- 底部状态栏：数据文件路径、上次同步时间、CLI 提示。
- 无传统菜单栏；左下角小按钮弹出便签管理。

### 5.2 桌面便签（sticky note 窗口）

- 每条便签 = 一个独立 Tauri 窗口：**无边框、半透明（透明度 0.92）、置顶可切换、可拖拽、可缩放**。
- 彩色纸质质感（6 色），圆角 + 细腻阴影，顶部窄工具条（图钉/变色/关闭），正文区直接编辑。
- 内容变更即写回 data.json；CLI 修改时实时刷新。
- 托盘菜单可「新建便签」「显示全部/隐藏全部」。

### 5.3 视觉系统

- 字体：`Segoe UI Variable` / 系统栈；中文回退微软雅黑。
- 深色主题默认：底色 `#14161a`，卡片 `#1d2026`，主色 **暖橙 `#ff9f43`**（日程感、有活力），辅色青 `#4ecdc4`。
- 优先级色：high `#ff6b6b` / normal `#ff9f43` / low `#7f8fa6`。
- 动画克制：完成划线 0.3s、列表项进出 0.2s、便签弹出 0.15s scale。
- 圆角统一 10px，卡片阴影 `0 2px 12px rgba(0,0,0,.25)`。

## 6. Rust 模块划分

```
src-tauri/src/
├── main.rs            # 入口（dev 下区分 CLI 模式）
├── lib.rs             # run()：CLI 分流 or Tauri 启动
├── cli.rs             # 参数解析 + 命令分发 + JSON 输出
├── store.rs           # data.json 加载/原子保存/备份/文件监听句柄
├── model.rs           # Task / Note / Settings / Data + serde
├── timeparse.rs       # 宽松时间解析（today/tomorrow/+1/mon/YYYY-MM-DD）
├── commands.rs        # Tauri commands（前端 ↔ 后端）
└── tray.rs            # 托盘菜单与事件
```

**CLI 模式判定**：程序带参数启动 → 走 CLI（不创建任何窗口，秒进秒出）；无参数 → 启动 GUI；`gui` 子命令显式启动 GUI。注意：Tauri 打包的 exe 直接跑子命令即可，无需额外二进制。

**GUI 实时性**：GUI 启动时记录 data.json 的 mtime，`tokio` 间隔 800ms 轮询 mtime（比文件监听 API 简单可靠，Windows 上 crossbeam/notify 均有坑），变化则重载并经 `emit` 推给所有窗口。

## 7. 里程碑

1. **M1** 数据层 + CLI 全命令（headless 可独立验收）✅ 本仓库首要交付
2. **M2** 主窗口 UI（今日视图 + 周历 + 快速添加）
3. **M3** 便签窗口 + 托盘
4. **M4** 打磨：主题切换、动画、开机自启
