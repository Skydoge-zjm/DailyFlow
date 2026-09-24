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
                let n: i64 = rest.parse().map_err(|_| format!("无效日期: {}", s))?;
                return relative_date(today, n, false);
            }
            if let Some(rest) = s.strip_prefix('-') {
                if let Ok(n) = rest.parse::<i64>() {
                    return relative_date(today, n, true);
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
            NaiveDate::parse_from_str(&s, "%Y-%m-%d").map_err(|_| {
                format!(
                    "无效日期: {} (支持 today/tomorrow/+N/周一..周日/YYYY-MM-DD)",
                    s
                )
            })
        }
    }
}

fn relative_date(today: NaiveDate, days: i64, subtract: bool) -> Result<NaiveDate, String> {
    let span = Duration::try_days(days).ok_or_else(|| "相对日期超出支持范围".to_string())?;
    let delta = if subtract { -span } else { span };
    today
        .checked_add_signed(delta)
        .ok_or_else(|| "相对日期超出支持范围".to_string())
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
    let s = s.trim().to_string();
    let parts: Vec<&str> = s.split(':').collect();
    if parts
        .iter()
        .any(|part| !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err(format!("无效时间: {}", s));
    }
    let (h, m) = match parts.len() {
        1 => {
            let digits = parts[0];
            match digits.len() {
                1 | 2 => (
                    digits
                        .parse::<i64>()
                        .map_err(|_| format!("无效时间: {}", s))?,
                    0,
                ),
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
            parts[0]
                .parse::<i64>()
                .map_err(|_| format!("无效时间: {}", s))?,
            if parts[1].is_empty() {
                0
            } else {
                parts[1]
                    .parse::<i64>()
                    .map_err(|_| format!("无效时间: {}", s))?
            },
        ),
        _ => return Err(format!("无效时间: {}", s)),
    };
    // 下午/晚上：12 点本身不加 12（中午 12 点），13-23 也不加（用户说"下午15点"较少见，尊原始值）
    let h = if pm_offset > 0 && h < 12 { h + 12 } else { h };
    if !(0..=23).contains(&h) || !(0..=59).contains(&m) {
        return Err(format!("无效时间: {} (小时 0-23, 分钟 0-59)", s));
    }
    let nt =
        NaiveTime::from_hms_opt(h as u32, m as u32, 0).ok_or_else(|| format!("无效时间: {}", s))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_date_relative() {
        let today = Local::now().date_naive();
        assert_eq!(parse_date("today").unwrap(), today);
        assert_eq!(parse_date("tomorrow").unwrap(), today + Duration::days(1));
        assert_eq!(parse_date("+3").unwrap(), today + Duration::days(3));
        assert_eq!(parse_date("-1").unwrap(), today - Duration::days(1));
    }

    #[test]
    fn test_parse_date_invalid() {
        assert!(parse_date("2027-02-29").is_err());
        assert!(parse_date("not-a-date").is_err());
        assert!(parse_date("+999999999999999999999").is_err());
        assert!(parse_date("+9223372036854775807").is_err());
        assert!(parse_date("-9223372036854775808").is_err());
    }

    #[test]
    fn test_parse_time_variants() {
        assert_eq!(parse_time("9").unwrap(), "09:00");
        assert_eq!(parse_time("930").unwrap(), "09:30");
        assert_eq!(parse_time("9:30").unwrap(), "09:30");
        assert_eq!(parse_time("下午3").unwrap(), "15:00");
        assert_eq!(parse_time("下午 3点30").unwrap(), "15:30");
        assert!(parse_time("一二三").is_err());
        assert!(parse_time("-1:30").is_err());
        assert!(parse_time("9:-1").is_err());
    }

    #[test]
    fn test_parse_time_noon_pm() {
        assert_eq!(parse_time("下午12点").unwrap(), "12:00");
        assert_eq!(parse_time("12点30").unwrap(), "12:30");
        assert!(parse_time("25点").is_err());
    }
}
