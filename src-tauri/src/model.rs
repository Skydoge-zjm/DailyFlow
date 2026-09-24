use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};

pub const DATA_VERSION: u32 = 2;
static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    Low,
    #[default]
    Normal,
    High,
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

/// Eisenhower matrix quadrant:
/// q1 = important and urgent, q2 = important and not urgent,
/// q3 = not important and urgent, q4 = not important and not urgent.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Quadrant {
    Q1,
    #[default]
    Q2,
    Q3,
    Q4,
}

impl Quadrant {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_lowercase().as_str() {
            "" | "q2" | "2" => Ok(Self::Q2),
            "q1" | "1" => Ok(Self::Q1),
            "q3" | "3" => Ok(Self::Q3),
            "q4" | "4" => Ok(Self::Q4),
            other => Err(format!("无效四象限: {} (可选 q1/q2/q3/q4)", other)),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Q1 => "q1",
            Self::Q2 => "q2",
            Self::Q3 => "q3",
            Self::Q4 => "q4",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum RepeatRule {
    #[default]
    None,
    Daily,
    Weekly,
    Monthly,
}

impl RepeatRule {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_lowercase().as_str() {
            "" | "none" | "off" => Ok(Self::None),
            "daily" => Ok(Self::Daily),
            "weekly" => Ok(Self::Weekly),
            "monthly" => Ok(Self::Monthly),
            other => Err(format!(
                "无效重复规则: {} (可选 none/daily/weekly/monthly)",
                other
            )),
        }
    }
}

impl TaskKind {
    pub fn parse(s: &str) -> Result<TaskKind, String> {
        match s.trim().to_lowercase().as_str() {
            "" | "normal" | "todo" | "短" | "短期" | "待办" => Ok(TaskKind::Normal),
            "deadline" | "due" | "截止" | "期限" => Ok(TaskKind::Deadline),
            "goal" | "long" | "longterm" | "长期" | "目标" => Ok(TaskKind::Goal),
            other => err(format!(
                "无效任务类型: {} (可选 normal/deadline/goal)",
                other
            )),
        }
    }
}

fn err<T>(msg: String) -> Result<T, String> {
    Err(msg)
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    Dark,
    Light,
    Auto,
}

/// 内置主题 preset 名（frontend 把名字映射为 CSS 变量集合）
pub const THEME_PRESETS: [&str; 5] = [
    "classic-dark",    // 原版深色（main 分支默认）
    "classic-light",   // 原版浅色
    "refined-minimal", // 精致留白（theme/refined-minimal 分支设计）
    "glassmorphism",   // 玻璃拟态（theme/glassmorphism 分支设计）
    "warm-journal",    // 暖色手账（theme/warm-journal 分支设计）
];

const THEME_COLOR_VARIABLES: &[&str] = &[
    "--bg",
    "--bg-soft",
    "--card",
    "--card-hover",
    "--border",
    "--border-soft",
    "--text",
    "--text-dim",
    "--text-faint",
    "--accent",
    "--accent-soft",
    "--teal",
    "--red",
    "--green",
    "--blue",
    "--pri-high",
    "--pri-normal",
    "--pri-low",
];

/// Validate imported/CLI CSS variable overrides before they reach the webview.
pub fn validate_theme_overrides(
    overrides: &std::collections::BTreeMap<String, String>,
) -> Result<(), String> {
    for (key, value) in overrides {
        if value.len() > 256 || value.chars().any(|c| matches!(c, ';' | '{' | '}' | '\\')) {
            return Err(format!("主题变量 {} 的值包含不支持的内容", key));
        }
        if THEME_COLOR_VARIABLES.contains(&key.as_str()) {
            if !valid_theme_color(value) {
                return Err(format!("主题变量 {} 需要有效的颜色值", key));
            }
        } else if key == "--radius" || key == "--radius-lg" {
            let numeric = value
                .strip_suffix("rem")
                .or_else(|| value.strip_suffix("px"))
                .or_else(|| value.strip_suffix("em"))
                .unwrap_or(value);
            let number = numeric
                .parse::<f64>()
                .map_err(|_| format!("主题变量 {} 需要 0 到 64 之间的数值", key))?;
            if !number.is_finite() || !(0.0..=64.0).contains(&number) {
                return Err(format!("主题变量 {} 需要 0 到 64 之间的数值", key));
            }
        } else if key == "--font" {
            if value.trim().is_empty()
                || !value.chars().all(|c| {
                    c.is_ascii_alphanumeric()
                        || c.is_ascii_whitespace()
                        || c == '\''
                        || c == '"'
                        || c == ','
                        || c == '-'
                        || c == '_'
                })
            {
                return Err("字体栈只支持字体名称、空格、引号、逗号和连字符".into());
            }
        } else {
            return Err(format!("不支持的主题变量: {}", key));
        }
    }
    Ok(())
}

const CSS_COLOR_NAMES: &str = "aliceblue antiquewhite aqua aquamarine azure beige bisque black \
blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral \
cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen \
darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon \
darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink \
deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro \
ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory \
khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan \
lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen \
lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen \
magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen \
mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream \
mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid \
palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum \
powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown \
seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen \
steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen";

fn valid_theme_color(value: &str) -> bool {
    let value = value.trim();
    let lower = value.to_ascii_lowercase();
    if lower == "transparent"
        || lower == "currentcolor"
        || CSS_COLOR_NAMES
            .split_ascii_whitespace()
            .any(|name| name == lower)
    {
        return true;
    }
    if let Some(hex) = value.strip_prefix('#') {
        return matches!(hex.len(), 3 | 4 | 6 | 8) && hex.bytes().all(|b| b.is_ascii_hexdigit());
    }
    let Some((name, body)) = lower.split_once('(') else {
        return false;
    };
    let Some(body) = body.strip_suffix(')') else {
        return false;
    };
    if !matches!(name, "rgb" | "rgba" | "hsl" | "hsla") {
        return false;
    }
    let parts: Vec<_> = body
        .split(|character: char| {
            character == ',' || character == '/' || character.is_ascii_whitespace()
        })
        .filter(|part| !part.is_empty())
        .collect();
    if !matches!(parts.len(), 3 | 4) || (matches!(name, "rgba" | "hsla") && parts.len() != 4) {
        return false;
    }
    if name == "rgb" || name == "rgba" {
        if !parts[..3]
            .iter()
            .all(|part| valid_color_component(part, 255.0, true))
        {
            return false;
        }
    } else {
        let hue = parts[0]
            .strip_suffix("deg")
            .or_else(|| parts[0].strip_suffix("rad"))
            .or_else(|| parts[0].strip_suffix("turn"))
            .or_else(|| parts[0].strip_suffix("grad"))
            .unwrap_or(parts[0]);
        if hue.parse::<f64>().map_or(true, |value| !value.is_finite())
            || !valid_percentage(parts[1])
            || !valid_percentage(parts[2])
        {
            return false;
        }
    }
    parts.len() == 3 || valid_color_component(parts[3], 1.0, true)
}

fn valid_color_component(value: &str, max: f64, allow_percentage: bool) -> bool {
    let (number, limit) = if let Some(percent) = value.strip_suffix('%') {
        if !allow_percentage {
            return false;
        }
        (percent, 100.0)
    } else {
        (value, max)
    };
    number
        .parse::<f64>()
        .is_ok_and(|number| number.is_finite() && (0.0..=limit).contains(&number))
}

fn valid_percentage(value: &str) -> bool {
    value
        .strip_suffix('%')
        .and_then(|number| number.parse::<f64>().ok())
        .is_some_and(|number| number.is_finite() && (0.0..=100.0).contains(&number))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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
    #[serde(default = "default_true")]
    pub widget_pinned: bool,
    #[serde(default)]
    pub widget_x: i32,
    #[serde(default)]
    pub widget_y: i32,
    #[serde(default = "default_widget_w")]
    pub widget_w: i32,
    #[serde(default = "default_widget_h")]
    pub widget_h: i32,
    #[serde(default)]
    pub widget_monitor: String,
}

fn default_sticky_opacity() -> f64 {
    0.92
}

fn default_widget_w() -> i32 {
    236
}

fn default_widget_h() -> i32 {
    300
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
            widget_w: default_widget_w(),
            widget_h: default_widget_h(),
            widget_monitor: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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
    pub quadrant: Quadrant,
    #[serde(default)]
    pub repeat: RepeatRule,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repeat_day: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repeat_parent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remind_at: Option<String>, // 当天本地时间 HH:MM；None = 不提醒
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reminded_at: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: String,
    #[serde(default)]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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
    #[serde(default)]
    pub monitor: String,
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
#[serde(deny_unknown_fields)]
pub struct UndoEntry {
    pub ts: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub notes: Vec<Note>,
    /// 新格式只保存本次删除的项目，避免 undo 抹掉删除后发生的其他编辑。
    #[serde(default)]
    pub deleted_tasks: Vec<Task>,
    #[serde(default)]
    pub deleted_notes: Vec<Note>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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
    1
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
        // 6 位短标识；单进程计数器避免相同时间片内重复使用同一随机序列。
        let mut buf = [0u8; 6];
        let alphabet: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
        let counter = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos() as u64 ^ d.as_secs())
            .unwrap_or(0);
        let pid = std::process::id() as u64;
        let mut seed = nanos ^ (pid << 17) ^ counter.rotate_left(23) ^ 0x9e3779b97f4a7c15;
        for b in buf.iter_mut() {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            *b = alphabet[(seed % alphabet.len() as u64) as usize];
        }
        format!("{}_{}", prefix, String::from_utf8_lossy(&buf))
    }

    pub fn gen_unique_id(&self, prefix: &str) -> String {
        loop {
            let candidate = Self::gen_id(prefix);
            if !self.tasks.iter().any(|task| task.id == candidate)
                && !self.notes.iter().any(|note| note.id == candidate)
            {
                return candidate;
            }
        }
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

#[cfg(test)]
mod theme_validation_tests {
    use super::validate_theme_overrides;
    use std::collections::BTreeMap;

    #[test]
    fn accepts_supported_theme_overrides() {
        let overrides = BTreeMap::from([
            ("--bg".to_string(), "#f3f5f2".to_string()),
            (
                "--accent-soft".to_string(),
                "rgba(189, 116, 51, 0.12)".to_string(),
            ),
            ("--radius".to_string(), "12px".to_string()),
            (
                "--font".to_string(),
                "Segoe UI, Microsoft YaHei, sans-serif".to_string(),
            ),
        ]);
        assert!(validate_theme_overrides(&overrides).is_ok());
    }

    #[test]
    fn rejects_unknown_variables_and_css_injection_values() {
        let injection = BTreeMap::from([(
            "--bg".to_string(),
            "red;background:url(//example.invalid)".to_string(),
        )]);
        assert!(validate_theme_overrides(&injection).is_err());
        let unknown = BTreeMap::from([("--background".to_string(), "#fff".to_string())]);
        assert!(validate_theme_overrides(&unknown).is_err());
    }
}
