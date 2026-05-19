use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranscriptRecord {
    pub id: String,
    pub created_at: String,
    pub text: String,
    pub raw_text: String,
    pub duration_seconds: f64,
    pub word_count: u32,
    pub wpm: f64,
    pub ai_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProductivitySettings {
    pub typing_baseline_wpm: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DashboardStats {
    pub avg_wpm: f64,
    pub total_words: u32,
    pub total_speaking_seconds: f64,
    pub minutes_saved: f64,
    pub weekly_words: u32,
    pub weekly_goal_words: u32,
    pub weekly_progress: f64,
    // Extended fields
    pub today_words: u32,
    pub yesterday_words: u32,
    pub current_streak_days: u32,
    pub typing_baseline_wpm: u32,
    /// Last 7 days word counts, index 0 = 6 days ago, index 6 = today.
    pub last_7_day_words: Vec<u32>,
    /// 28-day activity grid, index 0 = 27 days ago, index 27 = today.
    pub heatmap_28: Vec<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyWordCount {
    pub label: String,
    pub words: u32,
    pub goal: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsightsStats {
    pub week_label: String,
    pub weekly_words: u32,
    pub weekly_speaking_seconds: f64,
    pub weekly_days_active: u32,
    pub weekly_goal_words: u32,
    pub weekly_goal_speaking_seconds: f64,
    pub words_pct: u32,
    pub speaking_pct: u32,
    pub milestones_pct: u32,
    pub overall_pct: u32,
    pub daily_words: Vec<DailyWordCount>,
    pub daily_avg_words: u32,
    pub pb_longest_session_seconds: f64,
    pub pb_longest_session_label: String,
    pub pb_fastest_wpm: f64,
    pub pb_fastest_wpm_label: String,
    pub pb_best_streak_days: u32,
    pub pb_streak_label: String,
    pub pb_most_words_day: u32,
    pub pb_most_words_day_label: String,
}

pub const DEFAULT_TYPING_BASELINE_WPM: u32 = 40;
pub const WEEKLY_GOAL_WORDS: u32 = 5_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatestTranscriptInfo {
    pub id: String,
    pub title: String,
    pub time_ago: String,
    pub duration_label: String,
    pub word_count: u32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentSession {
    pub id: String,
    pub title: String,
    pub time_ago: String,
    pub word_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardLatestData {
    pub latest: Option<LatestTranscriptInfo>,
    pub recent_sessions: Vec<RecentSession>,
}

pub fn count_words(text: &str) -> u32 {
    text.split_whitespace()
        .filter(|part| !part.trim().is_empty())
        .count() as u32
}

pub fn calculate_wpm(word_count: u32, duration_seconds: f64) -> f64 {
    if duration_seconds <= 0.0 {
        return 0.0;
    }
    word_count as f64 / (duration_seconds / 60.0)
}

fn parse_iso_timestamp(value: &str) -> Option<(u64, u32)> {
    let date_time = value.strip_suffix('Z')?;
    let (date, time) = date_time.split_once('T')?;
    let mut date_parts = date.split('-');
    let year: i32 = date_parts.next()?.parse().ok()?;
    let month: u32 = date_parts.next()?.parse().ok()?;
    let day: u32 = date_parts.next()?.parse().ok()?;
    if date_parts.next().is_some() || !valid_date(year, month, day) {
        return None;
    }
    let mut time_parts = time.split(':');
    let hour: u32 = time_parts.next()?.parse().ok()?;
    let minute: u32 = time_parts.next()?.parse().ok()?;
    let second_part = time_parts.next()?;
    if time_parts.next().is_some() {
        return None;
    }
    let (second_text, nanos) = if let Some((whole, fraction)) = second_part.split_once('.') {
        if fraction.is_empty() || !fraction.chars().all(|ch| ch.is_ascii_digit()) {
            return None;
        }
        let mut nanos_text = fraction.chars().take(9).collect::<String>();
        while nanos_text.len() < 9 {
            nanos_text.push('0');
        }
        (whole, nanos_text.parse().ok()?)
    } else {
        (second_part, 0)
    };
    let second: u32 = second_text.parse().ok()?;
    if hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    Some((
        days_from_civil(year, month, day) * 86_400
            + hour as u64 * 3_600
            + minute as u64 * 60
            + second as u64,
        nanos,
    ))
}

fn unix_seconds_from_iso(value: &str) -> Option<u64> {
    parse_iso_timestamp(value).map(|(seconds, _)| seconds)
}

fn valid_date(year: i32, month: u32, day: u32) -> bool {
    if !(1..=12).contains(&month) {
        return false;
    }
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => return false,
    };
    (1..=max_day).contains(&day)
}

fn is_leap_year(year: i32) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fn days_from_civil(year: i32, month: u32, day: u32) -> u64 {
    let year = year - (month <= 2) as i32;
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = (year - era * 400) as u32;
    let month_index = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * month_index + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era as i64 * 146_097 + doe as i64 - 719_468).max(0) as u64
}

fn start_of_week_unix(now_unix_seconds: u64) -> u64 {
    let days_since_epoch = now_unix_seconds / 86_400;
    let day_of_week_monday_zero = (days_since_epoch + 3) % 7;
    days_since_epoch.saturating_sub(day_of_week_monday_zero) * 86_400
}

pub fn calculate_dashboard_stats(
    records: &[TranscriptRecord],
    settings: &ProductivitySettings,
    now_unix_seconds: u64,
) -> DashboardStats {
    let total_words: u32 = records.iter().map(|r| r.word_count).sum();
    let total_speaking_seconds: f64 = records.iter().map(|r| r.duration_seconds.max(0.0)).sum();
    let avg_wpm = calculate_wpm(total_words, total_speaking_seconds);
    let baseline = settings.typing_baseline_wpm.max(1) as f64;
    let typing_minutes = total_words as f64 / baseline;
    let speaking_minutes = total_speaking_seconds / 60.0;
    let minutes_saved = (typing_minutes - speaking_minutes).max(0.0);
    let week_start = start_of_week_unix(now_unix_seconds);
    let weekly_words: u32 = records
        .iter()
        .filter(|r| {
            unix_seconds_from_iso(&r.created_at)
                .map(|ts| ts >= week_start && ts <= now_unix_seconds)
                .unwrap_or(false)
        })
        .map(|r| r.word_count)
        .sum();
    let weekly_progress = (weekly_words as f64 / WEEKLY_GOAL_WORDS as f64).clamp(0.0, 1.0);

    // Per-day totals (reused for today, yesterday, heatmap, mini-bars, streak)
    let mut day_totals: HashMap<u64, u32> = HashMap::new();
    for r in records {
        if let Some(ts) = unix_seconds_from_iso(&r.created_at) {
            *day_totals.entry(ts / 86_400).or_insert(0) += r.word_count;
        }
    }

    let today_day = now_unix_seconds / 86_400;
    let today_words = day_totals.get(&today_day).copied().unwrap_or(0);
    let yesterday_words = day_totals
        .get(&today_day.saturating_sub(1))
        .copied()
        .unwrap_or(0);

    let last_7_day_words: Vec<u32> = (0..7u64)
        .map(|i| {
            let day = today_day.saturating_sub(6 - i);
            day_totals.get(&day).copied().unwrap_or(0)
        })
        .collect();

    let heatmap_28: Vec<bool> = (0..28u64)
        .map(|i| {
            let day = today_day.saturating_sub(27 - i);
            day_totals.contains_key(&day)
        })
        .collect();

    let current_streak_days = compute_current_streak(&day_totals, now_unix_seconds);

    DashboardStats {
        avg_wpm,
        total_words,
        total_speaking_seconds,
        minutes_saved,
        weekly_words,
        weekly_goal_words: WEEKLY_GOAL_WORDS,
        weekly_progress,
        today_words,
        yesterday_words,
        current_streak_days,
        typing_baseline_wpm: settings.typing_baseline_wpm,
        last_7_day_words,
        heatmap_28,
    }
}

fn compute_current_streak(day_totals: &HashMap<u64, u32>, now_unix: u64) -> u32 {
    let today = now_unix / 86_400;
    // If the user hasn't recorded yet today, count from yesterday so the streak
    // doesn't appear broken during the day.
    let start = if day_totals.contains_key(&today) {
        today
    } else {
        today.saturating_sub(1)
    };
    if !day_totals.contains_key(&start) {
        return 0;
    }
    let mut streak = 0u32;
    let mut day = start;
    loop {
        if day_totals.contains_key(&day) {
            streak += 1;
            if day == 0 {
                break;
            }
            day -= 1;
        } else {
            break;
        }
    }
    streak
}

pub fn calculate_insights_stats(
    records: &[TranscriptRecord],
    now_unix_seconds: u64,
) -> InsightsStats {
    let week_start = start_of_week_unix(now_unix_seconds);
    let daily_goal = WEEKLY_GOAL_WORDS / 7;

    let mut day_words = [0u32; 7];
    let mut day_active = [false; 7];

    for r in records {
        let Some(ts) = unix_seconds_from_iso(&r.created_at) else { continue };
        if ts < week_start || ts > now_unix_seconds { continue }
        let day_idx = ((ts - week_start) / 86_400) as usize;
        if day_idx < 7 {
            day_words[day_idx] += r.word_count;
            day_active[day_idx] = true;
        }
    }

    let weekly_words: u32 = day_words.iter().sum();
    let weekly_days_active = day_active.iter().filter(|&&a| a).count() as u32;

    let weekly_speaking_seconds: f64 = records
        .iter()
        .filter(|r| {
            unix_seconds_from_iso(&r.created_at)
                .map(|ts| ts >= week_start && ts <= now_unix_seconds)
                .unwrap_or(false)
        })
        .map(|r| r.duration_seconds.max(0.0))
        .sum();

    let day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    let daily_words_vec: Vec<DailyWordCount> = (0..7)
        .map(|i| DailyWordCount {
            label: day_names[i].to_string(),
            words: day_words[i],
            goal: daily_goal,
        })
        .collect();

    let words_pct = ((weekly_words as f64 / WEEKLY_GOAL_WORDS as f64) * 100.0)
        .clamp(0.0, 100.0) as u32;
    let speaking_pct = ((weekly_speaking_seconds / 28_800.0) * 100.0)
        .clamp(0.0, 100.0) as u32;
    let milestones_pct = ((weekly_days_active as f64 / 7.0) * 100.0)
        .clamp(0.0, 100.0) as u32;
    let overall_pct = (words_pct + speaking_pct + milestones_pct) / 3;

    let pb_longest = records
        .iter()
        .filter(|r| r.duration_seconds > 0.0)
        .max_by(|a, b| {
            a.duration_seconds
                .partial_cmp(&b.duration_seconds)
                .unwrap_or(Ordering::Equal)
        });

    let pb_fastest = records
        .iter()
        .filter(|r| r.wpm > 0.0)
        .max_by(|a, b| a.wpm.partial_cmp(&b.wpm).unwrap_or(Ordering::Equal));

    let (pb_most_words_day, pb_most_words_day_label) = compute_most_words_day(records);
    let (pb_best_streak_days, pb_streak_label) = compute_best_streak(records, now_unix_seconds);

    InsightsStats {
        week_label: format_week_label(week_start),
        weekly_words,
        weekly_speaking_seconds,
        weekly_days_active,
        weekly_goal_words: WEEKLY_GOAL_WORDS,
        weekly_goal_speaking_seconds: 28_800.0,
        words_pct,
        speaking_pct,
        milestones_pct,
        overall_pct,
        daily_words: daily_words_vec,
        daily_avg_words: weekly_words / 7,
        pb_longest_session_seconds: pb_longest.map_or(0.0, |r| r.duration_seconds),
        pb_longest_session_label: pb_longest
            .map(|r| format_record_label(&r.created_at, now_unix_seconds))
            .unwrap_or_default(),
        pb_fastest_wpm: pb_fastest.map_or(0.0, |r| r.wpm),
        pb_fastest_wpm_label: pb_fastest
            .map(|r| format_record_label(&r.created_at, now_unix_seconds))
            .unwrap_or_default(),
        pb_best_streak_days,
        pb_streak_label,
        pb_most_words_day,
        pb_most_words_day_label,
    }
}

/// Converts days-since-Unix-epoch back to (year, month, day).
/// Inverse of `days_from_civil` using Howard Hinnant's algorithm.
fn civil_from_days(days: u64) -> (i32, u32, u32) {
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i32 + (era * 400) as i32;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

fn format_day_label(day_since_epoch: u64) -> String {
    let (_, month, day) = civil_from_days(day_since_epoch);
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let month_name = MONTHS
        .get(month.saturating_sub(1) as usize)
        .copied()
        .unwrap_or("?");
    format!("{} {}", month_name, day)
}

fn format_week_label(week_start_unix: u64) -> String {
    format_day_label(week_start_unix / 86_400)
}

fn format_record_label(iso: &str, now_unix: u64) -> String {
    let Some(ts) = unix_seconds_from_iso(iso) else {
        return String::new();
    };
    let record_day = ts / 86_400;
    let now_day = now_unix / 86_400;
    let weekday_idx = ((record_day + 3) % 7) as usize;
    const WEEKDAYS: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    let weekday = WEEKDAYS[weekday_idx];
    if record_day == now_day {
        format!("{} · Today", weekday)
    } else if record_day == now_day.saturating_sub(1) {
        format!("{} · Yesterday", weekday)
    } else {
        format!("{} · {}", weekday, format_day_label(record_day))
    }
}

fn compute_most_words_day(records: &[TranscriptRecord]) -> (u32, String) {
    let mut day_totals: HashMap<u64, u32> = HashMap::new();
    for r in records {
        let Some(ts) = unix_seconds_from_iso(&r.created_at) else { continue };
        *day_totals.entry(ts / 86_400).or_insert(0) += r.word_count;
    }
    match day_totals.iter().max_by_key(|(_, &v)| v) {
        Some((&day, &count)) => (count, format_day_label(day)),
        None => (0, String::new()),
    }
}

fn compute_best_streak(records: &[TranscriptRecord], now_unix: u64) -> (u32, String) {
    let mut days: Vec<u64> = records
        .iter()
        .filter_map(|r| unix_seconds_from_iso(&r.created_at).map(|ts| ts / 86_400))
        .collect();
    days.sort_unstable();
    days.dedup();

    if days.is_empty() {
        return (0, String::new());
    }

    let mut best_len = 1u32;
    let mut best_end_day = days[0];
    let mut cur_len = 1u32;

    for i in 1..days.len() {
        if days[i] == days[i - 1] + 1 {
            cur_len += 1;
            if cur_len > best_len {
                best_len = cur_len;
                best_end_day = days[i];
            }
        } else {
            cur_len = 1;
        }
    }

    let today = now_unix / 86_400;
    let label = if best_end_day >= today.saturating_sub(1) {
        "Active streak".to_string()
    } else {
        format!("Ended {}", format_day_label(best_end_day))
    };

    (best_len, label)
}

fn time_ago(created_at: &str, now_unix: u64) -> String {
    let ts = unix_seconds_from_iso(created_at).unwrap_or(0);
    let diff = now_unix.saturating_sub(ts);
    if diff < 60 {
        "Just now".to_string()
    } else if diff < 3600 {
        let m = diff / 60;
        format!("{} minute{} ago", m, if m == 1 { "" } else { "s" })
    } else if diff < 86400 {
        let h = diff / 3600;
        format!("{} hour{} ago", h, if h == 1 { "" } else { "s" })
    } else if diff < 172800 {
        "Yesterday".to_string()
    } else {
        let d = diff / 86400;
        format!("{} days ago", d)
    }
}

fn fmt_duration(secs: f64) -> String {
    let total = secs as u64;
    format!("{:02}:{:02}", total / 60, total % 60)
}

fn derive_title(text: &str) -> String {
    let t = text.trim();
    // Use text up to first sentence-ending punctuation or newline, capped at 72 chars
    let end = t
        .find(['.', '!', '?', '\n'])
        .unwrap_or(t.len())
        .min(72);
    let candidate = t[..end].trim();
    if candidate.is_empty() {
        // Fall back to first 60 chars of raw text
        let cap = t.len().min(60);
        let s = &t[..cap];
        return if cap < t.len() {
            if let Some(p) = s.rfind(' ') {
                format!("{}…", &t[..p])
            } else {
                format!("{}…", s)
            }
        } else {
            s.to_string()
        };
    }
    if candidate.len() <= 72 {
        candidate.to_string()
    } else {
        let s = &candidate[..69];
        if let Some(p) = s.rfind(' ') {
            format!("{}…", &candidate[..p])
        } else {
            format!("{}…", s)
        }
    }
}

pub fn build_dashboard_latest(
    records: &[TranscriptRecord],
    now_unix: u64,
) -> DashboardLatestData {
    // Records are stored newest-first after load_history_file sorts them
    let latest = records.first().map(|r| LatestTranscriptInfo {
        id: r.id.clone(),
        title: derive_title(&r.text),
        time_ago: time_ago(&r.created_at, now_unix),
        duration_label: fmt_duration(r.duration_seconds),
        word_count: r.word_count,
        text: r.text.clone(),
    });

    let recent_sessions = records
        .iter()
        .take(5)
        .map(|r| RecentSession {
            id: r.id.clone(),
            title: derive_title(&r.text),
            time_ago: time_ago(&r.created_at, now_unix),
            word_count: r.word_count,
        })
        .collect();

    DashboardLatestData { latest, recent_sessions }
}

pub fn validate_typing_baseline_wpm(value: u32) -> Result<u32, String> {
    if (10..=180).contains(&value) {
        Ok(value)
    } else {
        Err("Typing baseline must be between 10 and 180 WPM.".to_string())
    }
}

pub fn load_history_file(
    path: &Path,
    legacy_plaintext_path: Option<&Path>,
) -> Result<Vec<TranscriptRecord>, String> {
    #[cfg(windows)]
    {
        load_windows_history_file(path, legacy_plaintext_path)
    }
    #[cfg(not(windows))]
    {
        let _ = legacy_plaintext_path;
        load_plaintext_history_file(path)
    }
}

pub fn save_history_file(path: &Path, records: &[TranscriptRecord]) -> Result<(), String> {
    #[cfg(windows)]
    {
        save_windows_history_file(path, records)
    }
    #[cfg(not(windows))]
    {
        save_plaintext_history_file(path, records)
    }
}

fn load_plaintext_history_file(path: &Path) -> Result<Vec<TranscriptRecord>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read transcript history: {}", e))?;
    parse_history_records(&text)
}

#[cfg(not(windows))]
fn save_plaintext_history_file(path: &Path, records: &[TranscriptRecord]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create history dir: {}", e))?;
        }
    }
    let payload = serde_json::to_string_pretty(records)
        .map_err(|e| format!("Failed to serialize transcript history: {}", e))?;
    let (temp_path, mut temp_file) = create_temp_history_file(path)
        .map_err(|e| format!("Failed to save transcript history: {}", e))?;
    temp_file.write_all(payload.as_bytes()).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Failed to save transcript history: {}", e)
    })?;
    temp_file.sync_all().map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Failed to save transcript history: {}", e)
    })?;
    drop(temp_file);
    atomic_replace(&temp_path, path).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Failed to save transcript history: {}", e)
    })
}

#[cfg(windows)]
fn load_windows_history_file(
    path: &Path,
    legacy_plaintext_path: Option<&Path>,
) -> Result<Vec<TranscriptRecord>, String> {
    if path.exists() {
        let bytes = crate::protected_store::load_encrypted_bytes(path)?.ok_or_else(|| {
            "Encrypted transcript history file disappeared during read.".to_string()
        })?;
        let text = String::from_utf8(bytes)
            .map_err(|e| format!("Failed to decode protected transcript history: {}", e))?;
        return parse_history_records(&text);
    }
    if let Some(legacy_path) = legacy_plaintext_path {
        if legacy_path.exists() {
            return migrate_plaintext_history(path, legacy_path);
        }
    }
    Ok(Vec::new())
}

#[cfg(windows)]
fn save_windows_history_file(path: &Path, records: &[TranscriptRecord]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create history dir: {}", e))?;
        }
    }
    let payload = serde_json::to_string_pretty(records)
        .map_err(|e| format!("Failed to serialize transcript history: {}", e))?;
    let (temp_path, mut temp_file) = create_temp_history_file(path)
        .map_err(|e| format!("Failed to save transcript history: {}", e))?;
    let cipher = match crate::protected_store::encrypt_bytes_for_storage(payload.as_bytes()) {
        Ok(cipher) => cipher,
        Err(error) => {
            let _ = std::fs::remove_file(&temp_path);
            return Err(error);
        }
    };
    temp_file.write_all(&cipher).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Failed to save transcript history: {}", e)
    })?;
    temp_file.sync_all().map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Failed to save transcript history: {}", e)
    })?;
    drop(temp_file);
    atomic_replace(&temp_path, path).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Failed to save transcript history: {}", e)
    })
}

#[cfg(windows)]
fn migrate_plaintext_history(
    path: &Path,
    legacy_plaintext_path: &Path,
) -> Result<Vec<TranscriptRecord>, String> {
    migrate_plaintext_history_with_saver(path, legacy_plaintext_path, save_windows_history_file)
}

#[cfg(windows)]
fn migrate_plaintext_history_with_saver<F>(
    path: &Path,
    legacy_plaintext_path: &Path,
    saver: F,
) -> Result<Vec<TranscriptRecord>, String>
where
    F: Fn(&Path, &[TranscriptRecord]) -> Result<(), String>,
{
    let records = load_plaintext_history_file(legacy_plaintext_path)?;
    saver(path, &records)?;
    std::fs::remove_file(legacy_plaintext_path).map_err(|e| {
        format!(
            "Failed to remove legacy plaintext transcript history: {}",
            e
        )
    })?;
    Ok(records)
}

fn parse_history_records(text: &str) -> Result<Vec<TranscriptRecord>, String> {
    serde_json::from_str::<Vec<TranscriptRecord>>(text)
        .map_err(|e| format!("Failed to parse transcript history: {}", e))
}

/// Performs a read-modify-write append; callers must serialize concurrent appends.
pub fn append_history_record(
    path: &Path,
    legacy_plaintext_path: Option<&Path>,
    record: TranscriptRecord,
) -> Result<Vec<TranscriptRecord>, String> {
    let mut records = load_history_file(path, legacy_plaintext_path)?;
    records.push(record);
    records.sort_by(compare_records_newest_first);
    save_history_file(path, &records)?;
    Ok(records)
}

fn compare_records_newest_first(a: &TranscriptRecord, b: &TranscriptRecord) -> Ordering {
    match (
        parse_iso_timestamp(&a.created_at),
        parse_iso_timestamp(&b.created_at),
    ) {
        (Some(a_ts), Some(b_ts)) => b_ts
            .cmp(&a_ts)
            .then_with(|| a.id.cmp(&b.id))
            .then_with(|| a.created_at.cmp(&b.created_at)),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => {
            a.id.cmp(&b.id)
                .then_with(|| a.created_at.cmp(&b.created_at))
        }
    }
}

fn temp_history_path(path: &std::path::Path) -> std::path::PathBuf {
    let unique_id = TEMP_FILE_COUNTER.fetch_add(1, AtomicOrdering::Relaxed);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("history.json");
    let temp_name = format!(
        ".{}.{}.{}.{}.tmp",
        file_name,
        crate::now_millis(),
        std::process::id(),
        unique_id
    );
    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.join(temp_name),
        _ => std::path::PathBuf::from(temp_name),
    }
}

fn create_temp_history_file(
    path: &std::path::Path,
) -> std::io::Result<(std::path::PathBuf, std::fs::File)> {
    for _ in 0..16 {
        let temp_path = temp_history_path(path);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(file) => return Ok((temp_path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "failed to create unique transcript history temp file",
    ))
}

#[cfg(windows)]
fn atomic_replace(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

    extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    fn wide(value: &OsStr) -> Vec<u16> {
        value.encode_wide().chain(std::iter::once(0)).collect()
    }

    let from_wide = wide(from.as_os_str());
    let to_wide = wide(to.as_os_str());
    let result = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn atomic_replace(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    std::fs::rename(from, to)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: &str, created_at: &str, words: u32, duration_seconds: f64) -> TranscriptRecord {
        TranscriptRecord {
            id: id.to_string(),
            created_at: created_at.to_string(),
            text: "sample transcript".to_string(),
            raw_text: "sample transcript".to_string(),
            duration_seconds,
            word_count: words,
            wpm: calculate_wpm(words, duration_seconds),
            ai_mode: None,
        }
    }

    #[test]
    fn count_words_ignores_extra_whitespace() {
        assert_eq!(count_words("  hello   world\nfrom OpenDicta  "), 4);
    }

    #[test]
    fn calculate_wpm_uses_speaking_minutes() {
        assert_eq!(calculate_wpm(120, 60.0).round(), 120.0);
    }

    #[test]
    fn calculate_wpm_returns_zero_for_zero_duration() {
        assert_eq!(calculate_wpm(10, 0.0), 0.0);
    }

    #[test]
    fn stats_sum_words_average_wpm_and_saved_minutes() {
        let records = vec![
            record("1", "2026-05-16T08:00:00Z", 120, 60.0),
            record("2", "2026-05-16T09:00:00Z", 80, 40.0),
        ];
        let settings = ProductivitySettings {
            typing_baseline_wpm: 40,
        };

        let stats = calculate_dashboard_stats(&records, &settings, 1_779_000_000);

        assert_eq!(stats.total_words, 200);
        assert_eq!(stats.avg_wpm.round(), 120.0);
        assert_eq!(stats.total_speaking_seconds.round(), 100.0);
        assert_eq!(stats.minutes_saved.round(), 3.0);
        assert_eq!(stats.weekly_goal_words, WEEKLY_GOAL_WORDS);
    }

    #[test]
    fn stats_count_only_current_week_records_through_now() {
        let records = vec![
            record("current-week", "2026-05-11T00:00:00Z", 100, 60.0),
            record("previous-week", "2026-05-10T23:59:59Z", 200, 60.0),
            record("future", "2026-05-18T00:00:00Z", 300, 60.0),
        ];
        let settings = ProductivitySettings {
            typing_baseline_wpm: 40,
        };

        let stats = calculate_dashboard_stats(&records, &settings, 1_778_932_800);

        assert_eq!(stats.weekly_words, 100);
        assert_eq!(stats.weekly_progress, 100.0 / WEEKLY_GOAL_WORDS as f64);
    }

    #[test]
    fn stats_include_fractional_z_timestamps_in_current_week() {
        let records = vec![record("fractional", "2026-05-16T08:00:00.123Z", 75, 60.0)];
        let settings = ProductivitySettings {
            typing_baseline_wpm: 40,
        };

        let stats = calculate_dashboard_stats(&records, &settings, 1_778_932_800);

        assert_eq!(stats.weekly_words, 75);
    }

    #[test]
    fn stats_ignore_malformed_timestamps_safely() {
        let records = vec![
            record("invalid-month", "2026-13-16T08:00:00Z", 50, 60.0),
            record("invalid-day", "2026-02-29T08:00:00Z", 60, 60.0),
            record("invalid-hour", "2026-05-16T24:00:00Z", 70, 60.0),
            record("invalid-minute", "2026-05-16T08:60:00Z", 80, 60.0),
            record("invalid-second", "2026-05-16T08:00:60Z", 90, 60.0),
            record("valid-leap-day", "2024-02-29T08:00:00Z", 100, 60.0),
        ];
        let settings = ProductivitySettings {
            typing_baseline_wpm: 40,
        };

        let stats = calculate_dashboard_stats(&records, &settings, 1_778_932_800);

        assert_eq!(stats.weekly_words, 0);
    }

    #[test]
    fn productivity_baseline_accepts_only_expected_range() {
        assert!(validate_typing_baseline_wpm(10).is_ok());
        assert!(validate_typing_baseline_wpm(180).is_ok());
        assert!(validate_typing_baseline_wpm(9).is_err());
        assert!(validate_typing_baseline_wpm(181).is_err());
    }

    #[test]
    fn save_and_load_history_round_trips_records() {
        let dir =
            std::env::temp_dir().join(format!("OpenDicta-history-test-{}", crate::now_millis()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("history.json");
        let records = vec![record("1", "2026-05-16T08:00:00Z", 12, 6.0)];

        save_history_file(&file, &records).unwrap();
        let loaded = load_history_file(&file, None).unwrap();

        assert_eq!(loaded, records);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn save_history_accepts_bare_relative_filename() {
        let file = std::path::PathBuf::from(format!(
            "OpenDicta-history-bare-{}.json",
            crate::now_millis()
        ));
        let records = vec![record("1", "2026-05-16T08:00:00Z", 12, 6.0)];

        save_history_file(&file, &records).unwrap();
        let loaded = load_history_file(&file, None).unwrap();

        assert_eq!(loaded, records);
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn temp_history_path_generates_unique_names_for_same_target() {
        let file = std::path::Path::new("history.json");

        let first = temp_history_path(file);
        let second = temp_history_path(file);

        assert_ne!(first, second);
    }

    #[test]
    fn repeated_save_history_uses_latest_contents_and_leaves_no_temp_files() {
        let dir = std::env::temp_dir().join(format!(
            "OpenDicta-history-repeated-save-{}",
            crate::now_millis()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("history.json");
        let first = vec![record("first", "2026-05-16T08:00:00Z", 12, 6.0)];
        let second = vec![record("second", "2026-05-16T09:00:00Z", 24, 12.0)];

        save_history_file(&file, &first).unwrap();
        save_history_file(&file, &second).unwrap();
        let loaded = load_history_file(&file, None).unwrap();
        let temp_files = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();

        assert_eq!(loaded, second);
        assert_eq!(temp_files, 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn load_history_returns_empty_when_file_is_missing() {
        let dir =
            std::env::temp_dir().join(format!("OpenDicta-history-missing-{}", crate::now_millis()));
        let file = dir.join("missing-history.json");

        let loaded = load_history_file(&file, None).unwrap();

        assert!(loaded.is_empty());
    }

    #[test]
    fn append_history_record_sorts_newest_first_and_persists() {
        let dir =
            std::env::temp_dir().join(format!("OpenDicta-history-append-{}", crate::now_millis()));
        let file = dir.join("history.json");
        let older = record("older", "2026-05-16T08:00:00Z", 12, 6.0);
        let newer = record("newer", "2026-05-16T09:00:00Z", 24, 12.0);

        save_history_file(&file, &[older]).unwrap();
        let records = append_history_record(&file, None, newer).unwrap();
        let loaded = load_history_file(&file, None).unwrap();

        assert_eq!(
            records.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            vec!["newer", "older"]
        );
        assert_eq!(loaded, records);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn append_history_record_sorts_fractional_timestamps_and_invalid_last() {
        let dir =
            std::env::temp_dir().join(format!("OpenDicta-history-sort-{}", crate::now_millis()));
        let file = dir.join("history.json");
        let invalid = record("invalid", "not-a-date", 12, 6.0);
        let whole = record("whole", "2026-05-16T08:00:00Z", 12, 6.0);
        let fractional = record("fractional", "2026-05-16T08:00:00.500Z", 12, 6.0);

        save_history_file(&file, &[invalid, whole]).unwrap();
        let records = append_history_record(&file, None, fractional).unwrap();

        assert_eq!(
            records.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            vec!["fractional", "whole", "invalid"]
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    #[test]
    fn load_history_migrates_plaintext_to_encrypted_file() {
        let dir =
            std::env::temp_dir().join(format!("OpenDicta-history-migrate-{}", crate::now_millis()));
        std::fs::create_dir_all(&dir).unwrap();
        let encrypted = dir.join("history.bin");
        let legacy = dir.join("history.json");
        let records = vec![record("1", "2026-05-16T08:00:00Z", 12, 6.0)];
        let payload = serde_json::to_string_pretty(&records).unwrap();
        std::fs::write(&legacy, payload).unwrap();

        let loaded = load_history_file(&encrypted, Some(&legacy)).unwrap();

        assert_eq!(loaded, records);
        assert!(encrypted.exists());
        assert!(!legacy.exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    #[test]
    fn migration_failure_leaves_plaintext_history_intact() {
        let dir = std::env::temp_dir().join(format!(
            "OpenDicta-history-migrate-fail-{}",
            crate::now_millis()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let encrypted = dir.join("history.bin");
        let legacy = dir.join("history.json");
        let records = vec![record("1", "2026-05-16T08:00:00Z", 12, 6.0)];
        let payload = serde_json::to_string_pretty(&records).unwrap();
        std::fs::write(&legacy, payload).unwrap();

        let result =
            migrate_plaintext_history_with_saver(&encrypted, &legacy, |_path, _records| {
                Err("simulated migration failure".to_string())
            });

        assert!(result.is_err());
        assert!(legacy.exists());
        assert!(!encrypted.exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    #[test]
    fn malformed_encrypted_history_fails_safely() {
        let dir = std::env::temp_dir().join(format!(
            "OpenDicta-history-malformed-{}",
            crate::now_millis()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let encrypted = dir.join("history.bin");
        std::fs::write(&encrypted, b"not-dpapi").unwrap();

        let result = load_history_file(&encrypted, None);

        assert!(result.is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
