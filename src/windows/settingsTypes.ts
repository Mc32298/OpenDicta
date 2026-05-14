export type Page =
  | "general"
  | "shortcut"
  | "microphone"
  | "model"
  | "ai"
  | "appearance"
  | "diagnostics"
  | "about";
export type { NoticeTone } from "../ui/controls";
export type ShortcutStatus = { shortcut: string; registered: boolean; recording: boolean; };
export type ProviderRuntimeStatus = { requested: string; effective: string; message: string; };
export type HealthStatus = { worker_exists: boolean; model_exists: boolean; };
export type AiPreset = "raw" | "clean" | "professional" | "translate" | "clean_translate";
export type AiProvider = "openai" | "gemini";
export type AiModel =
  | "gpt-5-mini"
  | "gpt-5-nano"
  | "gpt-4.1-mini"
  | "gemini-3-flash-preview"
  | "gemini-2.5-flash";
export type MaskedApiKey = string;
export type AiSettingsPayload = {
  preset: AiPreset;
  provider: AiProvider | null;
  model: AiModel | null;
  target_language: string | null;
  openai_key: MaskedApiKey | null;
  gemini_key: MaskedApiKey | null;
};
