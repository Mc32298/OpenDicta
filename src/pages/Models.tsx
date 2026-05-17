import { useState } from "react";
import PageHead from "./PageHead";
import { CheckIcon } from "../ui/icons";

const MODELS = [
  {
    id: "parakeet-v3",
    name: "Parakeet V3",
    tag: "Lightning-fast streaming",
    desc: "Real-time transcription with sub-200ms latency. Best for live dictation, voice commands, and quick memos where speed matters most.",
    perf: 96, qual: 72,
    size: "142 MB",
    badge: "Default",
  },
  {
    id: "whisper-pro",
    name: "Whisper Pro",
    tag: "Balanced accuracy",
    desc: "The all-rounder. Handles accents, technical jargon, and noisy rooms well. Use this when you don't know what you'll be recording.",
    perf: 72, qual: 86,
    size: "780 MB",
    badge: "Recommended",
  },
  {
    id: "qwen",
    name: "Qwen",
    tag: "Multilingual specialist",
    desc: "Trained on 100+ languages with strong code-switching. Pick this if you record in non-English or mixed-language settings.",
    perf: 58, qual: 90,
    size: "1.2 GB",
  },
  {
    id: "parakeet-v2",
    name: "Parakeet V2",
    tag: "Legacy fast",
    desc: "The previous-gen real-time model. Slightly less accurate than V3 but uses ~40% less CPU — handy on older hardware.",
    perf: 90, qual: 65,
    size: "98 MB",
  },
  {
    id: "studio",
    name: "Studio",
    tag: "Maximum accuracy",
    desc: "Frontier-grade quality with speaker diarization, punctuation, and disfluency cleanup. Slower (~3× realtime) — use for interviews, podcasts, court transcripts.",
    perf: 32, qual: 98,
    size: "2.8 GB",
    badge: "Pro",
  },
];

export default function Models() {
  const [active, setActive] = useState("whisper-pro");
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div className="page">
      <PageHead
        eyebrow="Models"
        title={<>Pick your <em>transcription</em> engine.</>}
        sub="Hover any model to see what it's best for. Hot-swap any time — no restart needed."
      >
        <div className="chip"><CheckIcon style={{ width: 12, height: 12 }} /> 3 of 5 downloaded</div>
      </PageHead>

      <div className="grid grid-3" style={{ gap: 16 }}>
        {MODELS.map((m) => (
          <ModelCard
            key={m.id}
            model={m}
            active={active === m.id}
            hovered={hovered === m.id}
            onSelect={() => setActive(m.id)}
            onHover={() => setHovered(m.id)}
            onLeave={() => setHovered(null)}
          />
        ))}

        {/* explainer slot to fill the 6th cell */}
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

function ModelCard({ model, active, hovered, onSelect, onHover, onLeave }: {
  model: typeof MODELS[0];
  active: boolean;
  hovered: boolean;
  onSelect: () => void;
  onHover: () => void;
  onLeave: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className="card"
      style={{
        textAlign: "left",
        cursor: "pointer",
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
        font: "inherit", color: "inherit",
        padding: 22,
      }}
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
          {active && (
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
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--ink-3)", marginTop: 8, fontWeight: 500 }}>
          <span>SPEED · {model.perf}</span>
          <span className="mono tnum" style={{ color: "var(--ink-4)" }}>{model.size}</span>
          <span>QUALITY · {model.qual}</span>
        </div>
      </div>
    </button>
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
