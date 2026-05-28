export interface CatalogItem {
  id: string;
  name: string;
}

// Order matches the Models page grid and useModelManager MODEL_IDS.
export const MODEL_CATALOG: CatalogItem[] = [
  { id: "parakeet",                name: "Parakeet V3" },
  { id: "qwen3_asr",               name: "Whisper Pro" },
  { id: "whisper_tiny",            name: "Whisper Nano" },
  { id: "whisper_small",           name: "Whisper Light" },
  { id: "whisper_large",           name: "Whisper Pro+" },
  { id: "whisper_large_v3_turbo",  name: "Whisper MAX" },
];

// Order matches the Style page grid.
export const STYLE_CATALOG: CatalogItem[] = [
  { id: "raw",     name: "Raw transcript" },
  { id: "grammar", name: "Fix grammar" },
  { id: "email",   name: "Email" },
  { id: "prompt",  name: "Prompt engineering" },
  { id: "pro",     name: "Professional + todo" },
  { id: "bullets", name: "Bullet points" },
  { id: "chat",    name: "Slack message" },
  { id: "summary", name: "TL;DR summary" },
];

export function catalogName(items: CatalogItem[], id: string): string {
  return items.find((c) => c.id === id)?.name ?? id;
}
