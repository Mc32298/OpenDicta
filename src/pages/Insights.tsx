import { useState, useEffect, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import PageHead from "./PageHead";
import { WaveIcon, ClockIcon, TrophyIcon, BoltIcon, SparkleIcon, MicIcon } from "../ui/icons";

interface DailyWordCount { label: string; words: number; goal: number; }
interface InsightsStats {
  week_label: string;
  weekly_words: number;
  weekly_speaking_seconds: number;
  weekly_days_active: number;
  weekly_goal_words: number;
  weekly_goal_speaking_seconds: number;
  words_pct: number;
  speaking_pct: number;
  milestones_pct: number;
  overall_pct: number;
  daily_words: DailyWordCount[];
  daily_avg_words: number;
  pb_longest_session_seconds: number;
  pb_longest_session_label: string;
  pb_fastest_wpm: number;
  pb_fastest_wpm_label: string;
  pb_best_streak_days: number;
  pb_streak_label: string;
  pb_most_words_day: number;
  pb_most_words_day_label: string;
}

function fmtHours(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtMins(secs: number): string {
  const m = Math.round(secs / 60);
  return m + " min";
}

export default function Insights() {
  const [stats, setStats] = useState<InsightsStats | null>(null);

  useEffect(() => {
    invoke<InsightsStats>("get_insights_stats").then(setStats).catch(console.error);
  }, []);

  const wordsPct  = stats?.words_pct      ?? 77;
  const speakPct  = stats?.speaking_pct   ?? 78;
  const milePct   = stats?.milestones_pct ?? 79;
  const overallPct = stats?.overall_pct   ?? 78;

  return (
    <div className="page">
      <PageHead
        eyebrow="Insights"
        title={<>This week's <em>activity</em>.</>}
        sub="Three rings to close. You're crushing two of them."
      >
        <div className="chip">Week of {stats?.week_label ?? "…"}</div>
        <button className="btn btn-sm">Export</button>
      </PageHead>

      <div className="row" style={{ alignItems: "stretch", marginBottom: 18 }}>
        <div className="card card-lg" style={{ flex: "0 0 380px", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <ActivityRings pcts={[wordsPct / 100, speakPct / 100, milePct / 100]} overallPct={overallPct} />
        </div>
        <div className="col" style={{ flex: 1 }}>
          <RingStat
            color="oklch(74% 0.16 145)"
            name="Words"
            value={stats ? stats.weekly_words.toLocaleString() : "38,420"}
            goal={`${(stats?.weekly_goal_words ?? 50000).toLocaleString()} word goal`}
            pct={wordsPct}
            icon={<WaveIcon style={{ width: 18, height: 18 }} />}
          />
          <RingStat
            color="oklch(72% 0.18 50)"
            name="Speaking hours"
            value={stats ? fmtHours(stats.weekly_speaking_seconds) : "6h 12m"}
            goal="8h weekly goal"
            pct={speakPct}
            icon={<ClockIcon style={{ width: 18, height: 18 }} />}
          />
          <RingStat
            color="oklch(70% 0.20 320)"
            name="Milestones"
            value={stats ? `${stats.weekly_days_active} of 7 days` : "11 of 14"}
            goal="Daily streaks + sessions"
            pct={milePct}
            icon={<TrophyIcon style={{ width: 18, height: 18 }} />}
          />
        </div>
      </div>

      <div className="row" style={{ marginBottom: 18 }}>
        <div className="card card-lg" style={{ flex: 2 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <div>
              <h3>Words per day</h3>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
                <div className="stat-num" style={{ fontSize: 30 }}>
                  {stats ? stats.daily_avg_words.toLocaleString() : "5,489"}
                </div>
                <span className="stat-unit">avg / day</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--ink-3)" }}>
              <Legend color="var(--ink-1)" label="Words" />
              <Legend color="var(--accent)" label="Goal" />
            </div>
          </div>
          <DayChart data={stats?.daily_words ?? null} />
        </div>
        <div className="card card-lg" style={{ flex: 1 }}>
          <h3>Personal bests</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
            <PB
              label="Longest session"
              value={stats ? fmtMins(stats.pb_longest_session_seconds) : "58 min"}
              sub={stats?.pb_longest_session_label || "—"}
            />
            <PB
              label="Fastest WPM"
              value={stats ? Math.round(stats.pb_fastest_wpm) + " wpm" : "187 wpm"}
              sub={stats?.pb_fastest_wpm_label || "—"}
            />
            <PB
              label="Best streak"
              value={stats ? stats.pb_best_streak_days + " days" : "23 days"}
              sub={stats?.pb_streak_label || "—"}
            />
            <PB
              label="Most words / day"
              value={stats ? stats.pb_most_words_day.toLocaleString() : "9,142"}
              sub={stats?.pb_most_words_day_label || "—"}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-3">
        <Tip
          icon={<BoltIcon style={{ width: 18, height: 18 }} />}
          title="Skip the punctuation pause"
          body="OpenDicta auto-inserts periods when you pause 1.2s. Speak through them and let the model handle it — users gain ~14% WPM."
        />
        <Tip
          icon={<SparkleIcon style={{ width: 18, height: 18 }} />}
          title="Try the Studio model for interviews"
          body="Slower but catches names, brands, and overlapping speakers far better than Parakeet V3."
        />
        <Tip
          icon={<MicIcon style={{ width: 18, height: 18 }} />}
          title="Mic 6cm, not 30cm"
          body="Your input level averaged 38%. Move your mic closer or run diagnostics — quality jumps noticeably."
        />
      </div>
    </div>
  );
}

function ActivityRings({ pcts, overallPct }: { pcts: [number, number, number]; overallPct: number }) {
  const rings = [
    { r: 88, w: 18, pct: pcts[0], color: "oklch(74% 0.16 145)" },
    { r: 64, w: 18, pct: pcts[1], color: "oklch(72% 0.18 50)" },
    { r: 40, w: 18, pct: pcts[2], color: "oklch(70% 0.20 320)" },
  ];
  return (
    <svg viewBox="0 0 240 240" style={{ width: 300, height: 300 }}>
      <defs>
        <filter id="ringShadow"><feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.18" /></filter>
      </defs>
      {rings.map((r, i) => {
        const c = 2 * Math.PI * r.r;
        return (
          <g key={i} transform="translate(120 120)">
            <circle r={r.r} fill="none" stroke={r.color} strokeOpacity="0.18" strokeWidth={r.w} />
            <circle r={r.r} fill="none" stroke={r.color} strokeWidth={r.w}
              strokeDasharray={`${c * r.pct} ${c}`}
              strokeLinecap="round"
              transform="rotate(-90)"
              style={{ filter: "url(#ringShadow)" }} />
          </g>
        );
      })}
      <text x="120" y="118" textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--ink-3)" letterSpacing="1" style={{ textTransform: "uppercase" }}>This week</text>
      <text x="120" y="138" textAnchor="middle" fontSize="22" fontWeight="600" fill="var(--ink-1)" fontFamily="Instrument Serif">{overallPct}% complete</text>
    </svg>
  );
}

function RingStat({ color, name, value, goal, pct, icon }: {
  color: string; name: string; value: string; goal: string; pct: number; icon: ReactNode;
}) {
  return (
    <div className="card" style={{ flex: 1, display: "flex", alignItems: "center", gap: 18 }}>
      <div style={{ width: 44, height: 44, borderRadius: 14, background: `color-mix(in oklch, ${color} 28%, white)`, color: `color-mix(in oklch, ${color} 70%, black)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 500 }}>{name}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
          <div style={{ fontSize: 24, fontWeight: 600, color: "var(--ink-1)", letterSpacing: "-0.01em" }}>{value}</div>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{goal}</div>
      </div>
      <div style={{ width: 64, height: 64, position: "relative", flexShrink: 0 }}>
        <svg viewBox="0 0 64 64" style={{ width: "100%", height: "100%" }}>
          <circle cx="32" cy="32" r="26" fill="none" stroke={color} strokeOpacity="0.18" strokeWidth="6" />
          <circle cx="32" cy="32" r="26" fill="none" stroke={color} strokeWidth="6"
            strokeDasharray={`${2 * Math.PI * 26 * pct / 100} ${2 * Math.PI * 26}`}
            strokeLinecap="round" transform="rotate(-90 32 32)" />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, color: "var(--ink-1)" }}>{pct}%</div>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: color }} />{label}
    </div>
  );
}

const FALLBACK_DAILY: DailyWordCount[] = [
  { label: "Mon", words: 4200, goal: 714 },
  { label: "Tue", words: 5800, goal: 714 },
  { label: "Wed", words: 3100, goal: 714 },
  { label: "Thu", words: 7200, goal: 714 },
  { label: "Fri", words: 6900, goal: 714 },
  { label: "Sat", words: 2400, goal: 714 },
  { label: "Sun", words: 8800, goal: 714 },
];

function DayChart({ data }: { data: DailyWordCount[] | null }) {
  const rows = data ?? FALLBACK_DAILY;
  const max = Math.max(10000, ...rows.map(r => r.words));
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height: 180, padding: "0 4px" }}>
        {rows.map((row, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%" }}>
            <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end", position: "relative" }}>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: `${(row.goal / max) * 100}%`, height: 1.5, background: "var(--accent)", opacity: .85, borderRadius: 1 }} />
              <div style={{ width: "100%", height: `${(row.words / max) * 100}%`, background: "var(--ink-1)", borderRadius: "10px 10px 4px 4px", position: "relative" }}>
                {i === rows.length - 1 && row.words > 0 && (
                  <div style={{ position: "absolute", top: -26, left: "50%", transform: "translateX(-50%)", background: "var(--ink-1)", color: "oklch(98% 0.005 85)", fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 6 }}>
                    {row.words.toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, padding: "0 4px", marginTop: 8 }}>
        {rows.map((row, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 11.5, color: "var(--ink-3)", fontWeight: 500 }}>{row.label}</div>
        ))}
      </div>
    </div>
  );
}

function PB({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 500, letterSpacing: ".02em" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: "var(--ink-1)", letterSpacing: "-0.01em", marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 1 }}>{sub}</div>
    </div>
  );
}

function Tip({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--accent-soft)", color: "var(--ink-1)", display: "flex", alignItems: "center", justifyContent: "center" }}>{icon}</div>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--ink-1)", lineHeight: 1.3 }}>{title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>{body}</div>
    </div>
  );
}
