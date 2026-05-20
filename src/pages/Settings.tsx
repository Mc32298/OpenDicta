import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import PageHead from "./PageHead";
import { normalizeShortcutFromEvent } from "../lib/shortcutUtils";
import { THEMES, usePrefs } from "../shell/prefs";
import type { Prefs } from "../shell/prefs";
import {
  CheckIcon, DiagnosticIcon, PowerIcon, DashboardIcon, ModelsIcon,
  WaveIcon, MicIcon, SparkleIcon,
} from "../ui/icons";

type AudioInputInfo = {
  default_device: string | null;
  devices: string[];
  selected_device: string | null;
};

type ShortcutBindings = {
  record: string;
  push_to_talk: string | null;
  stop_and_discard: string | null;
  refine_with_ai: string | null;
};

type HealthStatus = {
  worker_exists: boolean;
  model_exists: boolean;
};

type MicrophoneTestResult = {
  ok: boolean;
  message: string;
};

type UpdateCheckResult = {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_url: string;
  message: string;
};

export default function Settings({ prefs, setPrefs }: { prefs: Prefs; setPrefs: ReturnType<typeof usePrefs>[1] }) {
  const [s, setS] = useState({ menubar: true, autoUpdate: true });
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS((prev) => ({ ...prev, [k]: v }));
  const [micDevices, setMicDevices] = useState<string[]>([]);
  const [selectedMic, setSelectedMic] = useState<string>("");
  const [inputLevel, setInputLevel] = useState(0);
  const [micMeterEnabled, setMicMeterEnabled] = useState(false);
  const [soundsEnabled, setSoundsEnabled] = useState(false);
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({
    record: "ControlRight",
    pushToTalk: "Hold Fn",
    stop: "Esc",
    refine: "Ctrl+Shift+R",
  });
  const [editingShortcut, setEditingShortcut] = useState<keyof typeof shortcuts | null>(null);
  const [capturePreview, setCapturePreview] = useState<string | null>(null);
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [diagnosticMessage, setDiagnosticMessage] = useState<string>("");
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string>("Up to date. Latest models synced 2 hours ago.");
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    getVersion().then(setAppVersion).catch(console.error);
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<AudioInputInfo>("get_audio_input_info")
      .then((info) => {
        if (cancelled) return;
        setMicDevices(info.devices);
        const selected = info.selected_device ?? info.default_device ?? info.devices[0] ?? "";
        setSelectedMic(selected);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    invoke<boolean>("get_completion_sound")
      .then(setSoundsEnabled)
      .catch(console.error);
  }, []);

  useEffect(() => {
    invoke<boolean>("get_autostart_enabled")
      .then(setAutostartEnabled)
      .catch(console.error);
  }, []);

  useEffect(() => {
    invoke<ShortcutBindings>("get_shortcut_bindings")
      .then((bindings) => {
        setShortcuts((prev) => ({
          ...prev,
          record: bindings.record,
          pushToTalk: bindings.push_to_talk ?? prev.pushToTalk,
          stop: bindings.stop_and_discard ?? prev.stop,
          refine: bindings.refine_with_ai ?? prev.refine,
        }));
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedMic) return;
    invoke("set_audio_input_device", { deviceName: selectedMic }).catch(console.error);
  }, [selectedMic]);

  async function runDiagnostics() {
    if (diagnosticBusy) return;
    setDiagnosticBusy(true);
    setDiagnosticMessage("Running diagnostics...");
    try {
      const [health, mic] = await Promise.all([
        invoke<HealthStatus>("run_health_check"),
        invoke<MicrophoneTestResult>("test_microphone"),
      ]);
      const worker = health.worker_exists ? "Worker: OK" : "Worker: Missing";
      const model = health.model_exists ? "Model: OK" : "Model: Missing";
      const micStatus = mic.ok ? `Mic: OK (${mic.message})` : `Mic: Failed (${mic.message})`;
      setDiagnosticMessage(`${worker} · ${model} · ${micStatus}`);
    } catch (err) {
      setDiagnosticMessage(`Diagnostics failed: ${String(err)}`);
    } finally {
      setDiagnosticBusy(false);
    }
  }

  async function runUpdateCheck() {
    if (updateBusy) return;
    setUpdateBusy(true);
    setUpdateMessage("Checking for updates...");
    try {
      const result = await invoke<UpdateCheckResult>("check_for_updates");
      setUpdateMessage(result.message);
    } catch (err) {
      setUpdateMessage(`Update check failed: ${String(err)}`);
    } finally {
      setUpdateBusy(false);
    }
  }

  useEffect(() => {
    invoke("set_shortcut_capture_mode", { enabled: Boolean(editingShortcut) }).catch(console.error);
    if (!editingShortcut) return;
    let activeKeys = new Set<string>();
    let lastCaptured: string | null = null;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      activeKeys.add(e.code || e.key);
      const normalized = normalizeShortcutFromEvent(e);
      if (!normalized) return;
      lastCaptured = normalized;
      setCapturePreview(normalized);
    };

    const onKeyUp = async (e: KeyboardEvent) => {
      e.preventDefault();
      activeKeys.delete(e.code || e.key);
      if (activeKeys.size !== 0 || !lastCaptured) return;

      const captured = lastCaptured;
      setCapturePreview(null);
      setEditingShortcut(null);
      setShortcuts((prev) => ({ ...prev, [editingShortcut]: captured }));

      if (editingShortcut === "record") {
        try {
          await invoke("set_shortcut", { shortcut: captured });
        } catch (err) {
          console.error(err);
          const saved = await invoke<string>("get_shortcut").catch(() => "");
          if (saved) setShortcuts((prev) => ({ ...prev, record: saved }));
        }
        return;
      }

      const actionMap: Record<Exclude<keyof typeof shortcuts, "record">, "push_to_talk" | "stop_and_discard" | "refine_with_ai"> = {
        pushToTalk: "push_to_talk",
        stop: "stop_and_discard",
        refine: "refine_with_ai",
      };
      const action = actionMap[editingShortcut as Exclude<keyof typeof shortcuts, "record">];
      if (!action) return;
      try {
        await invoke("set_shortcut_binding", { action, shortcut: captured });
      } catch (err) {
        console.error(err);
        const bindings = await invoke<ShortcutBindings>("get_shortcut_bindings").catch(() => null);
        if (!bindings) return;
        setShortcuts((prev) => ({
          ...prev,
          record: bindings.record,
          pushToTalk: bindings.push_to_talk ?? prev.pushToTalk,
          stop: bindings.stop_and_discard ?? prev.stop,
          refine: bindings.refine_with_ai ?? prev.refine,
        }));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [editingShortcut]);

  useEffect(() => {
    if (!micMeterEnabled) {
      setInputLevel(0);
      return;
    }
    let cancelled = false;
    let rafId: number | null = null;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;

    const startMeter = async () => {
      if (!navigator.mediaDevices?.getUserMedia) return;
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = list.filter((d) => d.kind === "audioinput");
        const match = audioInputs.find((d) => d.label === selectedMic);
        const constraints = match
          ? { audio: { deviceId: { exact: match.deviceId } } }
          : { audio: true };

        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        context = new AudioContext();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.82;
        source.connect(analyser);

        const buf = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(buf);
          let sumSq = 0;
          for (let i = 0; i < buf.length; i += 1) {
            sumSq += buf[i] * buf[i];
          }
          const rms = Math.sqrt(sumSq / buf.length);
          const level = Math.min(1, rms * 8);
          setInputLevel((prev) => prev + (level - prev) * 0.28);
          rafId = window.requestAnimationFrame(tick);
        };
        rafId = window.requestAnimationFrame(tick);
      } catch (e) {
        console.error(e);
      }
    };

    void startMeter();

    return () => {
      cancelled = true;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (context) void context.close();
    };
  }, [selectedMic, micMeterEnabled]);

  return (
    <div className="page">
      <PageHead
        eyebrow="Settings"
        title={<>General <em>preferences</em>.</>}
        sub="The fiddly bits. Hardware, shortcuts, and how OpenDicta behaves on launch."
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <button className="btn btn-sm" onClick={() => void runDiagnostics()} disabled={diagnosticBusy}>
            <DiagnosticIcon style={{ width: 14, height: 14 }} /> {diagnosticBusy ? "Running..." : "Run diagnostic"}
          </button>
          {diagnosticMessage && (
            <div style={{ fontSize: 11.5, color: "var(--ink-3)", maxWidth: 460, textAlign: "right" }}>
              {diagnosticMessage}
            </div>
          )}
        </div>
      </PageHead>

      {/* ── Appearance / Themes ─────────────────────────────── */}
      <div className="card card-lg" style={{ marginBottom: "var(--gap)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div className="section-title" style={{ margin: 0 }}>Appearance</div>
            <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 4 }}>Theme applies everywhere instantly and remembers across launches.</div>
          </div>
          <div className="chip"><span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--accent)" }} /> Current theme</div>
        </div>

        <div className="grid grid-4" style={{ gap: 14 }}>
          {THEMES.map((theme) => {
            const on = prefs.accent.toLowerCase() === theme.accent.toLowerCase();
            return (
              <button
                key={theme.id}
                onClick={() => setPrefs("accent", theme.accent)}
                className="card"
                style={{
                  textAlign: "left", cursor: "pointer", font: "inherit",
                  border: on ? "1.5px solid var(--ink-1)" : "0.5px solid var(--line)",
                  background: "var(--bg-card)",
                  padding: 14, gap: 10,
                  display: "flex", flexDirection: "column",
                  transition: "transform .12s, border-color .12s",
                  position: "relative",
                  boxShadow: on
                    ? "0 1px 2px rgba(0,0,0,0.05), 0 10px 24px -14px rgba(0,0,0,0.18)"
                    : "var(--shadow-card)",
                }}
              >
                <ThemeSwatch accent={theme.accent} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-1)" }}>{theme.name}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{theme.sub}</div>
                </div>
                {on && (
                  <div style={{ position: "absolute", top: 10, right: 10, width: 22, height: 22, borderRadius: "50%", background: "var(--ink-1)", color: "oklch(98% 0.005 85)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <CheckIcon style={{ width: 13, height: 13 }} />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="divider" style={{ margin: "20px 0 16px" }} />

        <div className="row" style={{ gap: 18 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--ink-2)", marginBottom: 8 }}>Sidebar style</div>
            <div className="seg-row">
              {[
                { v: "icons", label: "Icons only" },
                { v: "wide",  label: "Icons + labels" },
              ].map((opt) => (
                <button key={opt.v} onClick={() => setPrefs("sidebar", opt.v as Prefs["sidebar"])}
                  className={"seg " + (prefs.sidebar === opt.v ? "seg-on" : "")}>{opt.label}</button>
              ))}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--ink-2)", marginBottom: 8 }}>Layout density</div>
            <div className="seg-row">
              {[
                { v: "compact", label: "Compact" },
                { v: "regular", label: "Regular" },
                { v: "comfy",   label: "Comfy" },
              ].map((opt) => (
                <button key={opt.v} onClick={() => setPrefs("density", opt.v as Prefs["density"])}
                  className={"seg " + (prefs.density === opt.v ? "seg-on" : "")}>{opt.label}</button>
              ))}
            </div>
          </div>
          <div style={{ flex: 1.2 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--ink-2)", marginBottom: 8 }}>Display name</div>
            <input
              className="input"
              value={prefs.userName}
              onChange={(e) => setPrefs("userName", e.target.value)}
              style={{ height: 36 }}
              placeholder="Your name"
            />
          </div>
        </div>
      </div>

      <div className="row" style={{ alignItems: "stretch" }}>
        <div className="col" style={{ flex: 1.4 }}>

          <div className="card card-lg">
            <div className="section-title">Startup</div>
            <Setting label="Open at login" desc="Launch OpenDicta when you sign in." icon={<PowerIcon style={{ width: 18, height: 18 }} />}>
              <div
                className="toggle"
                data-on={autostartEnabled}
                onClick={() => {
                  const next = !autostartEnabled;
                  setAutostartEnabled(next);
                  invoke("set_autostart_enabled", { enabled: next }).catch((err) => {
                    console.error(err);
                    setAutostartEnabled(!next);
                  });
                }}
              />
            </Setting>
            <Divider />
            <Setting label="Stay in menu bar" desc="Quick access without keeping a window open." icon={<DashboardIcon style={{ width: 18, height: 18 }} />}>
              <div className="toggle" data-on={s.menubar} onClick={() => set("menubar", !s.menubar)} />
            </Setting>
            <Divider />
            <Setting label="Auto-update models" desc="Pull new model versions when available." icon={<ModelsIcon style={{ width: 18, height: 18 }} />}>
              <div className="toggle" data-on={s.autoUpdate} onClick={() => set("autoUpdate", !s.autoUpdate)} />
            </Setting>
            <Divider />
            <Setting label="Sounds" desc="Subtle start / stop chimes when recording." icon={<WaveIcon style={{ width: 18, height: 18 }} />}>
              <div
                className="toggle"
                data-on={soundsEnabled}
                onClick={() => {
                  const next = !soundsEnabled;
                  setSoundsEnabled(next);
                  invoke("set_completion_sound", { enabled: next }).catch(console.error);
                }}
              />
            </Setting>
          </div>

          <div className="card card-lg">
            <div className="section-title">Hardware</div>
            <Setting label="Microphone" desc="Currently routing through your selected input." icon={<MicIcon style={{ width: 18, height: 18 }} />}>
              <select className="input" style={{ minWidth: 220, height: 36 }} value={selectedMic} onChange={(e) => setSelectedMic(e.target.value)}>
                {micDevices.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </Setting>
            <Divider />
            <div style={{ padding: "14px 0 4px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-3)" }}>Input level</div>
                <button
                  className="btn btn-sm"
                  type="button"
                  onClick={() => setMicMeterEnabled((prev) => !prev)}
                >
                  {micMeterEnabled ? "Disable meter" : "Enable microphone meter"}
                </button>
              </div>
              <MicLevel level={inputLevel} />
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 6 }}>
                {micMeterEnabled
                  ? "Speak normally. Aim for the green zone."
                  : "Enable the meter to preview microphone input."}
              </div>
            </div>
          </div>

        </div>

        <div className="col" style={{ flex: 1 }}>
          <div className="card card-lg">
            <div className="section-title">Shortcuts</div>
            <Shortcut label="Record toggle" value={captureValue(editingShortcut === "record", capturePreview, shortcuts.record)} editing={editingShortcut === "record"} onEdit={() => beginCapture("record", setEditingShortcut, setCapturePreview)} />
            <Divider />
            <Shortcut label="Push-to-talk" value={captureValue(editingShortcut === "pushToTalk", capturePreview, shortcuts.pushToTalk)} editing={editingShortcut === "pushToTalk"} onEdit={() => beginCapture("pushToTalk", setEditingShortcut, setCapturePreview)} />
            <Divider />
            <Shortcut label="Stop and discard" value={captureValue(editingShortcut === "stop", capturePreview, shortcuts.stop)} editing={editingShortcut === "stop"} onEdit={() => beginCapture("stop", setEditingShortcut, setCapturePreview)} />
            <Divider />
            <Shortcut label="Refine with AI" value={captureValue(editingShortcut === "refine", capturePreview, shortcuts.refine)} editing={editingShortcut === "refine"} onEdit={() => beginCapture("refine", setEditingShortcut, setCapturePreview)} />
          </div>

          <div className="card" style={{ background: "var(--ink-1)", color: "oklch(95% 0.005 85)", borderColor: "transparent" }}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ width: 36, height: 36, borderRadius: 11, background: "var(--accent)", color: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <SparkleIcon style={{ width: 18, height: 18 }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>OpenDicta {appVersion}</div>
                <div style={{ fontSize: 12, color: "oklch(75% 0.008 85)", marginTop: 4, lineHeight: 1.5 }}>
                  {updateMessage}
                </div>
                <button
                  className="btn btn-sm btn-ghost"
                  style={{ marginTop: 10, color: "oklch(95% 0.005 85)" }}
                  onClick={() => void runUpdateCheck()}
                  disabled={updateBusy}
                >
                  {updateBusy ? "Checking..." : "Check for updates →"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Setting({ label, desc, icon, children }: { label: string; desc?: string; icon: ReactNode; children?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0" }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--bg-sunken)", color: "var(--ink-2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink-1)" }}>{label}</div>
        {desc && <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function Divider() { return <div className="divider" style={{ margin: "2px 0" }} />; }

function Shortcut({ label, value, editing, onEdit }: { label: string; value: string; editing?: boolean; onEdit?: () => void }) {
  const keys = formatShortcutForDisplay(value);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 0", gap: 14 }}>
      <div style={{ fontSize: 13.5, color: "var(--ink-1)", fontWeight: 500 }}>{label}</div>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        {keys.map((k, i) => (
          <kbd key={i} style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            minWidth: 28, height: 28, padding: "0 7px",
            background: "var(--bg-card)", border: "0.5px solid var(--line-2)",
            borderRadius: 7, fontFamily: "Geist, sans-serif", fontSize: 12, fontWeight: 500,
            color: "var(--ink-1)",
            boxShadow: "0 1px 0 var(--line)",
          }}>{k}</kbd>
        ))}
        <button className="btn btn-sm btn-ghost" style={{ height: 28, padding: "0 8px", fontSize: 11.5 }} onClick={onEdit}>
          {editing ? "Press keys..." : "Edit"}
        </button>
      </div>
    </div>
  );
}

function beginCapture(
  key: "record" | "pushToTalk" | "stop" | "refine",
  setEditingShortcut: (v: "record" | "pushToTalk" | "stop" | "refine" | null) => void,
  setCapturePreview: (v: string | null) => void,
) {
  setCapturePreview(null);
  setEditingShortcut(key);
}

function captureValue(editing: boolean, preview: string | null, fallback: string) {
  if (editing && preview) return preview;
  return fallback;
}

function formatShortcutForDisplay(value: string): string[] {
  if (!value) return ["—"];
  if (value.includes("+")) return value.split("+");
  if (value.includes(" ")) return value.split(" ");
  return [value];
}

function MicLevel({ level }: { level: number }) {
  const bars = 28;
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center", height: 24 }}>
      {Array.from({ length: bars }).map((_, i) => {
        const active = (i / bars) < level;
        const color = i < bars * 0.55 ? "oklch(64% 0.16 145)" : i < bars * 0.82 ? "var(--accent)" : "oklch(70% 0.18 30)";
        return <div key={i} style={{
          flex: 1, height: 4 + (i / bars) * 18,
          background: active ? color : "var(--bg-sunken)",
          borderRadius: 2,
          transition: "background .12s",
        }} />;
      })}
    </div>
  );
}

function ThemeSwatch({ accent }: { accent: string }) {
  return (
    <div style={{
      height: 74, borderRadius: 12, overflow: "hidden",
      background: "oklch(95% 0.018 145)",
      border: "0.5px solid var(--line)",
      display: "flex",
      position: "relative",
    }}>
      <div style={{ width: 14, background: "oklch(18% 0.005 60)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", paddingTop: 4, gap: 3 }}>
        <div style={{ width: 8, height: 8, borderRadius: 2, background: accent }} />
        <div style={{ width: 6, height: 2, borderRadius: 1, background: "oklch(60% 0.01 85)", marginTop: 2 }} />
        <div style={{ width: 6, height: 2, borderRadius: 1, background: "oklch(60% 0.01 85)" }} />
        <div style={{ width: 6, height: 2, borderRadius: 1, background: "oklch(60% 0.01 85)" }} />
      </div>
      <div style={{ flex: 1, padding: 6, display: "flex", flexDirection: "column", gap: 4, background: "oklch(97.5% 0.004 85)" }}>
        <div style={{ height: 4, width: "60%", borderRadius: 2, background: "oklch(35% 0.008 75)" }} />
        <div style={{ height: 2, width: "40%", borderRadius: 2, background: "oklch(72% 0.008 75)" }} />
        <div style={{ display: "flex", gap: 4, marginTop: "auto" }}>
          <div style={{ flex: 1, height: 18, borderRadius: 4, background: accent, border: `0.5px solid color-mix(in oklch, ${accent} 70%, black)` }} />
          <div style={{ flex: 1, height: 18, borderRadius: 4, background: "#fff", border: "0.5px solid var(--line)" }} />
          <div style={{ flex: 0.5, height: 18, borderRadius: 4, background: "oklch(18% 0.005 60)" }} />
        </div>
      </div>
    </div>
  );
}
