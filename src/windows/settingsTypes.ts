export type Page = "general" | "shortcut" | "microphone" | "model" | "ai" | "productivity" | "appearance" | "diagnostics" | "about";
export type { NoticeTone } from "../ui/controls";
export type ShortcutStatus = { shortcut: string; registered: boolean; recording: boolean; };
export type ProviderRuntimeStatus = { requested: string; effective: string; message: string; };
export type HealthStatus = { worker_exists: boolean; model_exists: boolean; };

export interface ProfileInfo {
  id: string;
  name: string;
  hotkey: string | null;
}

export type AiDefaultMode =
  | "raw"
  | "grammar"
  | "email"
  | "prompt"
  | "pro"
  | "bullets"
  | "chat"
  | "summary"
  | "clean"
  | "translate"
  | "clean_translate";

export interface AiSettings {
  default_mode: AiDefaultMode;
  backend: "openai" | "gemini" | "anthropic" | "ollama";
  model: string;
  api_key_masked: string;
  ollama_url: string;
  profile_hotkeys: Record<string, string>;
}

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
