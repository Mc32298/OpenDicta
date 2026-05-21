import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ─── Types ────────────────────────────────────────────────────────────────────

export const MODEL_IDS = [
  "parakeet",
  "qwen3_asr",
  "whisper_small",
  "whisper_large",
  "whisper_large_v3_turbo",
] as const;

export type ModelId = typeof MODEL_IDS[number];

export interface ModelStatus {
  downloaded: boolean;
  downloading: boolean;
  progress: number; // 0–100 overall
}

interface DownloadProgressEvent {
  model_id: string;
  file: string;
  file_index: number;
  file_total: number;
  file_bytes: number;
  file_size: number;
  overall_percent: number;
}

interface ModelManagerValue {
  activeModelId: string;
  statuses: Record<string, ModelStatus>;
  selectModel: (id: string) => Promise<void>;
  downloadModel: (id: string) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  refreshStatus: (id: string) => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

export const ModelManagerContext = createContext<ModelManagerValue | null>(null);

export function useModelManager(): ModelManagerValue {
  const ctx = useContext(ModelManagerContext);
  if (!ctx) throw new Error("useModelManager must be used inside ModelManagerProvider");
  return ctx;
}

// ─── Provider logic (returned as a plain object; rendered by AppShell) ────────

function defaultStatus(): ModelStatus {
  return { downloaded: false, downloading: false, progress: 0 };
}

export function useModelManagerState(): ModelManagerValue {
  const [activeModelId, setActiveModelId] = useState<string>("parakeet");
  const [statuses, setStatuses] = useState<Record<string, ModelStatus>>(() =>
    Object.fromEntries(MODEL_IDS.map((id) => [id, defaultStatus()]))
  );

  // Stable ref so event listeners can read current downloading state without
  // stale closures.
  const statusesRef = useRef(statuses);
  useEffect(() => { statusesRef.current = statuses; }, [statuses]);

  const patchStatus = useCallback(
    (id: string, patch: Partial<ModelStatus>) =>
      setStatuses((prev) => ({
        ...prev,
        [id]: { ...prev[id], ...patch },
      })),
    []
  );

  // ── Backend polling helpers ──────────────────────────────────────────────

  const refreshStatus = useCallback(async (id: string) => {
    try {
      const result = await invoke<{ all_present: boolean }>("get_model_status", {
        modelId: id,
      });
      patchStatus(id, { downloaded: result.all_present, downloading: false, progress: result.all_present ? 100 : 0 });
    } catch {
      // Silently ignore — model dir may not exist yet
    }
  }, [patchStatus]);

  // ── Mount: load active model + all statuses ──────────────────────────────

  useEffect(() => {
    invoke<string>("get_active_model_id")
      .then(setActiveModelId)
      .catch(console.error);

    for (const id of MODEL_IDS) {
      refreshStatus(id);
    }
  }, [refreshStatus]);

  // ── Download-progress event listener ────────────────────────────────────

  useEffect(() => {
    const unlistenProgress = listen<DownloadProgressEvent>("model-download-progress", (event) => {
      const { model_id, overall_percent } = event.payload;
      patchStatus(model_id, { downloading: true, progress: overall_percent });
    });

    const unlistenComplete = listen<void>("model-download-complete", () => {
      for (const id of MODEL_IDS) {
        void refreshStatus(id);
      }
    });

    const unlistenActiveModel = listen<string>("active-model-changed", (event) => {
      setActiveModelId(event.payload);
    });

    return () => {
      void unlistenProgress.then((fn) => fn());
      void unlistenComplete.then((fn) => fn());
      void unlistenActiveModel.then((fn) => fn());
    };
  }, [patchStatus, refreshStatus]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const selectModel = useCallback(async (id: string) => {
    if (!statusesRef.current[id]?.downloaded) return;
    await invoke("set_active_model_id", { modelId: id });
    setActiveModelId(id);
  }, []);

  const downloadModel = useCallback(async (id: string) => {
    if (statusesRef.current[id]?.downloading) return;
    patchStatus(id, { downloading: true, progress: 0 });
    try {
      await invoke("download_model", { modelId: id });
    } catch (err) {
      console.error("Download failed:", err);
      patchStatus(id, { downloading: false });
    }
    await refreshStatus(id);
  }, [patchStatus, refreshStatus]);

  const deleteModel = useCallback(async (id: string) => {
    await invoke("delete_model", { modelId: id });
    patchStatus(id, { downloaded: false, downloading: false, progress: 0 });
  }, [patchStatus]);

  return { activeModelId, statuses, selectModel, downloadModel, deleteModel, refreshStatus };
}
