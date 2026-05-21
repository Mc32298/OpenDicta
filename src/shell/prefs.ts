import { useCallback, useEffect, useState } from "react";

export type Density = "compact" | "regular" | "comfy";
export type SidebarMode = "icons" | "wide";

export interface Prefs {
  accent: string;
  density: Density;
  sidebar: SidebarMode;
  userName: string;
  aiEnabled: boolean;
}

export const PREFS_KEY = "voicenote.prefs.v1";

export const DEFAULT_PREFS: Prefs = {
  accent: "#dbef6a",
  density: "compact",
  sidebar: "icons",
  userName: "Alex",
  aiEnabled: true,
};

export interface ThemePreset {
  id: string;
  name: string;
  sub: string;
  accent: string;
}

export const THEMES: ThemePreset[] = [
  { id: "chartreuse", name: "Chartreuse", sub: "The default — energetic", accent: "#dbef6a" },
  { id: "sand",       name: "Warm sand",  sub: "Soft, document-like",     accent: "#e9c894" },
  { id: "rose",       name: "Dusty rose", sub: "Playful and warm",        accent: "#d8a8b5" },
  { id: "slate",      name: "Cool slate", sub: "Quiet, professional",     accent: "#a8c2db" },
];

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const { density: _ignored, ...rest } = parsed;
    return { ...DEFAULT_PREFS, ...rest };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* quota or private mode — ignore */
  }
}

type PrefsUpdater = <K extends keyof Prefs>(key: K | Partial<Prefs>, value?: Prefs[K]) => void;

export function usePrefs(): [Prefs, PrefsUpdater] {
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);

  const setPrefs: PrefsUpdater = useCallback((key, value) => {
    setPrefsState((prev) => {
      const next: Prefs =
        typeof key === "object" && key !== null
          ? { ...prev, ...key }
          : { ...prev, [key as keyof Prefs]: value as Prefs[keyof Prefs] };
      savePrefs(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFS_KEY) setPrefsState(loadPrefs());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return [prefs, setPrefs];
}
