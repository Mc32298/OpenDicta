import { useState, useEffect, useMemo, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import PageHead from "./PageHead";
import { CopyIcon } from "../ui/icons";
import { MODEL_CATALOG, catalogName } from "../lib/catalog";

interface DashboardStats {
  avg_wpm: number;
  total_words: number;
  total_speaking_seconds: number;
  minutes_saved: number;
  weekly_words: number;
  weekly_goal_words: number;
  weekly_progress: number;
  today_words: number;
  yesterday_words: number;
  current_streak_days: number;
  typing_baseline_wpm: number;
  last_7_day_words: number[];
  heatmap_28: boolean[];
}

interface LatestTranscriptInfo {
  id: string;
  title: string;
  time_ago: string;
  duration_label: string;
  word_count: number;
  text: string;
}

interface RecentSession {
  id: string;
  title: string;
  time_ago: string;
  word_count: number;
}

interface DashboardLatestData {
  latest: LatestTranscriptInfo | null;
  recent_sessions: RecentSession[];
}

function todayTrend(today: number, yesterday: number): string {
  if (yesterday === 0) return today > 0 ? "First recording today" : "No recordings yet today";
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  return pct >= 0 ? `+${pct}% vs yesterday` : `${pct}% vs yesterday`;
}

function fmtHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return m + "m";
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function Dashboard({ userName }: { userName: string }) {
  const hour = new Date().getHours();
  const greet =
    hour < 5 ? "Up late" :
    hour < 12 ? "Good morning" :
    hour < 18 ? "Good afternoon" : "Good evening";

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [latest, setLatest] = useState<DashboardLatestData | null>(null);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);

  useEffect(() => {
    invoke<DashboardStats>("get_dashboard_stats").then(setStats).catch(console.error);
    invoke<DashboardLatestData>("get_latest_transcript_data").then(setLatest).catch(console.error);
    invoke<string>("get_active_model_id").then(setActiveModelId).catch(console.error);
  }, []);

  const miniBarsData = useMemo(() => {
    if (!stats) return [0.3, 0.5, 0.4, 0.7, 0.6, 0.85, 0.95];
    const vals = stats.last_7_day_words;
    const max = Math.max(...vals, 1);
    return vals.map(v => v / max);
  }, [stats]);

  const modelInUse = useMemo(() => {
    if (!activeModelId) return "Unknown";
    return catalogName(MODEL_CATALOG, activeModelId);
  }, [activeModelId]);

  const sessionQuality = useMemo(() => {
    if (!latest?.latest) return "Awaiting session";
    if (latest.latest.word_count >= 80) return "High";
    if (latest.latest.word_count >= 30) return "Good";
    return "Fair";
  }, [latest]);

  return (
    <div className="page">
      <PageHead
        eyebrow="Dashboard"
        title={<>{greet}, <em>{userName}</em> <span style={{ display: "inline-block", transform: "rotate(8deg)" }}>👋</span></>}
        sub="Here's your speech-to-text snapshot for today."
      >
        <div className="chip" style={{ pointerEvents: "none" }}>
          Model in use: <strong style={{ fontWeight: 600 }}>{modelInUse}</strong>
        </div>
        <div className="chip" style={{ pointerEvents: "none" }}>
          Session quality: <strong style={{ fontWeight: 600 }}>{sessionQuality}</strong>
        </div>
      </PageHead>

      {/* Stat row */}
      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <StatCard
          label="Today's words"
          value={stats ? stats.today_words.toLocaleString() : "—"}
          unit="words"
          trend={stats ? todayTrend(stats.today_words, stats.yesterday_words) : "Loading…"}
          accent
          inset={<MiniBars data={miniBarsData} />}
        />
        <StatCard
          label="Average WPM"
          value={stats ? Math.round(stats.avg_wpm).toString() : "—"}
          unit="wpm"
          trend="Overall all-time average"
          inset={<MiniLine />}
        />
        <StatCard
          label="Hours saved"
          value={stats ? fmtHours(stats.minutes_saved) : "—"}
          unit="saved"
          trend={stats ? `vs typing at ${stats.typing_baseline_wpm} wpm` : "Loading…"}
          dark
          inset={<HoursPie pct={stats?.weekly_progress ?? 0.71} />}
        />
      </div>

      {/* Latest transcript + side */}
      <div className="row" style={{ alignItems: "stretch" }}>
        <div className="card card-lg" style={{ flex: 2, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink-3)" }}>Latest transcript</div>
              <div style={{ fontSize: 20, fontWeight: 600, marginTop: 6, color: "var(--ink-1)" }}>
                {latest?.latest?.title ?? "No recordings yet"}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4 }}>
                {latest?.latest
                  ? `${latest.latest.time_ago} · ${latest.latest.duration_label} duration · ${latest.latest.word_count.toLocaleString()} words`
                  : "Make your first recording to get started"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-sm btn-ghost"><CopyIcon style={{ width: 14, height: 14 }} /> Copy</button>
            </div>
          </div>

          <Waveform />

          <div style={{
            fontSize: 14.5, lineHeight: 1.6, color: "var(--ink-2)",
            marginTop: 18, padding: "18px 20px",
            background: "var(--bg-sunken)", borderRadius: 16,
            border: "0.5px solid var(--line)",
          }}>
            {latest?.latest
              ? latest.latest.text.slice(0, 500) + (latest.latest.text.length > 500 ? "…" : "")
              : <span style={{ color: "var(--ink-3)" }}>Your transcript will appear here after your first recording.</span>}
          </div>
        </div>

        <div className="col" style={{ flex: 1, minWidth: 0 }}>
          <div className="card">
            <h3>Recording streak</h3>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
              <div className="stat-num" style={{ fontSize: 36 }}>
                {stats?.current_streak_days ?? 0}
              </div>
              <span className="stat-unit">days</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(14, 1fr)", gap: 4, marginTop: 14 }}>
              {(stats?.heatmap_28 ?? Array.from({ length: 28 }, (_, i) => i < 23 || (i >= 24 && i < 27))).map((active, i) => (
                <div key={i} style={{
                  aspectRatio: "1", borderRadius: 4,
                  background: active ? "var(--accent)" : "var(--bg-sunken)",
                  border: "0.5px solid var(--line)",
                }} />
              ))}
            </div>
          </div>

          <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <h3>Recent sessions</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8, flex: 1 }}>
              {(latest?.recent_sessions ?? []).length === 0
                ? <div style={{ fontSize: 13, color: "var(--ink-3)", padding: "10px 4px" }}>No sessions yet</div>
                : (latest?.recent_sessions ?? []).map((s, i, arr) => (
                <div key={s.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "10px 4px", borderBottom: i < arr.length - 1 ? "0.5px solid var(--line)" : "none",
                }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{s.time_ago}</div>
                  </div>
                  <div className="mono tnum" style={{ fontSize: 12, color: "var(--ink-3)" }}>{s.word_count}w</div>
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
  const displayPct = Math.round(pct * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <svg viewBox="0 0 50 50" style={{ width: 44, height: 44 }}>
        <circle cx="25" cy="25" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="6" />
        <circle cx="25" cy="25" r={r} fill="none" stroke="var(--accent)" strokeWidth="6"
          strokeDasharray={`${c * pct} ${c}`} strokeLinecap="round"
          transform="rotate(-90 25 25)" />
      </svg>
      <div style={{ fontSize: 11.5, color: "oklch(70% 0.008 85)" }}>{displayPct}% to weekly goal</div>
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
