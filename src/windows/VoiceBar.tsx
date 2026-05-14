import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import Waveform from "../components/Waveform";
import { AlertIcon, CheckIcon, GearIcon, MicIcon, StopIcon, XIcon } from "../ui/icons";
import { IconButton } from "../ui/controls";

type State = "idle" | "recording" | "processing" | "done" | "error" | "cancelled";

export default function VoiceBar() {
  const [state, setState]           = useState<State>("idle");
  const [visible, setVisible]       = useState(false);
  const [statusText, setStatusText] = useState("Ready");
  const [lastError, setLastError]   = useState<string | null>(null);
  const [level, setLevel]           = useState(0);
  const [waveColor, setWaveColor]   = useState("#3082ff");
  const [shortcut, setShortcut]     = useState("RCtrl");
  const [elapsed, setElapsed]       = useState(0);
  const [completionSound, setCompletionSound] = useState(false);
  const [activeProfile, setActiveProfile] = useState<string | null>(null);

  const doneHideTimerRef   = useRef<number | null>(null);
  const errorHideTimerRef  = useRef<number | null>(null);
  const cancelHideTimerRef = useRef<number | null>(null);
  // Single AudioContext reused across transcriptions; closed on unmount.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const completionSoundRef = useRef(false);

  // Recording elapsed timer
  useEffect(() => {
    if (state !== "recording") { setElapsed(0); return; }
    const id = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  // Keep completionSoundRef in sync with state
  useEffect(() => {
    completionSoundRef.current = completionSound;
  }, [completionSound]);

  useEffect(() => {
    // Load initial state from backend
    invoke<boolean>("get_voicebar_visible").then(setVisible).catch(console.error);
    invoke<string>("get_waveform_color").then(setWaveColor).catch(console.error);
    invoke<string>("get_shortcut").then(setShortcut).catch(console.error);
    invoke<boolean>("get_completion_sound").then((val) => {
      setCompletionSound(val);
      completionSoundRef.current = val;
    }).catch(console.error);

    // Cold-start safeguard: if the hotkey was pressed before our event listeners
    // registered, sync state from backend. Run a few one-shot checks then stop —
    // the event-driven listeners handle all transitions after that.
    const syncOnce = () => {
      invoke<{ recording: boolean }>("get_shortcut_status")
        .then((s) => {
          if (s.recording) {
            setVisible(true);
            setState((prev) => (prev === "idle" ? "recording" : prev));
            setStatusText((prev) => (prev === "Ready" ? "Listening…" : prev));
          }
        })
        .catch(console.error);
    };
    syncOnce();
    const t1 = window.setTimeout(syncOnce, 250);
    const t2 = window.setTimeout(syncOnce, 900);

    const unlistenStart = listen("recording-started", () => {
      clearHideTimers();
      setVisible(true);
      setState("recording");
      setStatusText("Listening…");
      setLastError(null);
    });

    const unlistenShortcut = listen<{ state?: string }>("shortcut-triggered", (event) => {
      if (event.payload?.state === "pressed") setVisible(true);
    });

    const unlistenStop = listen("recording-stopped", () => {
      setState("processing");
      setStatusText("Transcribing…");
    });

    const unlistenWorkerStatus = listen<{ message: string }>("sidecar-status", (event) => {
      setState(s => {
        if (s === "processing") setStatusText(event.payload.message);
        return s;
      });
    });

    const unlistenDone = listen<{ text: string }>("transcript-ready", (event) => {
      clearHideTimers();
      setState("done");
      setLastError(null);
      const t = event.payload.text;
      setStatusText(t.slice(0, 64) + (t.length > 64 ? "…" : ""));

      // Play completion sound if enabled (read from ref to avoid stale closure)
      if (completionSoundRef.current) {
        if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
        const ctx = audioCtxRef.current;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
        osc.start();
        osc.stop(ctx.currentTime + 0.12);
      }

      doneHideTimerRef.current = window.setTimeout(hideAndReset, 1600);
    });

    const unlistenError = listen<{ message: string }>("transcription-error", (event) => {
      clearHideTimers();
      setState("error");
      setLastError(event.payload.message);
      setStatusText(event.payload.message);
      errorHideTimerRef.current = window.setTimeout(hideAndReset, 2500);
    });

    const unlistenLevel = listen<number>("recording-level", (event) => {
      setLevel(event.payload);
    });

    const unlistenColor = listen<{ color: string }>("waveform-color-changed", (event) => {
      if (event.payload?.color) setWaveColor(event.payload.color);
    });

    const unlistenShow = listen("voicebar-show", () => {
      clearHideTimers();
      setVisible(true);
    });

    const unlistenHide = listen("voicebar-hide", () => {
      hideAndReset();
    });

    const unlistenProfile = listen<string | null>("active-profile-changed", (event) => {
      setActiveProfile(event.payload ?? null);
    });

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      clearHideTimers();
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      unlistenStart.then(fn => fn());
      unlistenStop.then(fn => fn());
      unlistenDone.then(fn => fn());
      unlistenError.then(fn => fn());
      unlistenLevel.then(fn => fn());
      unlistenColor.then(fn => fn());
      unlistenWorkerStatus.then(fn => fn());
      unlistenShortcut.then(fn => fn());
      unlistenShow.then(fn => fn());
      unlistenHide.then(fn => fn());
      unlistenProfile.then(fn => fn());
    };
  }, []);

  useEffect(() => {
    if (state !== "recording") setLevel(0);
    if (state === "idle" || state === "cancelled") setActiveProfile(null);
  }, [state]);

  async function handleDragStart(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest("button, input, select")) return;
    const win = getCurrentWindow();
    const startOuter = await win.outerPosition();
    const startX = e.screenX;
    const startY = e.screenY;

    const onMove = async (ev: PointerEvent) => {
      const dx = ev.screenX - startX;
      const dy = ev.screenY - startY;
      await win.setPosition(new LogicalPosition(startOuter.x + dx, startOuter.y + dy));
    };

    const onUp = async () => {
      window.removeEventListener("pointermove", onMove);
      const pos = await win.outerPosition();
      // Convert physical pixels → logical pixels before persisting
      const dpr = window.devicePixelRatio || 1;
      await invoke("set_voicebar_position", {
        x: Math.round(pos.x / dpr),
        y: Math.round(pos.y / dpr),
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function handleStop() {
    void invoke("stop_recording").catch(console.error);
  }

  function handleCancel() {
    if (isError || isIdle) { hideAndReset(); return; }
    if (state === "cancelled") return;
    void invoke("cancel_recording").catch(console.error);
    clearHideTimers();
    setState("cancelled");
    setStatusText("Cancelled");
    setLastError(null);
    setLevel(0);
    cancelHideTimerRef.current = window.setTimeout(hideAndReset, 700);
  }

  async function openSettings() {
    await invoke("open_settings_page_command", { page: "diagnostics" }).catch(console.error);
  }

  function hideAndReset() {
    clearHideTimers();
    setState("idle");
    setStatusText("Ready");
    setVisible(false);
    setLevel(0);
    setLastError(null);
    document.documentElement.removeAttribute("data-vb");
  }

  function clearHideTimers() {
    if (doneHideTimerRef.current !== null) {
      window.clearTimeout(doneHideTimerRef.current);
      doneHideTimerRef.current = null;
    }
    if (errorHideTimerRef.current !== null) {
      window.clearTimeout(errorHideTimerRef.current);
      errorHideTimerRef.current = null;
    }
    if (cancelHideTimerRef.current !== null) {
      window.clearTimeout(cancelHideTimerRef.current);
      cancelHideTimerRef.current = null;
    }
  }

  function fmt(s: number) {
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  const isRecording  = state === "recording";
  const isProcessing = state === "processing";
  const isDone       = state === "done";
  const isError      = state === "error";
  const isIdle       = state === "idle";
  const isCancelled  = state === "cancelled";

  return (
    <div className="voicebar-wrapper">
    <div className={`pill-shell ${visible ? "" : "pill-shell--hidden"}`}>
      <div className={`pill pill--${state}`} onPointerDown={handleDragStart}>
        <div className="pill-mic">
          <MicIcon className="pill-mic-icon" />
        </div>

        <div className="pill-body">
          {isRecording && (
            <>
              <div className="pill-wave">
                <Waveform active={true} level={level} color={waveColor} />
              </div>
              <div className="pill-timer">{fmt(elapsed)}</div>
            </>
          )}
          {isProcessing && (
            <div className="pill-status">
              <div className="pill-dots"><span /><span /><span /></div>
              <span className="pill-status-text pill-status-text--muted">{statusText}</span>
            </div>
          )}
          {isDone && (
            <div className="pill-status">
              <div className="pill-check"><CheckIcon /></div>
              <span className="pill-status-text pill-status-text--done">{statusText}</span>
            </div>
          )}
          {isError && (
            <div className="pill-status">
              <div className="pill-alert"><AlertIcon /></div>
              <span className="pill-status-text pill-status-text--error" title={lastError ?? statusText}>
                {statusText}
              </span>
            </div>
          )}
          {isCancelled && (
            <div className="pill-status">
              <div className="pill-cancelled"><XIcon /></div>
              <span className="pill-status-text pill-status-text--muted">Cancelled</span>
            </div>
          )}
          {isIdle && (
            <div className="pill-status">
              <div className="pill-hint">
                <kbd>{shortcut}</kbd>
                <span className="pill-hint-text">to record</span>
              </div>
            </div>
          )}
        </div>

        <div className="pill-actions">
          {isRecording && (
            <IconButton className="pill-action" variant="primary" onClick={handleStop} label="Stop recording">
              <StopIcon />
            </IconButton>
          )}
          {isError && lastError && (
            <IconButton className="pill-action" onClick={() => void openSettings()} label="Open diagnostics">
              <GearIcon />
            </IconButton>
          )}
          {(isRecording || isProcessing || isError || isIdle) && (
            <IconButton
              className="pill-action"
              variant={isError ? "danger" : "ghost"}
              onClick={handleCancel}
              label={isError ? "Dismiss" : "Cancel"}
            >
              <XIcon />
            </IconButton>
          )}
        </div>
      </div>
    </div>
    {activeProfile && state === "recording" && (
      <div className="profile-badge">✦ {activeProfile}</div>
    )}
    </div>
  );
}
