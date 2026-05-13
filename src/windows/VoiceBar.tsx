import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import Waveform from "../components/Waveform";
import { AlertIcon, CheckIcon, GearIcon, MicIcon, StopIcon, XIcon } from "../ui/icons";
import { IconButton } from "../ui/controls";

type State = "idle" | "recording" | "processing" | "done" | "error" | "cancelled";

export default function VoiceBar() {
  const [state, setState]       = useState<State>("idle");
  const [visible, setVisible]   = useState(false);
  const [statusText, setStatusText] = useState("Ready");
  const [lastError, setLastError] = useState<string | null>(null);
  const [level, setLevel]       = useState(0);
  const [waveColor, setWaveColor] = useState("#3082ff");
  const [shortcut, setShortcut] = useState("F8");
  const [elapsed, setElapsed]   = useState(0);
  const doneHideTimerRef = useRef<number | null>(null);
  const errorHideTimerRef = useRef<number | null>(null);
  const cancelHideTimerRef = useRef<number | null>(null);

  // Timer while recording
  useEffect(() => {
    if (state !== "recording") { setElapsed(0); return; }
    const id = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  useEffect(() => {
    invoke<boolean>("get_voicebar_visible").then(setVisible).catch((e) => console.error("get_voicebar_visible failed", e));
    const syncVisibilityFromBackend = () => {
      invoke<{ recording: boolean }>("get_shortcut_status")
        .then((s) => {
          if (s.recording) {
            setVisible(true);
            setState((prev) => (prev === "idle" ? "recording" : prev));
            setStatusText((prev) => (prev === "Ready" ? "Listening…" : prev));
          }
        })
        .catch((e) => console.error("get_shortcut_status failed", e));
    };
    // Cold-start safeguard: if early events were missed, recover from backend truth.
    syncVisibilityFromBackend();
    const sync1 = window.setTimeout(syncVisibilityFromBackend, 250);
    const sync2 = window.setTimeout(syncVisibilityFromBackend, 900);
    const watchdog = window.setInterval(syncVisibilityFromBackend, 120);

    invoke<{ default_device?: string; devices: string[] }>("get_audio_input_info").catch((e) => console.error("get_audio_input_info failed", e));
    invoke<string>("get_waveform_color").then(setWaveColor).catch((e) => console.error("get_waveform_color failed", e));
    invoke<string>("get_shortcut").then(setShortcut).catch((e) => console.error("get_shortcut failed", e));

    const unlistenStart = listen("recording-started", () => {
      clearHideTimers();
      setVisible(true);
      setState("recording");
      setStatusText("Listening…");
      setLastError(null);
    });

    const unlistenShortcut = listen<{ state?: string }>("shortcut-triggered", (event) => {
      if (event.payload?.state === "pressed") {
        setVisible(true);
      }
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
      if (localStorage.getItem("settings.completionSound") === "true") {
        const ctx = new AudioContext();
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
      doneHideTimerRef.current = window.setTimeout(() => {
        hideAndReset();
      }, 1600);
    });

    const unlistenError = listen<{ message: string }>("transcription-error", (event) => {
      clearHideTimers();
      setState("error");
      setLastError(event.payload.message);
      setStatusText(event.payload.message);
      errorHideTimerRef.current = window.setTimeout(() => {
        hideAndReset();
      }, 2500);
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

    return () => {
      window.clearTimeout(sync1);
      window.clearTimeout(sync2);
      window.clearInterval(watchdog);
      clearHideTimers();
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
    };
  }, []);

  useEffect(() => {
    if (state !== "recording") setLevel(0);
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
      await invoke("set_voicebar_position", { x: pos.x, y: pos.y });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function handleStop() {
    void invoke("stop_recording").catch((e) => console.error("stop_recording failed", e));
  }

  function handleCancel() {
    if (isError || isIdle) {
      hideAndReset();
      return;
    }
    if (state === "cancelled") return;

    void invoke("cancel_recording").catch((e) => console.error("cancel_recording failed", e));
    clearHideTimers();
    setState("cancelled");
    setStatusText("Cancelled");
    setLastError(null);
    setLevel(0);
    cancelHideTimerRef.current = window.setTimeout(() => {
      hideAndReset();
    }, 700);
  }

  async function openSettings() {
    await invoke("open_settings_page_command", { page: "diagnostics" }).catch((e) => {
      console.error("open_settings_page_command failed", e);
    });
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
    <div className={`pill-shell ${visible ? "" : "pill-shell--hidden"}`}>
    <div className={`pill pill--${state}`} onPointerDown={handleDragStart}>
      {/* Mic indicator */}
      <div className="pill-mic">
        <MicIcon className="pill-mic-icon" />
      </div>

      {/* Center body */}
      <div className="pill-body">

        {/* Recording: waveform + timer */}
        {isRecording && (
          <>
            <div className="pill-wave">
              <Waveform active={true} level={level} color={waveColor} />
            </div>
            <div className="pill-timer">{fmt(elapsed)}</div>
          </>
        )}

        {/* Processing */}
        {isProcessing && (
          <div className="pill-status">
            <div className="pill-dots">
              <span /><span /><span />
            </div>
            <span className="pill-status-text pill-status-text--muted">{statusText}</span>
          </div>
        )}

        {/* Done */}
        {isDone && (
          <div className="pill-status">
            <div className="pill-check">
              <CheckIcon />
            </div>
            <span className="pill-status-text pill-status-text--done">{statusText}</span>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="pill-status">
            <div className="pill-alert">
              <AlertIcon />
            </div>
            <span className="pill-status-text pill-status-text--error" title={lastError ?? statusText}>{statusText}</span>
          </div>
        )}

        {/* Cancelled */}
        {isCancelled && (
          <div className="pill-status">
            <div className="pill-cancelled">
              <XIcon />
            </div>
            <span className="pill-status-text pill-status-text--muted">Cancelled</span>
          </div>
        )}

        {/* Idle */}
        {isIdle && (
          <div className="pill-status">
            <div className="pill-hint">
              <kbd>{shortcut}</kbd>
              <span className="pill-hint-text">to record</span>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
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
          <IconButton className="pill-action" variant={isError ? "danger" : "ghost"} onClick={handleCancel} label={isError ? "Dismiss" : "Cancel"}>
            <XIcon />
          </IconButton>
        )}
      </div>
    </div>
    </div>
  );
}
