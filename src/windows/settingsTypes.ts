export type Page = "general" | "shortcut" | "microphone" | "model" | "appearance" | "ai" | "diagnostics" | "about";
export type { NoticeTone } from "../ui/controls";
export type ShortcutStatus = { shortcut: string; registered: boolean; recording: boolean; };
export type ProviderRuntimeStatus = { requested: string; effective: string; message: string; };
export type HealthStatus = { worker_exists: boolean; model_exists: boolean; };

export interface ProfileInfo {
  id: string;
  name: string;
  hotkey: string | null;
}

export type AiDefaultMode = "raw" | "clean" | "translate" | "clean_translate";

export interface AiSettings {
  default_mode: AiDefaultMode;
  backend: "openai" | "anthropic" | "ollama";
  model: string;
  api_key_masked: string;
  ollama_url: string;
  profile_hotkeys: Record<string, string>;
}
