# DailyFlow

> AI 驱动的每日日程管理工具 —— Windows 桌面应用 · 常驻桌面便签 · 供 AI 调用的完整 CLI

**核心理念**：人能做的每个操作都有对应的 CLI 命令，AI（如 Claude）读完 [`docs/CLI.md`](docs/CLI.md) 后即可通过命令行完成一切 —— 增删任务、安排日程、写便签、查统计；GUI 实时同步显示。

```
AI Agent ──▶ dailyflow.exe task add "周会" --start 10:00
                    │
                    ▼
              data.json（唯一数据源）
                    │ 文件监听（~1s）
                    ▼
        主窗口 · 桌面便签 实时刷新
```

## 功能

- ✅ **两个图形界面**：主窗口（计划管理）+ 常驻桌面悬浮窗（今日待办，输入法风格、可置顶、可拖拽）
- ✅ **任务/日程统一管理**：有时间为日程，无时间为待办；优先级、标签、备注、改期
- ✅ **桌面便签**：无边框半透明彩色便签窗口，可拖拽/缩放/置顶，位置自动记忆
- ✅ **系统托盘**：常驻后台，快速新建便签、切换悬浮窗、唤起主窗口
- ✅ **多主题 + 自定义外观**：5 个内置主题（经典深浅/精致留白/玻璃拟态/暖色手账），🎨 面板可逐变量调色实时预览，主题可导出/导入 JSON
- ✅ **完整 CLI**：`dailyflow task/note/widget/day/stats/...` 全部操作可脚本化，宽松的中英文日期/时间解析
- ✅ **实时同步**：CLI 与 GUI 双向实时同步（文件监听）
- ✅ **数据安全**：原子写入 + 自动滚动备份（`backups/` 保留 10 份）

### 界面一览

1. **主窗口** —— 今日日程时间线、周历切换日期、快速添加、完成率进度环、便签管理
2. **今日悬浮窗** —— 右上角常驻小窗，紧凑列出今日待办/日程，可勾选完成、`9:30 开会` 回车快速添加；📌 置顶开关（默认开，像输入法悬浮窗一样压在所有窗口上）、⤢ 唤起主窗口、✕ 隐藏（托盘可找回）
3. **桌面便签** —— 多张彩色便签自由摆放

## 技术栈

Tauri 2（Rust）+ 原生 TypeScript + Vite，无前端框架，安装包约 3-5MB。

## 开发

```bash
npm install
npm run tauri dev     # 开发模式（带热重载）

cargo build --manifest-path src-tauri/Cargo.toml   # 仅构建（可先测 CLI）
```

构建 CLI 可独立验证（无需 GUI）：

```bash
export DAILYFLOW_HOME=/tmp/df-test   # 可选：重定向数据目录
./src-tauri/target/debug/dailyflow.exe task add "测试任务"
./src-tauri/target/debug/dailyflow.exe day today
```

打包：`npm run tauri build`

## 文档

- [设计文档](docs/DESIGN.md) —— 架构、数据模型、GUI 设计
- [CLI 参考（AI 必读）](docs/CLI.md) —— 全部命令与 AI 工作流示例

## 数据

所有数据存于 `%APPDATA%\com.dailyflow.app\data.json`，纯 JSON、无锁库，AI 可直接 `dump` 读取全量状态。
