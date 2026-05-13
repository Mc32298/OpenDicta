export type Page = "general" | "shortcut" | "microphone" | "model" | "appearance" | "diagnostics" | "about";
export type { NoticeTone } from "../ui/controls";
export type ShortcutStatus = { shortcut: string; registered: boolean; recording: boolean; };
export type ProviderRuntimeStatus = { requested: string; effective: string; message: string; };
export type HealthStatus = { worker_exists: boolean; model_exists: boolean; };
