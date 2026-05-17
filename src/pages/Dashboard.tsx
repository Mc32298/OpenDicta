import { useMemo, type ReactNode } from "react";
import PageHead from "./PageHead";
import {
  SearchIcon, MicIcon, CopyIcon, PlayIcon, EditIcon, MailIcon, SparkleIcon,
} from "../ui/icons";

export default function Dashboard({ userName }: { userName: string; accent?: string }) {
  const hour = new Date().getHours();
  const greet =
    hour < 5 ? "Up late" :
    hour < 12 ? "Good morning" :
    hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="page">
      <PageHead
        eyebrow="Dashboard"
        title={<>{greet}, <em>{userName}</em> <span style={{ display: "inline-block", transform: "rotate(8deg)" }}>👋</span></>}
        sub="Here's your speech-to-text snapshot for today."
      >
        <button className="btn btn-sm">
          <SearchIcon style={{ width: 14, height: 14 }} /> Browse history
        </button>
        <button className="btn btn-accent btn-sm">
          <MicIcon style={{ width: 14, height: 14 }} /> New recording
        </button>
      </PageHead>

      {/* Stat row */}
      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <StatCard
          label="Today's words"
          value="2,847"
          unit="words"
          trend="+18% vs yesterday"
          accent
          inset={<MiniBars data={[0.3, 0.5, 0.4, 0.7, 0.6, 0.85, 0.95]} />}
        />
        <StatCard
          label="Average WPM"
          value="148"
          unit="wpm"
          trend="Up from 132 last week"
          inset={<MiniLine />}
        />
        <StatCard
          label="Hours saved"
          value="42.6"
          unit="this month"
          trend="vs typing at 38 wpm"
          dark
          inset={<HoursPie pct={0.71} />}
        />
      </div>

      {/* Latest transcript + side */}
      <div className="row" style={{ alignItems: "stretch" }}>
        <div className="card card-lg" style={{ flex: 2, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink-3)" }}>Latest transcript</div>
              <div style={{ fontSize: 20, fontWeight: 600, marginTop: 6, color: "var(--ink-1)" }}>Q3 planning kickoff notes</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4 }}>14 minutes ago · 04:32 duration · 612 words · Whisper Pro</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-sm btn-ghost"><CopyIcon style={{ width: 14, height: 14 }} /> Copy</button>
              <button className="btn btn-sm"><PlayIcon style={{ width: 12, height: 12 }} /> Play</button>
            </div>
          </div>

          <Waveform />

          <div style={{
            fontSize: 14.5, lineHeight: 1.6, color: "var(--ink-2)",
            marginTop: 18, padding: "18px 20px",
            background: "var(--bg-sunken)", borderRadius: 16,
            border: "0.5px solid var(--line)",
          }}>
            <span style={{ background: "color-mix(in oklch, var(--accent) 50%, transparent)", padding: "0 2px", borderRadius: 3 }}>Okay so for Q3</span>, the three big bets we landed on are
            shipping the new transcript editor, cutting model latency below 300ms,
            and finally tackling the team-sharing flow that's been on the backlog
            since spring. I think if we sequence those right — editor first because
            it unblocks design, then latency since infra is already half-done…
            <span style={{ color: "var(--ink-3)" }}> and the rest is a separate conversation about resourcing.</span>
          </div>

          <div style={{ marginTop: "auto", paddingTop: 18, display: "flex", gap: 10 }}>
            <button className="btn btn-primary"><EditIcon style={{ width: 14, height: 14 }} /> Open in editor</button>
            <button className="btn"><MailIcon style={{ width: 14, height: 14 }} /> Send as email</button>
            <button className="btn btn-ghost mt-auto">
              <SparkleIcon style={{ width: 14, height: 14 }} /> Refine with AI
            </button>
          </div>
        </div>

        <div className="col" style={{ flex: 1, minWidth: 0 }}>
          <div className="card">
            <h3>Recording streak</h3>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
              <div className="stat-num" style={{ fontSize: 36 }}>23</div>
              <span className="stat-unit">days</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(14, 1fr)", gap: 4, marginTop: 14 }}>
              {Array.from({ length: 28 }).map((_, i) => {
                const active = i < 23 || (i >= 24 && i < 27);
                return (
                  <div key={i} style={{
                    aspectRatio: "1", borderRadius: 4,
                    background: active ? "var(--accent)" : "var(--bg-sunken)",
                    border: "0.5px solid var(--line)",
                  }} />
                );
              })}
            </div>
          </div>

          <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <h3>Recent sessions</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8, flex: 1 }}>
              {[
                { t: "Q3 planning kickoff notes", d: "14m ago", w: 612 },
                { t: "Customer call — Acme Co.", d: "2h ago", w: 1840 },
                { t: "Morning journal", d: "8h ago", w: 294 },
                { t: "Voice memo to self", d: "Yesterday", w: 127 },
                { t: "Standup recap", d: "Yesterday", w: 438 },
              ].map((s, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "10px 4px", borderBottom: i < 4 ? "0.5px solid var(--line)" : "none",
                }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.t}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{s.d}</div>
                  </div>
                  <div className="mono tnum" style={{ fontSize: 12, color: "var(--ink-3)" }}>{s.w}w</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, unit, trend, accent, dark, inset }: {
  label: string; value: string; unit: string; trend: string;
  accent?: boolean; dark?: boolean; inset?: ReactNode;
}) {
  const cls = "card" + (accent ? " card-accent" : "") + (dark ? " card-dark" : "");
  return (
    <div className={cls} style={{ display: "flex", flexDirection: "column", gap: 12, position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h3>{label}</h3>
        {!accent && !dark && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)" }} />}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <div className="stat-num">{value}</div>
        <span className="stat-unit">{unit}</span>
      </div>
      <div style={{
        fontSize: 12.5,
        color: accent ? "rgba(0,0,0,0.55)" : dark ? "oklch(70% 0.008 85)" : "var(--ink-3)",
      }}>{trend}</div>
      <div style={{ marginTop: 8 }}>{inset}</div>
    </div>
  );
}

function MiniBars({ data }: { data: number[] }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 42 }}>
      {data.map((v, i) => (
        <div key={i} style={{
          flex: 1, height: `${v * 100}%`,
          background: "rgba(0,0,0,0.78)", borderRadius: "4px 4px 4px 4px",
          minHeight: 6,
        }} />
      ))}
    </div>
  );
}

function MiniLine() {
  const pts = [12, 18, 14, 24, 22, 30, 28, 36, 34, 42];
  const w = 100, h = 42;
  const max = Math.max(...pts), min = Math.min(...pts);
  const path = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * w;
    const y = h - ((v - min) / (max - min)) * h;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: 42 }}>
      <path d={`${path} L${w} ${h} L0 ${h} Z`} fill="var(--accent)" opacity="0.35" />
      <path d={path} fill="none" stroke="var(--ink-1)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={w} cy={h - ((pts[pts.length - 1] - min) / (max - min)) * h} r="3" fill="var(--ink-1)" />
    </svg>
  );
}

function HoursPie({ pct }: { pct: number }) {
  const r = 18, c = 2 * Math.PI * r;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <svg viewBox="0 0 50 50" style={{ width: 44, height: 44 }}>
        <circle cx="25" cy="25" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="6" />
        <circle cx="25" cy="25" r={r} fill="none" stroke="var(--accent)" strokeWidth="6"
          strokeDasharray={`${c * pct} ${c}`} strokeLinecap="round"
          transform="rotate(-90 25 25)" />
      </svg>
      <div style={{ fontSize: 11.5, color: "oklch(70% 0.008 85)" }}>71% to monthly goal</div>
    </div>
  );
}

function Waveform() {
  const bars = useMemo(() => Array.from({ length: 60 }).map((_, i) => {
    const v = Math.abs(Math.sin(i * 0.7) * 0.5 + Math.cos(i * 0.3) * 0.3 + 0.2);
    return Math.min(1, v);
  }), []);
  const played = 0.42;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3, height: 54, padding: "0 4px" }}>
      {bars.map((v, i) => {
        const isPlayed = (i / bars.length) < played;
        return (
          <div key={i} style={{
            flex: 1, height: `${v * 100}%`, minHeight: 4,
            background: isPlayed ? "var(--ink-1)" : "oklch(85% 0.005 85)",
            borderRadius: 999,
          }} />
        );
      })}
    </div>
  );
}
