# Dashboard Tabs Real History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved VoiceNote main window with Dashboard, History, and Settings tabs backed by real saved transcription history.

**Architecture:** Add a small Rust history module for local JSON persistence, metric calculation, and productivity settings. Wire successful transcription completion into that module, then add a React main-window shell that renders Dashboard, History, and the existing settings pages under one Apple-style window.

**Tech Stack:** Tauri 2, Rust, serde/serde_json, React 18, TypeScript, existing CSS/component primitives.

---

## File Structure

- Create `src-tauri/src/history.rs`
  - Owns transcript record structs, productivity settings structs, word counting, WPM calculation, dashboard stats, JSON read/write helpers, and unit tests.
- Modify `src-tauri/src/lib.rs`
  - Imports `history`, adds productivity setting state, loads/saves the setting with app settings, exposes Tauri commands, stores a pending transcription duration, and saves history records when final text is ready.
- Modify `src/windows/settingsTypes.ts`
  - Adds top-level main window page types, history record types, dashboard stat types, and productivity setting types.
- Create `src/windows/MainWindow.tsx`
  - Owns top-level Dashboard / History / Settings navigation and reuses the current window chrome.
- Create `src/windows/Dashboard.tsx`
  - Renders the focused overview dashboard, empty state, stat tiles, Activity-style progress ring, last five list, and calm coach panel.
- Create `src/windows/History.tsx`
  - Renders the transcript history list/table and empty state.
- Modify `src/windows/Settings.tsx`
  - Exports the existing settings pages as a reusable `SettingsContent`, adds a Productivity section, and keeps existing settings behavior intact.
- Modify `src/App.tsx`
  - Routes `window=settings` to `MainWindow`.
- Modify `src/styles.css`
  - Adds dashboard/history/main-window styles while preserving existing voicebar/settings control styles.

---

### Task 1: Add Rust History Data Model And Pure Metric Tests

**Files:**
- Create: `src-tauri/src/history.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create failing unit tests for word count and dashboard stats**

Create `src-tauri/src/history.rs` with this initial test-focused content:

```rust
use serde::{Deserialize, Serialize};

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
}

pub const DEFAULT_TYPING_BASELINE_WPM: u32 = 40;
pub const WEEKLY_GOAL_WORDS: u32 = 5_000;

pub fn count_words(_text: &str) -> u32 {
    unimplemented!("red phase")
}

pub fn calculate_wpm(_word_count: u32, _duration_seconds: f64) -> f64 {
    unimplemented!("red phase")
}

pub fn calculate_dashboard_stats(
    _records: &[TranscriptRecord],
    _settings: &ProductivitySettings,
    _now_unix_seconds: u64,
) -> DashboardStats {
    unimplemented!("red phase")
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
        assert_eq!(count_words("  hello   world\nfrom VoiceNote  "), 4);
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
        let settings = ProductivitySettings { typing_baseline_wpm: 40 };

        let stats = calculate_dashboard_stats(&records, &settings, 1_779_000_000);

        assert_eq!(stats.total_words, 200);
        assert_eq!(stats.avg_wpm.round(), 120.0);
        assert_eq!(stats.total_speaking_seconds.round(), 100.0);
        assert_eq!(stats.minutes_saved.round(), 3.0);
        assert_eq!(stats.weekly_goal_words, WEEKLY_GOAL_WORDS);
    }
}
```

- [ ] **Step 2: Register the module so tests compile**

At the top of `src-tauri/src/lib.rs`, near `mod ai;`, add:

```rust
mod history;
```

- [ ] **Step 3: Run the failing Rust tests**

Run:

```powershell
cargo test -p voicenote history::
```

Expected: tests compile and fail at `unimplemented!("red phase")`.

- [ ] **Step 4: Implement the pure metric helpers**

Replace the three red-phase functions in `src-tauri/src/history.rs` with:

```rust
pub fn count_words(text: &str) -> u32 {
    text.split_whitespace().filter(|part| !part.trim().is_empty()).count() as u32
}

pub fn calculate_wpm(word_count: u32, duration_seconds: f64) -> f64 {
    if duration_seconds <= 0.0 {
        return 0.0;
    }
    word_count as f64 / (duration_seconds / 60.0)
}

fn unix_seconds_from_iso(value: &str) -> Option<u64> {
    let date_time = value.strip_suffix('Z')?;
    let (date, time) = date_time.split_once('T')?;
    let mut date_parts = date.split('-');
    let year: i32 = date_parts.next()?.parse().ok()?;
    let month: u32 = date_parts.next()?.parse().ok()?;
    let day: u32 = date_parts.next()?.parse().ok()?;
    let mut time_parts = time.split(':');
    let hour: u32 = time_parts.next()?.parse().ok()?;
    let minute: u32 = time_parts.next()?.parse().ok()?;
    let second: u32 = time_parts.next()?.parse().ok()?;
    Some(days_from_civil(year, month, day) * 86_400 + hour as u64 * 3_600 + minute as u64 * 60 + second as u64)
}

fn days_from_civil(year: i32, month: u32, day: u32) -> u64 {
    let year = year - (month <= 2) as i32;
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = (year - era * 400) as u32;
    let doy = (153 * (month + if month > 2 { 9 } else { 12 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era as i64 * 146_097 + doe as i64 - 719_468).max(0) as u64
}

fn start_of_week_unix(now_unix_seconds: u64) -> u64 {
    let days_since_epoch = now_unix_seconds / 86_400;
    let day_of_week_monday_zero = (days_since_epoch + 3) % 7;
    (days_since_epoch - day_of_week_monday_zero) * 86_400
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
        .filter(|r| unix_seconds_from_iso(&r.created_at).map(|ts| ts >= week_start).unwrap_or(false))
        .map(|r| r.word_count)
        .sum();
    let weekly_progress = (weekly_words as f64 / WEEKLY_GOAL_WORDS as f64).clamp(0.0, 1.0);

    DashboardStats {
        avg_wpm,
        total_words,
        total_speaking_seconds,
        minutes_saved,
        weekly_words,
        weekly_goal_words: WEEKLY_GOAL_WORDS,
        weekly_progress,
    }
}
```

- [ ] **Step 5: Run the Rust tests**

Run:

```powershell
cargo test -p voicenote history::
```

Expected: all `history::tests` pass.

- [ ] **Step 6: Commit Task 1**

Run:

```powershell
git add src-tauri/src/history.rs src-tauri/src/lib.rs
git commit -m "feat: add transcript history metrics"
```

---

### Task 2: Add History JSON Persistence And Productivity Validation

**Files:**
- Modify: `src-tauri/src/history.rs`

- [ ] **Step 1: Add failing persistence and validation tests**

Append these tests inside `#[cfg(test)] mod tests` in `src-tauri/src/history.rs`:

```rust
    #[test]
    fn productivity_baseline_accepts_only_expected_range() {
        assert!(validate_typing_baseline_wpm(10).is_ok());
        assert!(validate_typing_baseline_wpm(180).is_ok());
        assert!(validate_typing_baseline_wpm(9).is_err());
        assert!(validate_typing_baseline_wpm(181).is_err());
    }

    #[test]
    fn save_and_load_history_round_trips_records() {
        let dir = std::env::temp_dir().join(format!("voicenote-history-test-{}", crate::now_millis()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("history.json");
        let records = vec![record("1", "2026-05-16T08:00:00Z", 12, 6.0)];

        save_history_file(&file, &records).unwrap();
        let loaded = load_history_file(&file).unwrap();

        assert_eq!(loaded, records);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn load_history_returns_empty_when_file_is_missing() {
        let dir = std::env::temp_dir().join(format!("voicenote-history-missing-{}", crate::now_millis()));
        let file = dir.join("missing-history.json");

        let loaded = load_history_file(&file).unwrap();

        assert!(loaded.is_empty());
    }
```

- [ ] **Step 2: Run tests to confirm red phase**

Run:

```powershell
cargo test -p voicenote history::
```

Expected: fails because `validate_typing_baseline_wpm`, `save_history_file`, and `load_history_file` are undefined.

- [ ] **Step 3: Implement validation and JSON persistence**

Add these functions to `src-tauri/src/history.rs`:

```rust
pub fn validate_typing_baseline_wpm(value: u32) -> Result<u32, String> {
    if (10..=180).contains(&value) {
        Ok(value)
    } else {
        Err("Typing baseline must be between 10 and 180 WPM.".to_string())
    }
}

pub fn load_history_file(path: &std::path::Path) -> Result<Vec<TranscriptRecord>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read transcript history: {}", e))?;
    serde_json::from_str::<Vec<TranscriptRecord>>(&text)
        .map_err(|e| format!("Failed to parse transcript history: {}", e))
}

pub fn save_history_file(path: &std::path::Path, records: &[TranscriptRecord]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create history dir: {}", e))?;
    }
    let payload = serde_json::to_string_pretty(records)
        .map_err(|e| format!("Failed to serialize transcript history: {}", e))?;
    std::fs::write(path, payload)
        .map_err(|e| format!("Failed to save transcript history: {}", e))
}

pub fn append_history_record(path: &std::path::Path, record: TranscriptRecord) -> Result<Vec<TranscriptRecord>, String> {
    let mut records = load_history_file(path)?;
    records.push(record);
    records.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    save_history_file(path, &records)?;
    Ok(records)
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
cargo test -p voicenote history::
```

Expected: all history tests pass.

- [ ] **Step 5: Commit Task 2**

Run:

```powershell
git add src-tauri/src/history.rs
git commit -m "feat: persist transcript history locally"
```

---

### Task 3: Wire History Commands, Productivity Setting, And Save-On-Transcript

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add backend state fields**

In `struct AppState`, add:

```rust
    /// User typing speed baseline used for time-saved calculations.
    typing_baseline_wpm: Arc<Mutex<u32>>,
    /// Metadata for the transcription currently being processed by the worker.
    pending_transcript_meta: Arc<Mutex<Option<PendingTranscriptMeta>>>,
```

Near `ProviderRuntimeStatus`, add:

```rust
#[derive(Clone)]
struct PendingTranscriptMeta {
    duration_seconds: f64,
    ai_mode: Option<String>,
}
```

In `AppState::new()`, add:

```rust
            typing_baseline_wpm: Arc::new(Mutex::new(history::DEFAULT_TYPING_BASELINE_WPM)),
            pending_transcript_meta: Arc::new(Mutex::new(None)),
```

- [ ] **Step 2: Add app settings persistence for typing baseline**

Find the `AppSettings` struct in `src-tauri/src/lib.rs` and add:

```rust
    #[serde(default = "default_typing_baseline_wpm")]
    typing_baseline_wpm: u32,
```

Add this helper near other settings defaults:

```rust
fn default_typing_baseline_wpm() -> u32 {
    history::DEFAULT_TYPING_BASELINE_WPM
}
```

In `save_app_settings`, add:

```rust
        typing_baseline_wpm: *state.typing_baseline_wpm.lock().unwrap(),
```

In `load_app_settings`, add:

```rust
    *state.typing_baseline_wpm.lock().unwrap() =
        history::validate_typing_baseline_wpm(settings.typing_baseline_wpm)
            .unwrap_or(history::DEFAULT_TYPING_BASELINE_WPM);
```

- [ ] **Step 3: Add history file path helper and commands**

Add these functions near `app_settings_path`:

```rust
fn transcript_history_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(dir.join("transcript-history.json"))
}

#[tauri::command]
async fn get_transcript_history(app: AppHandle) -> Result<Vec<history::TranscriptRecord>, String> {
    history::load_history_file(&transcript_history_path(&app)?)
}

#[tauri::command]
async fn get_dashboard_stats(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
) -> Result<history::DashboardStats, String> {
    let records = history::load_history_file(&transcript_history_path(&app)?)?;
    let settings = history::ProductivitySettings {
        typing_baseline_wpm: *state.typing_baseline_wpm.lock().unwrap(),
    };
    Ok(history::calculate_dashboard_stats(&records, &settings, now_millis() / 1_000))
}

#[tauri::command]
async fn get_productivity_settings(
    state: tauri::State<'_, SharedState>,
) -> Result<history::ProductivitySettings, String> {
    Ok(history::ProductivitySettings {
        typing_baseline_wpm: *state.typing_baseline_wpm.lock().unwrap(),
    })
}

#[tauri::command]
async fn set_typing_baseline_wpm(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    value: u32,
) -> Result<(), String> {
    let value = history::validate_typing_baseline_wpm(value)?;
    *state.typing_baseline_wpm.lock().unwrap() = value;
    save_app_settings(&app, state.inner().clone())
}
```

- [ ] **Step 4: Register the commands**

In `tauri::generate_handler![...]`, add:

```rust
            get_transcript_history,
            get_dashboard_stats,
            get_productivity_settings,
            set_typing_baseline_wpm,
```

- [ ] **Step 5: Store pending duration in `finalize_recording`**

After `duration_sec` is calculated and before sending the WAV path to the worker, add:

```rust
    let default_mode = state.ai_default_mode.lock().unwrap().clone();
    let active_profile = state.active_profile.lock().unwrap().clone();
    *state.pending_transcript_meta.lock().unwrap() = Some(PendingTranscriptMeta {
        duration_seconds: duration_sec as f64,
        ai_mode: active_profile.or_else(|| if default_mode == "raw" { None } else { Some(default_mode) }),
    });
```

In every early error path in `finalize_recording` after samples have been taken, clear the pending metadata before returning:

```rust
        *state.pending_transcript_meta.lock().unwrap() = None;
```

- [ ] **Step 6: Save a history record before emitting `transcript-ready`**

Inside the `TRANSCRIPT:` branch, just before emitting `"transcript-ready"`, add:

```rust
                    let meta = state_for_stdout.pending_transcript_meta.lock().unwrap().take();
                    if let Some(meta) = meta {
                        let record = history::TranscriptRecord {
                            id: format!("tr_{}", now_millis()),
                            created_at: iso_timestamp_now(),
                            text: final_text.clone(),
                            raw_text: transcript.clone(),
                            duration_seconds: meta.duration_seconds,
                            word_count: history::count_words(&final_text),
                            wpm: history::calculate_wpm(history::count_words(&final_text), meta.duration_seconds),
                            ai_mode: meta.ai_mode,
                        };
                        match transcript_history_path(&app_stdout)
                            .and_then(|path| history::append_history_record(&path, record).map(|_| ()))
                        {
                            Ok(()) => {}
                            Err(e) => eprintln!("Failed to save transcript history: {}", e),
                        }
                    }
```

Add this timestamp helper near `now_millis`:

```rust
fn iso_timestamp_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    unix_seconds_to_iso(now)
}

fn unix_seconds_to_iso(seconds: u64) -> String {
    let days = seconds / 86_400;
    let seconds_of_day = seconds % 86_400;
    let (year, month, day) = civil_from_days(days as i64);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year,
        month,
        day,
        seconds_of_day / 3_600,
        (seconds_of_day % 3_600) / 60,
        seconds_of_day % 60
    )
}

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    ((y + (m <= 2) as i64) as i32, m as u32, d as u32)
}
```

- [ ] **Step 7: Run backend checks**

Run:

```powershell
cargo test -p voicenote history::
cargo check -p voicenote
```

Expected: tests pass and `cargo check` completes without errors.

- [ ] **Step 8: Commit Task 3**

Run:

```powershell
git add src-tauri/src/lib.rs src-tauri/src/history.rs
git commit -m "feat: save completed transcriptions"
```

---

### Task 4: Add Frontend Types And Data Loading Helpers

**Files:**
- Modify: `src/windows/settingsTypes.ts`

- [ ] **Step 1: Add shared frontend types**

Append to `src/windows/settingsTypes.ts`:

```ts
export type MainPage = "dashboard" | "history" | "settings";

export interface TranscriptRecord {
  id: string;
  created_at: string;
  text: string;
  raw_text: string;
  duration_seconds: number;
  word_count: number;
  wpm: number;
  ai_mode: string | null;
}

export interface DashboardStats {
  avg_wpm: number;
  total_words: number;
  total_speaking_seconds: number;
  minutes_saved: number;
  weekly_words: number;
  weekly_goal_words: number;
  weekly_progress: number;
}

export interface ProductivitySettings {
  typing_baseline_wpm: number;
}
```

- [ ] **Step 2: Run TypeScript build**

Run:

```powershell
npm run build
```

Expected: build passes.

- [ ] **Step 3: Commit Task 4**

Run:

```powershell
git add src/windows/settingsTypes.ts
git commit -m "feat: add dashboard frontend types"
```

---

### Task 5: Split Existing Settings Content For Reuse

**Files:**
- Modify: `src/windows/Settings.tsx`

- [ ] **Step 1: Preserve the old default export but extract reusable content**

In `src/windows/Settings.tsx`, change the default component shape from:

```tsx
export default function Settings() {
  const [page, setPage] = useState<Page>(getInitialPage);
  const [accent, setAccent] = useState("#0A84FF");
  // ...
  return (
    <div className="wv-settings" data-appearance="light" data-variant="warm">
      ...
    </div>
  );
}
```

to:

```tsx
export default function Settings() {
  return <SettingsWindow />;
}

export function SettingsWindow() {
  const [page, setPage] = useState<Page>(getInitialPage);
  const [accent, setAccent] = useState("#0A84FF");

  const closeSettings = () => {
    void getCurrentWindow().hide();
  };

  useEffect(() => {
    void getCurrentWindow().setFocus();
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("navigate-to-page", (event) => {
      setPage(normalizePage(event.payload));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--ac", accent);
  }, [accent]);

  useEffect(() => {
    void invoke<string>("get_waveform_color").then(setAccent).catch(console.error);
  }, []);

  return (
    <div className="wv-settings" data-appearance="light" data-variant="warm">
      <div className="wv-chrome">
        <div className="wv-traffic">
          <button aria-label="Close settings" onClick={closeSettings} style={{ background: "#FF5F57" }} />
          <button aria-label="Hide settings" onClick={closeSettings} style={{ background: "#FEBC2E" }} />
          <button aria-label="Settings status" type="button" style={{ background: "#28C840" }} disabled />
        </div>
        <div className="wv-chrome-title">VoiceNote Settings</div>
        <div className="wv-chrome-spacer" />
      </div>
      <SettingsContent page={page} onPageChange={setPage} accent={accent} onAccentChange={setAccent} />
    </div>
  );
}
```

Then add this exported component below `SettingsWindow`:

```tsx
export function SettingsContent({
  page,
  onPageChange,
  accent,
  onAccentChange,
}: {
  page: Page;
  onPageChange: (page: Page) => void;
  accent: string;
  onAccentChange: (value: string) => void;
}) {
  return (
    <div className="wv-body">
      <Sidebar active={page} onSelect={onPageChange} />
      <main className="wv-main">
        <ToastProvider>
          <div style={{ display: page === "general" ? "" : "none" }}><GeneralTab /></div>
          <div style={{ display: page === "shortcut" ? "" : "none" }}><ShortcutTab /></div>
          <div style={{ display: page === "microphone" ? "" : "none" }}><MicrophoneTab accent={accent} onAccentChange={onAccentChange} /></div>
          <div style={{ display: page === "model" ? "" : "none" }}><ModelTab /></div>
          <div style={{ display: page === "appearance" ? "" : "none" }}><AppearanceTab accent={accent} onAccentChange={onAccentChange} /></div>
          <div style={{ display: page === "ai" ? "" : "none" }}><AiTab /></div>
          <div style={{ display: page === "diagnostics" ? "" : "none" }}><DiagnosticsTab /></div>
          <div style={{ display: page === "about" ? "" : "none" }}><AboutTab onNavigate={onPageChange} /></div>
        </ToastProvider>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Remove duplicated old return block**

Delete the original inline `<div className="wv-body">...` block from `SettingsWindow` so `SettingsContent` is the single owner of settings page rendering.

- [ ] **Step 3: Run build**

Run:

```powershell
npm run build
```

Expected: build passes and the old settings window still compiles.

- [ ] **Step 4: Commit Task 5**

Run:

```powershell
git add src/windows/Settings.tsx
git commit -m "refactor: extract reusable settings content"
```

---

### Task 6: Add Productivity Settings Row

**Files:**
- Modify: `src/windows/Settings.tsx`

- [ ] **Step 1: Add Productivity tab/page type**

In `src/windows/settingsTypes.ts`, change:

```ts
export type Page = "general" | "shortcut" | "microphone" | "model" | "appearance" | "ai" | "diagnostics" | "about";
```

to:

```ts
export type Page = "general" | "shortcut" | "microphone" | "model" | "ai" | "productivity" | "appearance" | "diagnostics" | "about";
```

In `PAGE_ALIASES` in `Settings.tsx`, add:

```ts
  productivity: "productivity",
```

In `Sidebar`, add the Productivity item after AI:

```tsx
    { id: "productivity", label: "Productivity", icon: <ActivityIcon /> },
```

In `SettingsContent`, add:

```tsx
          <div style={{ display: page === "productivity" ? "" : "none" }}><ProductivityTab /></div>
```

- [ ] **Step 2: Add ProductivityTab component**

Add this component near the other tab components in `Settings.tsx`:

```tsx
function ProductivityTab() {
  const [baseline, setBaseline] = useState(40);
  const [draft, setDraft] = useState("40");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showErr, showOk } = useToast();

  useEffect(() => {
    void invoke<{ typing_baseline_wpm: number }>("get_productivity_settings")
      .then((settings) => {
        setBaseline(settings.typing_baseline_wpm);
        setDraft(String(settings.typing_baseline_wpm));
      })
      .catch((e) => showErr(`Could not load productivity settings: ${String(e)}`));
  }, []);

  const save = async () => {
    const value = Number(draft);
    if (!Number.isInteger(value) || value < 10 || value > 180) {
      setError("Enter a value from 10 to 180 WPM.");
      setDraft(String(baseline));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await invoke("set_typing_baseline_wpm", { value });
      setBaseline(value);
      setDraft(String(value));
      showOk("Typing baseline updated.");
    } catch (e) {
      showErr(`Failed to save typing baseline: ${String(e)}`);
      setDraft(String(baseline));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wv-pane">
      <PaneHeader title="Productivity" subtitle="Control how VoiceNote estimates time saved." />
      <SettingsSection title="Time saved">
        <SettingsRow label="Typing baseline" hint={error ?? "Used to compare dictated words against manual typing speed."} last>
          <div className="wv-inline">
            <input
              className="wv-input wv-input--small"
              type="number"
              min={10}
              max={180}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void save()}
              disabled={busy}
            />
            <span className="wv-note">WPM</span>
          </div>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
```

- [ ] **Step 3: Run build**

Run:

```powershell
npm run build
```

Expected: build passes.

- [ ] **Step 4: Commit Task 6**

Run:

```powershell
git add src/windows/Settings.tsx src/windows/settingsTypes.ts
git commit -m "feat: add productivity settings"
```

---

### Task 7: Build Dashboard And History Components

**Files:**
- Create: `src/windows/Dashboard.tsx`
- Create: `src/windows/History.tsx`

- [ ] **Step 1: Create Dashboard component**

Create `src/windows/Dashboard.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DashboardStats, TranscriptRecord } from "./settingsTypes";

const EMPTY_STATS: DashboardStats = {
  avg_wpm: 0,
  total_words: 0,
  total_speaking_seconds: 0,
  minutes_saved: 0,
  weekly_words: 0,
  weekly_goal_words: 5000,
  weekly_progress: 0,
};

export default function Dashboard() {
  const [records, setRecords] = useState<TranscriptRecord[]>([]);
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [history, dashboardStats] = await Promise.all([
          invoke<TranscriptRecord[]>("get_transcript_history"),
          invoke<DashboardStats>("get_dashboard_stats"),
        ]);
        if (!cancelled) {
          setRecords(history);
          setStats(dashboardStats);
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const lastFive = records.slice(0, 5);
  const coachText = useMemo(() => {
    if (stats.total_words === 0) return "Start your first note and VoiceNote will track your progress here.";
    if (stats.minutes_saved >= 60) return `You saved ${formatHours(stats.minutes_saved)} by talking. Keep going.`;
    return `You saved ${Math.round(stats.minutes_saved)} minutes by talking. Keep going.`;
  }, [stats.minutes_saved, stats.total_words]);

  return (
    <div className="wv-pane wv-dashboard">
      <div className="wv-pane-head">
        <div>
          <div className="wv-pane-title">Dashboard</div>
          <div className="wv-pane-sub">Your dictation pace, saved time, and recent notes.</div>
        </div>
      </div>

      <div className="wv-dash-grid">
        <section className="wv-dash-progress" aria-label="Weekly word goal">
          <ProgressRing progress={stats.weekly_progress} />
          <div className="wv-dash-progress-copy">
            <div className="wv-dash-progress-value">{stats.weekly_words.toLocaleString()}</div>
            <div className="wv-dash-progress-label">of {stats.weekly_goal_words.toLocaleString()} words this week</div>
          </div>
        </section>

        <section className="wv-dash-metrics" aria-label="VoiceNote metrics">
          <Metric label="Avg WPM" value={Math.round(stats.avg_wpm).toString()} />
          <Metric label="Words total" value={stats.total_words.toLocaleString()} />
          <Metric label="Hours saved" value={formatSaved(stats.minutes_saved)} />
        </section>

        <section className="wv-dash-list">
          <div className="wv-dash-section-title">Last 5 transcriptions</div>
          {loading ? (
            <div className="wv-history-empty">Loading...</div>
          ) : lastFive.length === 0 ? (
            <div className="wv-history-empty">Completed transcriptions will appear here.</div>
          ) : (
            <div className="wv-history-list">
              {lastFive.map((record) => <TranscriptRow key={record.id} record={record} compact />)}
            </div>
          )}
        </section>

        <section className="wv-dash-coach">
          <div className="wv-dash-section-title">Keep going</div>
          <p>{coachText}</p>
        </section>
      </div>
    </div>
  );
}

function ProgressRing({ progress }: { progress: number }) {
  const clamped = Math.max(0, Math.min(1, progress));
  const degrees = clamped * 360;
  return (
    <div
      className="wv-progress-ring"
      style={{ "--progress-deg": `${degrees}deg` } as React.CSSProperties}
      aria-hidden="true"
    >
      <div className="wv-progress-ring-core">{Math.round(clamped * 100)}%</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="wv-dash-metric">
      <div className="wv-dash-metric-label">{label}</div>
      <div className="wv-dash-metric-value">{value}</div>
    </div>
  );
}

export function TranscriptRow({ record, compact = false }: { record: TranscriptRecord; compact?: boolean }) {
  return (
    <div className="wv-history-row" data-compact={compact ? "1" : "0"}>
      <div className="wv-history-preview">{record.text}</div>
      <div className="wv-history-meta">
        <span>{formatDate(record.created_at)}</span>
        <span>{record.word_count.toLocaleString()} words</span>
        <span>{Math.round(record.wpm)} WPM</span>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatSaved(minutes: number) {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

function formatHours(minutes: number) {
  return `${(minutes / 60).toFixed(1)} hours`;
}
```

- [ ] **Step 2: Create History component**

Create `src/windows/History.tsx`:

```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TranscriptRecord } from "./settingsTypes";
import { TranscriptRow } from "./Dashboard";

export default function History() {
  const [records, setRecords] = useState<TranscriptRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void invoke<TranscriptRecord[]>("get_transcript_history")
      .then((items) => {
        if (!cancelled) setRecords(items);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const selected = records.find((record) => record.id === selectedId) ?? records[0] ?? null;

  return (
    <div className="wv-pane wv-history-page">
      <div className="wv-pane-head">
        <div>
          <div className="wv-pane-title">History</div>
          <div className="wv-pane-sub">Recent transcripts saved locally on this device.</div>
        </div>
      </div>

      {loading ? (
        <div className="wv-history-empty">Loading...</div>
      ) : records.length === 0 ? (
        <div className="wv-history-empty">Completed transcriptions will appear here after your first recording.</div>
      ) : (
        <div className="wv-history-layout">
          <div className="wv-history-list">
            {records.map((record) => (
              <button
                type="button"
                key={record.id}
                className="wv-history-row-btn"
                data-active={record.id === selected?.id ? "1" : "0"}
                onClick={() => setSelectedId(record.id)}
              >
                <TranscriptRow record={record} />
              </button>
            ))}
          </div>
          <aside className="wv-history-detail">
            {selected && (
              <>
                <div className="wv-dash-section-title">Transcript</div>
                <p>{selected.text}</p>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run build**

Run:

```powershell
npm run build
```

Expected: build passes. If TypeScript reports an unused import from the new files, remove that import and rerun `npm run build` until it passes.

- [ ] **Step 4: Commit Task 7**

Run:

```powershell
git add src/windows/Dashboard.tsx src/windows/History.tsx
git commit -m "feat: add dashboard and history views"
```

---

### Task 8: Build Main Window Shell And Route Settings Window To It

**Files:**
- Create: `src/windows/MainWindow.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create MainWindow component**

Create `src/windows/MainWindow.tsx`:

```tsx
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Dashboard from "./Dashboard";
import History from "./History";
import { SettingsContent } from "./Settings";
import type { MainPage, Page } from "./settingsTypes";
import { ActivityIcon, GearIcon, MicIcon } from "../ui/icons";
import { invoke } from "@tauri-apps/api/core";

export default function MainWindow() {
  const [mainPage, setMainPage] = useState<MainPage>("dashboard");
  const [settingsPage, setSettingsPage] = useState<Page>("general");
  const [accent, setAccent] = useState("#0A84FF");

  useEffect(() => {
    void getCurrentWindow().setFocus();
    void invoke<string>("get_waveform_color").then(setAccent).catch(console.error);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--ac", accent);
  }, [accent]);

  const close = () => {
    void getCurrentWindow().hide();
  };

  return (
    <div className="wv-settings wv-main-window" data-appearance="light" data-variant="warm">
      <div className="wv-chrome">
        <div className="wv-traffic">
          <button aria-label="Close VoiceNote" onClick={close} style={{ background: "#FF5F57" }} />
          <button aria-label="Hide VoiceNote" onClick={close} style={{ background: "#FEBC2E" }} />
          <button aria-label="VoiceNote status" type="button" style={{ background: "#28C840" }} disabled />
        </div>
        <div className="wv-chrome-title">VoiceNote</div>
        <div className="wv-chrome-spacer" />
      </div>

      <div className="wv-body">
        <aside className="wv-sidebar">
          <div className="wv-sidebar-head">
            <span className="wv-brand-mark"><MicIcon /></span>
            <div className="wv-brand-block">
              <div className="wv-brand-name">VoiceNote</div>
              <div className="wv-brand-ver">Dashboard</div>
            </div>
          </div>
          <nav className="wv-nav">
            <MainNavItem id="dashboard" label="Dashboard" active={mainPage} onSelect={setMainPage} icon={<ActivityIcon />} />
            <MainNavItem id="history" label="History" active={mainPage} onSelect={setMainPage} icon={<ActivityIcon />} />
            <MainNavItem id="settings" label="Settings" active={mainPage} onSelect={setMainPage} icon={<GearIcon />} />
          </nav>
        </aside>

        <main className="wv-main">
          {mainPage === "dashboard" && <Dashboard />}
          {mainPage === "history" && <History />}
          {mainPage === "settings" && (
            <SettingsContent
              page={settingsPage}
              onPageChange={setSettingsPage}
              accent={accent}
              onAccentChange={setAccent}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function MainNavItem({
  id,
  label,
  icon,
  active,
  onSelect,
}: {
  id: MainPage;
  label: string;
  icon: React.ReactNode;
  active: MainPage;
  onSelect: (page: MainPage) => void;
}) {
  return (
    <button
      type="button"
      className="wv-nav-item"
      data-active={active === id ? "1" : "0"}
      aria-current={active === id ? "page" : undefined}
      onClick={() => onSelect(id)}
    >
      <span className="wv-nav-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
```

- [ ] **Step 2: Route App to MainWindow**

In `src/App.tsx`, add:

```tsx
const MainWindow = lazy(() => import("./windows/MainWindow"));
```

Update the prefetch block:

```tsx
if (windowName === "settings")    void import("./windows/MainWindow");
```

Update `prefetchWindows`:

```tsx
  void import("./windows/MainWindow");
```

Change the settings route:

```tsx
  if (windowName === "settings")    return <Suspense fallback={null}><MainWindow /></Suspense>;
```

- [ ] **Step 3: Increase settings/main window size**

In `src-tauri/src/lib.rs`, find both `WebviewWindowBuilder::new(... "settings" ...)` builders and change the window metadata:

```rust
                        .title("VoiceNote")
                        .inner_size(820.0, 620.0)
                        .min_inner_size(760.0, 540.0)
                        .resizable(true)
```

Keep `.decorations(false)` and `.transparent(true)`.

- [ ] **Step 4: Run build**

Run:

```powershell
npm run build
cargo check -p voicenote
```

Expected: frontend build and backend check pass.

- [ ] **Step 5: Commit Task 8**

Run:

```powershell
git add src/windows/MainWindow.tsx src/App.tsx src-tauri/src/lib.rs
git commit -m "feat: add VoiceNote main window tabs"
```

---

### Task 9: Add Dashboard, History, And Main Window Styling

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Add stable dashboard and history CSS**

Append to `src/styles.css` before the responsive section:

```css
.wv-main-window .wv-sidebar {
  flex-basis: 190px;
  width: 190px;
}

.wv-dashboard,
.wv-history-page {
  max-width: 980px;
}

.wv-dash-grid {
  display: grid;
  grid-template-columns: minmax(260px, 1.05fr) minmax(220px, .95fr);
  gap: 14px;
}

.wv-dash-progress,
.wv-dash-metrics,
.wv-dash-list,
.wv-dash-coach,
.wv-history-detail {
  background: rgba(255,255,255,0.72);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(100,70,40,0.05);
}

.wv-dash-progress {
  min-height: 240px;
  padding: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 22px;
}

.wv-progress-ring {
  width: 152px;
  aspect-ratio: 1;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background:
    conic-gradient(var(--ac) 0 var(--progress-deg), rgba(139,107,79,0.10) var(--progress-deg) 360deg);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.65), 0 8px 24px rgba(100,70,40,0.10);
}

.wv-progress-ring::before {
  content: "";
  position: absolute;
}

.wv-progress-ring-core {
  width: 106px;
  aspect-ratio: 1;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--surface-1);
  color: var(--text);
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  box-shadow: inset 0 0 0 1px var(--line);
}

.wv-dash-progress-copy {
  min-width: 120px;
}

.wv-dash-progress-value {
  font-family: var(--font-display);
  font-size: 34px;
  line-height: 1;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.wv-dash-progress-label,
.wv-dash-metric-label,
.wv-history-meta,
.wv-history-empty {
  color: var(--text-sub);
  font-size: 12px;
}

.wv-dash-metrics {
  padding: 12px;
  display: grid;
  gap: 10px;
}

.wv-dash-metric {
  min-height: 64px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(139,107,79,0.06);
  border: 1px solid rgba(139,107,79,0.08);
}

.wv-dash-metric-value {
  margin-top: 5px;
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.wv-dash-list {
  padding: 14px;
}

.wv-dash-coach {
  min-height: 120px;
  padding: 16px;
  background:
    linear-gradient(135deg, rgba(212,149,106,0.14), rgba(107,143,113,0.10)),
    rgba(255,255,255,0.72);
}

.wv-dash-coach p {
  margin-top: 10px;
  color: var(--text);
  font-size: 14px;
  line-height: 1.45;
}

.wv-dash-section-title {
  font-size: 11px;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: .07em;
  font-weight: 700;
}

.wv-history-list {
  display: grid;
  gap: 6px;
}

.wv-history-row,
.wv-history-row-btn {
  width: 100%;
}

.wv-history-row {
  display: grid;
  gap: 5px;
  min-height: 52px;
  padding: 10px 11px;
  border-radius: 9px;
  background: rgba(139,107,79,0.06);
  border: 1px solid rgba(139,107,79,0.08);
}

.wv-history-row[data-compact="1"] {
  min-height: 46px;
}

.wv-history-row-btn {
  border: 0;
  padding: 0;
  text-align: left;
  background: transparent;
  font-family: var(--font-ui);
  cursor: pointer;
}

.wv-history-row-btn[data-active="1"] .wv-history-row {
  background: rgba(212,149,106,0.16);
  border-color: rgba(212,149,106,0.28);
}

.wv-history-preview {
  color: var(--text);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wv-history-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.wv-history-empty {
  padding: 18px;
  border-radius: 12px;
  background: rgba(255,255,255,0.62);
  border: 1px solid var(--line);
}

.wv-history-layout {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) minmax(220px, .72fr);
  gap: 14px;
}

.wv-history-detail {
  padding: 16px;
  min-height: 260px;
}

.wv-history-detail p {
  margin-top: 12px;
  color: var(--text);
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.wv-input--small {
  width: 82px;
  min-width: 82px;
}
```

- [ ] **Step 2: Add responsive CSS**

In the existing `@media (max-width: 900px)` block, add:

```css
  .wv-dash-grid,
  .wv-history-layout {
    grid-template-columns: 1fr;
  }
  .wv-dash-progress {
    justify-content: flex-start;
  }
```

In the existing `@media (max-width: 760px)` block, add:

```css
  .wv-main-window .wv-sidebar {
    width: 160px;
    flex-basis: 160px;
  }
  .wv-dash-progress {
    flex-direction: column;
    align-items: flex-start;
  }
```

- [ ] **Step 3: Run build**

Run:

```powershell
npm run build
```

Expected: build passes.

- [ ] **Step 4: Commit Task 9**

Run:

```powershell
git add src/styles.css
git commit -m "style: add dashboard and history layout"
```

---

### Task 10: Verify End-To-End And Polish

**Files:**
- Modify only files required by verification findings.

- [ ] **Step 1: Run full build/check commands**

Run:

```powershell
npm run build
cargo test -p voicenote history::
cargo check -p voicenote
```

Expected: all commands pass.

- [ ] **Step 2: Run the app**

Run:

```powershell
npm run tauri:dev
```

Expected: app launches, tray exists, voicebar still appears for recording, and opening Settings opens the new VoiceNote main window.

- [ ] **Step 3: Verify empty state**

Temporarily move the local history file out of the app data directory or run in a clean profile.

Expected:

- Dashboard shows zero metrics.
- Activity ring shows 0%.
- Last 5 transcriptions area says completed transcriptions will appear there.
- History tab says completed transcriptions will appear after the first recording.

- [ ] **Step 4: Verify populated state with real recording**

Make one real recording from the voicebar.

Expected:

- Recording completes.
- Transcript is pasted as before.
- A record is added to History.
- Dashboard Total Words increases.
- Avg WPM is non-zero.
- Weekly ring progress increases.
- Last 5 transcriptions shows the new transcript.

- [ ] **Step 5: Verify productivity setting**

Open Settings > Productivity and set typing baseline to `60`.

Expected:

- Value saves.
- Dashboard Hours saved recalculates after navigating away and back or reopening the window.

Then enter `9`.

Expected:

- UI rejects it with the inline error.
- Saved baseline remains the previous valid value.

- [ ] **Step 6: Visual pass against approved direction**

Check:

- Dashboard matches Focused Overview layout.
- No fake sample data appears.
- History rows are list/table-like, not card-grid marketing blocks.
- Calm coach copy is factual and restrained.
- Existing settings pages still work.
- Text does not overflow at current window size.

- [ ] **Step 7: Commit verification fixes**

When verification produces a code or style fix, commit it:

```powershell
git add src src-tauri
git commit -m "fix: polish dashboard history flow"
```

When verification requires no fixes, do not create an empty commit.
