import { useState } from "react";
import PageHead from "./PageHead";
import { CheckIcon } from "../ui/icons";
import { useModelManager } from "../hooks/useModelManager";

const MODELS = [
  {
    id: "parakeet",
    name: "Parakeet V3",
    tag: "Lightning-fast streaming",
    desc: "Real-time transcription with sub-200ms latency. Best for live dictation, voice commands, and quick memos where speed matters most.",
    perf: 96, qual: 72,
    size: "670 MB",
    badge: "Default",
  },
  {
    id: "qwen3_asr",
    name: "Whisper Pro",
    tag: "Balanced accuracy",
    desc: "The all-rounder. Handles accents, technical jargon, and noisy rooms well. Use this when you don't know what you'll be recording.",
    perf: 72, qual: 86,
    size: "982 MB",
    badge: "Recommended",
  },
  {
    id: "whisper_small",
    name: "Whisper Light",
    tag: "Compact & efficient",
    desc: "Fast and lean. Great for everyday dictation on lower-powered hardware. Slightly less robust with heavy accents or background noise.",
    perf: 85, qual: 76,
    size: "374 MB",
  },
  {
    id: "whisper_large",
    name: "Whisper Pro+",
    tag: "High accuracy",
    desc: "The full-size Whisper model. Excellent with accents, mixed languages, and dense technical content. Slower on CPU — best with a GPU.",
    perf: 48, qual: 94,
    size: "1.8 GB",
  },
  {
    id: "whisper_large_v3_turbo",
    name: "Whisper MAX",
    tag: "Maximum accuracy, distilled",
    desc: "Frontier-grade quality at roughly half the compute of large. Best for interviews, podcasts, and court-quality transcripts.",
    perf: 60, qual: 98,
    size: "1.0 GB",
    badge: "Pro",
  },
];

export default function Models() {
  const { activeModelId, statuses, selectModel, downloadModel, deleteModel } = useModelManager();
  const [hovered, setHovered] = useState<string | null>(null);

  const downloadedCount = Object.values(statuses).filter((s) => s.downloaded).length;

  return (
    <div className="page">
      <PageHead
        eyebrow="Models"
        title={<>Pick your <em>transcription</em> engine.</>}
        sub="Download any model, then click its card to activate it. Hot-swap any time — no restart needed."
      >
        <div className="chip">
          <CheckIcon style={{ width: 12, height: 12 }} /> {downloadedCount} of {MODELS.length} downloaded
        </div>
      </PageHead>

      <div className="grid grid-3" style={{ gap: 16 }}>
        {MODELS.map((m) => (
          <ModelCard
            key={m.id}
            model={m}
            active={activeModelId === m.id}
            hovered={hovered === m.id}
            status={statuses[m.id] ?? { downloaded: false, downloading: false, progress: 0 }}
            onSelect={() => void selectModel(m.id)}
            onDownload={() => void downloadModel(m.id)}
            onDelete={() => void deleteModel(m.id)}
            onHover={() => setHovered(m.id)}
            onLeave={() => setHovered(null)}
          />
        ))}

        {/* explainer slot fills the 6th grid cell */}
        <div className="card card-dark" style={{ display: "flex", flexDirection: "column", gap: 14, justifyContent: "space-between" }}>
          <div>
            <h3 style={{ color: "oklch(75% 0.008 85)" }}>How the scale works</h3>
            <div style={{ fontSize: 14, lineHeight: 1.5, color: "oklch(90% 0.005 85)", marginTop: 10 }}>
              Every model trades speed for accuracy. Left of the bar means it's
              fast and uses less CPU. Right means it catches more nuance — names,
              accents, overlapping speakers — but takes longer.
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <SpeedQualityBar perf={50} qual={50} mini dark />
            <div style={{ fontSize: 11.5, color: "oklch(75% 0.008 85)" }}>Speed ⟷ Accuracy</div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ModelCardProps {
  model: typeof MODELS[0];
  active: boolean;
  hovered: boolean;
  status: { downloaded: boolean; downloading: boolean; progress: number };
  onSelect: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onHover: () => void;
  onLeave: () => void;
}

function ModelCard({ model, active, hovered, status, onSelect, onDownload, onDelete, onHover, onLeave }: ModelCardProps) {
  const { downloaded, downloading, progress } = status;

  return (
    <div
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className="card"
      style={{
        textAlign: "left",
        cursor: downloaded ? "pointer" : "default",
        border: active ? "1.5px solid var(--ink-1)" : "0.5px solid var(--line)",
        background: "var(--bg-card)",
        boxShadow: active
          ? "0 1px 2px rgba(0,0,0,0.05), 0 12px 30px -14px rgba(0,0,0,0.22), inset 0 0 0 2.5px var(--accent)"
          : "var(--shadow-card)",
        transform: hovered ? "translateY(-2px)" : "none",
        transition: "transform .15s, box-shadow .15s, border-color .15s",
        position: "relative",
        minHeight: 220,
        display: "flex", flexDirection: "column", gap: 12,
        padding: 22,
      }}
      onClick={downloaded ? onSelect : undefined}
      role={downloaded ? "button" : undefined}
      tabIndex={downloaded ? 0 : undefined}
      onKeyDown={downloaded ? (e) => { if (e.key === "Enter" || e.key === " ") onSelect(); } : undefined}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600, color: "var(--ink-1)", letterSpacing: "-0.01em" }}>{model.name}</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>{model.tag}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          {model.badge && (
            <span className={"chip " + (model.badge === "Pro" ? "chip-dark" : "chip-accent")}>{model.badge}</span>
          )}
          {active && downloaded && (
            <span className="chip chip-accent"><CheckIcon style={{ width: 10, height: 10 }} /> Active</span>
          )}
        </div>
      </div>

      <div style={{
        fontSize: 12.5, lineHeight: 1.5,
        color: hovered ? "var(--ink-2)" : "var(--ink-3)",
        flex: 1,
        transition: "color .15s",
      }}>
        {model.desc}
      </div>

      <div style={{ marginTop: "auto" }}>
        <SpeedQualityBar perf={model.perf} qual={model.qual} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "var(--ink-3)", marginTop: 8, fontWeight: 500 }}>
          <span>SPEED · {model.perf}</span>
          <span className="mono tnum" style={{ color: "var(--ink-4)" }}>{model.size}</span>
          <span>QUALITY · {model.qual}</span>
        </div>
        {downloaded && hovered && !active && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            style={{
              marginTop: 8,
              width: "100%",
              padding: "5px 0",
              fontSize: 11,
              fontWeight: 500,
              color: "oklch(55% 0.12 25)",
              background: "oklch(98% 0.01 25 / 0.06)",
              border: "0.5px solid oklch(70% 0.08 25 / 0.35)",
              borderRadius: 6,
              cursor: "pointer",
              font: "inherit",
              transition: "background .12s",
            }}
          >
            Uninstall
          </button>
        )}
      </div>

      {!downloaded && (
        <div style={{ marginTop: 4 }}>
          {downloading ? (
            <ProgressBar progress={progress} />
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDownload(); }}
              className="chip chip-accent"
              style={{
                cursor: "pointer",
                font: "inherit",
                border: "none",
                width: "100%",
                justifyContent: "center",
                padding: "6px 0",
                fontSize: 12,
              }}
            >
              Download
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{
        height: 4, borderRadius: 999,
        background: "var(--bg-sunken)",
        border: "0.5px solid var(--line)",
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          width: `${progress}%`,
          background: "var(--accent)",
          borderRadius: 999,
          transition: "width 0.2s",
        }} />
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-3)", textAlign: "center" }}>
        Downloading… {progress}%
      </div>
    </div>
  );
}

function SpeedQualityBar({ perf, qual, mini, dark }: { perf: number; qual: number; mini?: boolean; dark?: boolean }) {
  const total = perf + qual;
  const bias = qual / total;
  const h = mini ? 6 : 8;
  return (
    <div style={{ position: "relative", height: h + 12, marginTop: mini ? 0 : 4 }}>
      <div style={{
        position: "absolute", left: 0, right: 0, top: 6, height: h, borderRadius: 999,
        background: dark ? "oklch(28% 0.005 60)" : "var(--bg-sunken)",
        border: dark ? "0" : "0.5px solid var(--line)",
        overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: `${(1 - bias) * 100}%`,
          background: dark ? "oklch(95% 0.005 85)" : "var(--ink-1)",
        }} />
        <div style={{
          position: "absolute", right: 0, top: 0, bottom: 0,
          width: `${bias * 100}%`,
          background: "var(--accent)",
        }} />
      </div>
      <div style={{
        position: "absolute", top: 0, left: `calc(${(1 - bias) * 100}% - ${h + 1}px)`,
        width: h + 10, height: h + 10, borderRadius: "50%",
        background: "white",
        border: "1.5px solid var(--ink-1)",
        boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
      }} />
    </div>
  );
}
