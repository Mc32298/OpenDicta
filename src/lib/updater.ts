export type UpdatePhase =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export type UpdateState = {
  phase: UpdatePhase;
  message: string;
  availableVersion: string | null;
  notes: string | null;
  downloadedBytes: number;
  contentLength: number | null;
  needsRestart: boolean;
  lastCheckedAt: number | null;
};

type UpdateAction =
  | { type: "checking"; manual: boolean }
  | { type: "checked"; version: string | null; body: string | null }
  | { type: "no-update" }
  | { type: "download-started"; contentLength: number | null }
  | { type: "download-progress"; chunkLength: number }
  | { type: "installed" }
  | { type: "error"; message: string }
  | { type: "reset" };

type UpdateHandle = {
  version: string;
  body?: string;
  downloadAndInstall: (onEvent?: (event: any) => void) => Promise<void>;
  close?: () => Promise<void>;
};

const UPDATE_STATE_KEY = "opendicta.update.state.v1";
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
let channel: BroadcastChannel | null = null;
let inflightCheck: Promise<UpdateState> | null = null;

function ensureChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) channel = new BroadcastChannel("opendicta-updater");
  return channel;
}

export function createInitialUpdateState(): UpdateState {
  return {
    phase: "idle",
    message: "Automatic update checks are enabled.",
    availableVersion: null,
    notes: null,
    downloadedBytes: 0,
    contentLength: null,
    needsRestart: false,
    lastCheckedAt: null,
  };
}

export function nextUpdateState(state: UpdateState, action: UpdateAction): UpdateState {
  switch (action.type) {
    case "checking":
      return {
        ...state,
        phase: "checking",
        downloadedBytes: 0,
        contentLength: null,
        needsRestart: false,
        message: action.manual ? "Checking for updates..." : "Checking for updates in the background...",
      };
    case "checked":
      return {
        ...state,
        phase: "available",
        availableVersion: action.version,
        notes: action.body,
        downloadedBytes: 0,
        contentLength: null,
        needsRestart: false,
        lastCheckedAt: Date.now(),
        message: `OpenDicta ${action.version} is available to download.`,
      };
    case "no-update":
      return {
        ...state,
        phase: "upToDate",
        availableVersion: null,
        notes: null,
        downloadedBytes: 0,
        contentLength: null,
        needsRestart: false,
        lastCheckedAt: Date.now(),
        message: "You're on the latest version of OpenDicta.",
      };
    case "download-started":
      return {
        ...state,
        phase: "downloading",
        downloadedBytes: 0,
        contentLength: action.contentLength,
        needsRestart: false,
        message: "Downloading update...",
      };
    case "download-progress":
      return {
        ...state,
        phase: "downloading",
        downloadedBytes: state.downloadedBytes + action.chunkLength,
        message: "Downloading update...",
      };
    case "installed":
      return {
        ...state,
        phase: "ready",
        downloadedBytes: state.contentLength ?? state.downloadedBytes,
        needsRestart: true,
        lastCheckedAt: Date.now(),
        message: "Update installed. Restart OpenDicta to finish applying it.",
      };
    case "error":
      return {
        ...state,
        phase: "error",
        needsRestart: false,
        message: action.message,
      };
    case "reset":
      return createInitialUpdateState();
    default:
      return state;
  }
}

export function shouldAutoCheck(lastCheckedAt: number | null, now = Date.now()): boolean {
  if (!lastCheckedAt) return true;
  return now - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS;
}

export function readStoredUpdateState(): UpdateState {
  if (typeof localStorage === "undefined") return createInitialUpdateState();
  try {
    const raw = localStorage.getItem(UPDATE_STATE_KEY);
    if (!raw) return createInitialUpdateState();
    const parsed = JSON.parse(raw) as Partial<UpdateState>;
    return { ...createInitialUpdateState(), ...parsed };
  } catch {
    return createInitialUpdateState();
  }
}

function persistUpdateState(state: UpdateState): UpdateState {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(UPDATE_STATE_KEY, JSON.stringify(state));
  }
  ensureChannel()?.postMessage(state);
  return state;
}

function setState(action: UpdateAction): UpdateState {
  const next = nextUpdateState(readStoredUpdateState(), action);
  return persistUpdateState(next);
}

export function subscribeToUpdateState(cb: (state: UpdateState) => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== UPDATE_STATE_KEY) return;
    cb(readStoredUpdateState());
  };
  const bc = ensureChannel();
  const onMessage = (event: MessageEvent<UpdateState>) => cb(event.data);
  window.addEventListener("storage", onStorage);
  bc?.addEventListener("message", onMessage);
  return () => {
    window.removeEventListener("storage", onStorage);
    bc?.removeEventListener("message", onMessage);
  };
}

function downloadPercent(state: UpdateState): string | null {
  if (!state.contentLength || state.downloadedBytes <= 0) return null;
  return `${Math.round((state.downloadedBytes / state.contentLength) * 100)}%`;
}

export function getUpdateActionLabel(state: UpdateState): string {
  switch (state.phase) {
    case "checking":
      return "Checking...";
    case "available":
      return "Download update";
    case "downloading":
      return downloadPercent(state) ? `Downloading ${downloadPercent(state)}` : "Downloading...";
    case "ready":
      return "Restart to update";
    default:
      return "Check for updates";
  }
}

export function isUpdateActionDisabled(state: UpdateState): boolean {
  return state.phase === "checking" || state.phase === "downloading";
}

async function importUpdaterApi() {
  return import("@tauri-apps/plugin-updater");
}

async function importDialogApi() {
  return import("@tauri-apps/plugin-dialog");
}

async function importProcessApi() {
  return import("@tauri-apps/plugin-process");
}

async function fetchUpdate(): Promise<UpdateHandle | null> {
  const { check } = await importUpdaterApi();
  return (await check({ timeout: 30_000 })) as UpdateHandle | null;
}

function normalizeUpdaterError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (text.toLowerCase().includes("pubkey") || text.toLowerCase().includes("signature")) {
    return "Updater is not configured yet. Add the Tauri updater public key before shipping signed releases.";
  }
  return `Update check failed: ${text}`;
}

async function maybePromptToInstall(update: UpdateHandle): Promise<boolean> {
  const { ask } = await importDialogApi();
  return ask(`OpenDicta ${update.version} is available. Download and install it now?`, {
    title: "OpenDicta Update Available",
    kind: "info",
  });
}

async function promptForRestart(): Promise<boolean> {
  const { ask } = await importDialogApi();
  return ask("OpenDicta finished installing the update. Restart now to apply it?", {
    title: "Restart OpenDicta",
    kind: "info",
  });
}

export async function restartToApplyUpdate(): Promise<void> {
  const { relaunch } = await importProcessApi();
  await relaunch();
}

export async function installAvailableUpdate(existing?: UpdateHandle | null): Promise<UpdateState> {
  const update = existing ?? (await fetchUpdate());
  if (!update) return setState({ type: "no-update" });

  try {
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          setState({
            type: "download-started",
            contentLength: event.data?.contentLength ?? null,
          });
          break;
        case "Progress":
          setState({
            type: "download-progress",
            chunkLength: event.data?.chunkLength ?? 0,
          });
          break;
        default:
          break;
      }
    });
    const next = setState({ type: "installed" });
    if (await promptForRestart()) {
      await restartToApplyUpdate();
    }
    return next;
  } finally {
    await update.close?.().catch(() => undefined);
  }
}

export async function checkForAppUpdate(options?: {
  manual?: boolean;
  promptIfAvailable?: boolean;
}): Promise<UpdateState> {
  if (inflightCheck) return inflightCheck;
  const manual = options?.manual ?? false;
  const promptIfAvailable = options?.promptIfAvailable ?? false;

  inflightCheck = (async () => {
    setState({ type: "checking", manual });
    try {
      const update = await fetchUpdate();
      if (!update) {
        return setState({ type: "no-update" });
      }

      const availableState = setState({
        type: "checked",
        version: update.version,
        body: update.body ?? null,
      });

      if (promptIfAvailable && (await maybePromptToInstall(update))) {
        return await installAvailableUpdate(update);
      }

      await update.close?.().catch(() => undefined);
      return availableState;
    } catch (error) {
      return setState({ type: "error", message: normalizeUpdaterError(error) });
    } finally {
      inflightCheck = null;
    }
  })();

  return inflightCheck;
}

export async function maybeAutoCheckForUpdates(): Promise<UpdateState | null> {
  const state = readStoredUpdateState();
  if (!shouldAutoCheck(state.lastCheckedAt)) return null;
  return checkForAppUpdate({ manual: false, promptIfAvailable: true });
}
