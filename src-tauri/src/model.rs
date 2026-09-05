use serde::{Deserialize, Serialize};

pub const DATA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    Low,
    Normal,
    High,
}

impl Default for Priority {
    fn default() -> Self {
        Priority::Normal
    }
}

impl Priority {
    #[allow(dead_code)]
    pub fn as_str(&self) -> &'static str {
        match self {
            Priority::Low => "low",
            Priority::Normal => "normal",
            Priority::High => "high",
        }
    }
}

/// 任务类型：
/// - Normal   短期待办：归属于某一天，当天做完即消失
/// - Deadline 截止任务：在某天前必须完成（date = 截止日），显示剩余天数
/// - Goal     长期任务：无固定日期（可选 target_date 目标日），持续挂在列表上
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum TaskKind {
    #[default]
    Normal,
    Deadline,
    Goal,
}

impl TaskKind {
    pub fn parse(s: &str) -> Result<TaskKind, String> {
        match s.trim().to_lowercase().as_str() {
            "" | "normal" | "todo" | "短" | "短期" | "待办" => Ok(TaskKind::Normal),
            "deadline" | "due" | "截止" | "期限" => Ok(TaskKind::Deadline),
            "goal" | "long" | "longterm" | "长期" | "目标" => Ok(TaskKind::Goal),
            other => err(format!("无效任务类型: {} (可选 normal/deadline/goal)", other)),
        }
    }
}

fn err<T>(msg: String) -> Result<T, String> {
    Err(msg)
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Dark,
    Light,
    Auto,
}

impl Default for Theme {
    fn default() -> Self {
        Theme::Dark
    }
}

/// 内置主题 preset 名（frontend 把名字映射为 CSS 变量集合）
pub const THEME_PRESETS: [&str; 5] = [
    "classic-dark",   // 原版深色（main 分支默认）
    "classic-light",  // 原版浅色
    "refined-minimal", // 精致留白（theme/refined-minimal 分支设计）
    "glassmorphism",  // 玻璃拟态（theme/glassmorphism 分支设计）
    "warm-journal",   // 暖色手账（theme/warm-journal 分支设计）
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub theme: Theme,
    /// 主题 preset 名，见 THEME_PRESETS；空串 = classic-dark
    #[serde(default)]
    pub theme_preset: String,
    /// 用户对 preset 的覆盖：CSS 变量名 → 值（如 "--accent": "#ff9f43"）。
    /// 应用顺序：preset 变量 → 用户覆盖 → 组件级 inline style。
    #[serde(default)]
    pub theme_overrides: std::collections::BTreeMap<String, String>,
    #[serde(default = "default_sticky_opacity")]
    pub sticky_opacity: f64,
    #[serde(default)]
    pub autostart: bool,
    // 今日悬浮窗状态
    #[serde(default = "default_true")]
    pub widget_visible: bool,
    #[serde(default)]
    pub widget_pinned: bool,
    #[serde(default)]
    pub widget_x: i32,
    #[serde(default)]
    pub widget_y: i32,
}

fn default_sticky_opacity() -> f64 {
    0.92
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            theme: Theme::Dark,
            theme_preset: String::new(),
            theme_overrides: std::collections::BTreeMap::new(),
            sticky_opacity: default_sticky_opacity(),
            autostart: false,
            widget_visible: true,
            widget_pinned: true,
            widget_x: 0,
            widget_y: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    pub date: String, // YYYY-MM-DD（normal=归属日；deadline=截止日；goal=可选目标日，空串=无）
    #[serde(default)]
    pub start: Option<String>, // HH:MM
    #[serde(default)]
    pub end: Option<String>, // HH:MM
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub priority: Priority,
    #[serde(default)]
    pub kind: TaskKind, // 任务类型（新增字段，旧数据默认 normal）
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: String,
    #[serde(default)]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default = "default_note_color")]
    pub color: String,
    #[serde(default)]
    pub x: i32,
    #[serde(default)]
    pub y: i32,
    #[serde(default = "default_note_w")]
    pub w: f64,
    #[serde(default = "default_note_h")]
    pub h: f64,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default = "default_true")]
    pub visible: bool,
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

fn default_note_color() -> String {
    "yellow".into()
}
fn default_note_w() -> f64 {
    260.0
}
fn default_note_h() -> f64 {
    220.0
}

pub const NOTE_COLORS: [&str; 6] = ["yellow", "green", "blue", "pink", "purple", "dark"];

/// 撤销快照：记录最近一次改动前的任务/便签状态（单级撤销）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UndoEntry {
    pub ts: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub notes: Vec<Note>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Data {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub notes: Vec<Note>,
    #[serde(default)]
    pub settings: Settings,
    /// 最近一次可撤销操作的前置快照（None = 无可撤销）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo: Option<UndoEntry>,
}

fn default_version() -> u32 {
    DATA_VERSION
}

impl Default for Data {
    fn default() -> Self {
        Data {
            version: DATA_VERSION,
            tasks: Vec::new(),
            notes: Vec::new(),
            settings: Settings::default(),
            undo: None,
        }
    }
}

impl Data {
    pub fn task(&self, id: &str) -> Option<&Task> {
        self.tasks.iter().find(|t| t.id == id)
    }
    pub fn task_mut(&mut self, id: &str) -> Option<&mut Task> {
        self.tasks.iter_mut().find(|t| t.id == id)
    }
    pub fn note(&self, id: &str) -> Option<&Note> {
        self.notes.iter().find(|n| n.id == id)
    }
    pub fn note_mut(&mut self, id: &str) -> Option<&mut Note> {
        self.notes.iter_mut().find(|n| n.id == id)
    }

    pub fn gen_id(prefix: &str) -> String {
        // 6 位随机小写字母数字
        let mut buf = [0u8; 6];
        let alphabet: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
        // 使用系统时间 + 进程 ID 组合，足够 CLI 短生命周期场景
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos() as u64 ^ d.as_secs())
            .unwrap_or(0);
        let pid = std::process::id() as u64;
        let mut seed = nanos ^ (pid << 17) ^ 0x9e3779b97f4a7c15;
        for b in buf.iter_mut() {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            *b = alphabet[(seed % alphabet.len() as u64) as usize];
        }
        format!("{}_{}", prefix, String::from_utf8_lossy(&buf))
    }
}

/// 生成新的便签默认窗口坐标（主屏内轻微阶梯排布）
pub fn default_note_position(index: usize) -> (i32, i32) {
    let base_x = 1300 + ((index % 5) as i32) * 36;
    let base_y = 120 + ((index % 7) as i32) * 44;
    (base_x, base_y)
}

/// 今日悬浮窗默认位置：屏幕右上角（启动时会校正到可见区域）
pub fn default_widget_position() -> (i32, i32) {
    (1560, 80)
}
