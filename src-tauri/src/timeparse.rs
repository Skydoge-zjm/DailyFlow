use chrono::{Datelike, Duration, Local, NaiveDate, NaiveTime};

/// 宽松解析日期：today/today|tomorrow|tmr|yesterday|+N|-N|mon..sun|YYYY-MM-DD
pub fn parse_date(s: &str) -> Result<NaiveDate, String> {
    let s = s.trim().to_lowercase();
    let today = Local::now().date_naive();
    match s.as_str() {
        "" | "today" | "今" | "今天" => Ok(today),
        "tomorrow" | "tmr" | "明天" | "明日" => Ok(today + Duration::days(1)),
        "yesterday" | "昨天" => Ok(today - Duration::days(1)),
        _ => {
            if let Some(rest) = s.strip_prefix('+') {
                let n: i64 = rest
                    .parse()
                    .map_err(|_| format!("无效日期: {}", s))?;
                return Ok(today + Duration::days(n));
            }
            if let Some(rest) = s.strip_prefix('-') {
                if let Ok(n) = rest.parse::<i64>() {
                    return Ok(today - Duration::days(n));
                }
            }
            // 中文星期 / 英文星期
            let weekday = match s.as_str() {
                "mon" | "monday" | "周一" | "星期一" => Some(1),
                "tue" | "tuesday" | "周二" | "星期二" => Some(2),
                "wed" | "wednesday" | "周三" | "星期三" => Some(3),
                "thu" | "thursday" | "周四" | "星期四" => Some(4),
                "fri" | "friday" | "周五" | "星期五" => Some(5),
                "sat" | "saturday" | "周六" | "星期六" => Some(6),
                "sun" | "sunday" | "周日" | "星期日" | "星期天" => Some(7),
                _ => None,
            };
            if let Some(target) = weekday {
                let cur = today.weekday().num_days_from_monday() as i64;
                let delta = (target as i64 - cur).rem_euclid(7);
                let delta = if delta == 0 { 7 } else { delta }; // 本周已过的周X → 下周
                return Ok(today + Duration::days(delta));
            }
            NaiveDate::parse_from_str(&s, "%Y-%m-%d")
                .map_err(|_| format!("无效日期: {} (支持 today/tomorrow/+N/周一..周日/YYYY-MM-DD)", s))
        }
    }
}

/// 宽松解析时间：9 / 930 / 9:30 / 09:30 / 9点30 / 下午3点 → HH:MM
pub fn parse_time(s: &str) -> Result<String, String> {
    let s = s.trim().replace("：", ":").replace("点", ":");
    let s = s.trim_end_matches(':').trim().to_string();
    if s.is_empty() {
        return Ok(String::new());
    }
    // 处理 下午/晚上 前缀
    let (s, pm_offset) = if let Some(rest) = s.strip_prefix("下午") {
        (rest.to_string(), 12i64)
    } else if let Some(rest) = s.strip_prefix("晚上") {
        (rest.to_string(), 12i64)
    } else if let Some(rest) = s.strip_prefix("上午") {
        (rest.to_string(), 0)
    } else {
        (s.clone(), 0)
    };
    let parts: Vec<&str> = s.split(':').collect();
    let (h, m) = match parts.len() {
        1 => {
            let digits = parts[0];
            match digits.len() {
                1 | 2 => (digits.parse::<i64>().map_err(|_| format!("无效时间: {}", s))?, 0),
                3 | 4 => {
                    let hh = digits[..digits.len() - 2]
                        .parse::<i64>()
                        .map_err(|_| format!("无效时间: {}", s))?;
                    let mm = digits[digits.len() - 2..]
                        .parse::<i64>()
                        .map_err(|_| format!("无效时间: {}", s))?;
                    (hh, mm)
                }
                _ => return Err(format!("无效时间: {}", s)),
            }
        }
        2 => (
            parts[0].parse::<i64>().map_err(|_| format!("无效时间: {}", s))?,
            if parts[1].is_empty() {
                0
            } else {
                parts[1].parse::<i64>().map_err(|_| format!("无效时间: {}", s))?
            },
        ),
        _ => return Err(format!("无效时间: {}", s)),
    };
    let mut h = h + pm_offset;
    // 930 → 9:30 已在上面拆分；下午3 → 15
    if pm_offset > 0 && h < 12 {
        h += 0; // 已加过
    }
    if h > 23 || m > 59 {
        return Err(format!("无效时间: {} (小时 0-23, 分钟 0-59)", s));
    }
    let nt = NaiveTime::from_hms_opt(h as u32, m as u32, 0).ok_or_else(|| format!("无效时间: {}", s))?;
    Ok(nt.format("%H:%M").to_string())
}

pub fn today_str() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

pub fn now_iso() -> String {
    Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

pub fn weekday_cn(d: NaiveDate) -> &'static str {
    match d.weekday() {
        chrono::Weekday::Mon => "周一",
        chrono::Weekday::Tue => "周二",
        chrono::Weekday::Wed => "周三",
        chrono::Weekday::Thu => "周四",
        chrono::Weekday::Fri => "周五",
        chrono::Weekday::Sat => "周六",
        chrono::Weekday::Sun => "周日",
    }
}
