import { type ReactNode } from "react";
import PageHead from "./PageHead";
import { WaveIcon, ClockIcon, TrophyIcon, BoltIcon, SparkleIcon, MicIcon } from "../ui/icons";

export default function Insights() {
  return (
    <div className="page">
      <PageHead
        eyebrow="Insights"
        title={<>This week's <em>activity</em>.</>}
        sub="Three rings to close. You're crushing two of them."
      >
        <div className="chip">Week of Nov 11</div>
        <button className="btn btn-sm">Export</button>
      </PageHead>

      <div className="row" style={{ alignItems: "stretch", marginBottom: 18 }}>
        <div className="card card-lg" style={{ flex: "0 0 380px", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <ActivityRings />
        </div>
        <div className="col" style={{ flex: 1 }}>
          <RingStat color="oklch(74% 0.16 145)" name="Words" value="38,420" goal="50,000 word goal" pct={77} icon={<WaveIcon style={{ width: 18, height: 18 }} />} />
          <RingStat color="oklch(72% 0.18 50)"  name="Speaking hours" value="6h 12m" goal="8h weekly goal" pct={78} icon={<ClockIcon style={{ width: 18, height: 18 }} />} />
          <RingStat color="oklch(70% 0.20 320)" name="Milestones" value="11 of 14" goal="Daily streaks + sessions" pct={79} icon={<TrophyIcon style={{ width: 18, height: 18 }} />} />
        </div>
      </div>

      <div className="row" style={{ marginBottom: 18 }}>
        <div className="card card-lg" style={{ flex: 2 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <div>
              <h3>Words per day</h3>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
                <div className="stat-num" style={{ fontSize: 30 }}>5,489</div>
                <span className="stat-unit">avg / day</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--ink-3)" }}>
              <Legend color="var(--ink-1)" label="Words" />
              <Legend color="var(--accent)" label="Goal" />
            </div>
          </div>
          <DayChart />
        </div>
        <div className="card card-lg" style={{ flex: 1 }}>
          <h3>Personal bests</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
            <PB label="Longest session" value="58 min" sub="Tuesday · journaling" />
            <PB label="Fastest WPM" value="187 wpm" sub="Yesterday · quick memo" />
            <PB label="Best streak" value="23 days" sub="Active streak" />
            <PB label="Most words / day" value="9,142" sub="Nov 13 · interview prep" />
          </div>
        </div>
      </div>

      <div className="grid grid-3">
        <Tip
          icon={<BoltIcon style={{ width: 18, height: 18 }} />}
          title="Skip the punctuation pause"
          body="VoiceNote auto-inserts periods when you pause 1.2s. Speak through them and let the model handle it — users gain ~14% WPM."
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

function ActivityRings() {
  const rings = [
    { r: 88, w: 18, pct: 0.77, color: "oklch(74% 0.16 145)" },
    { r: 64, w: 18, pct: 0.78, color: "oklch(72% 0.18 50)" },
    { r: 40, w: 18, pct: 0.79, color: "oklch(70% 0.20 320)" },
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
      <text x="120" y="138" textAnchor="middle" fontSize="22" fontWeight="600" fill="var(--ink-1)" fontFamily="Instrument Serif">78% complete</text>
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

function DayChart() {
  const data = [
    { d: "Mon", v: 4200, g: 5000 },
    { d: "Tue", v: 5800, g: 5000 },
    { d: "Wed", v: 3100, g: 5000 },
    { d: "Thu", v: 7200, g: 5000 },
    { d: "Fri", v: 6900, g: 5000 },
    { d: "Sat", v: 2400, g: 5000 },
    { d: "Sun", v: 8800, g: 5000 },
  ];
  const max = 10000;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height: 180, padding: "0 4px" }}>
        {data.map((day, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%" }}>
            <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end", position: "relative" }}>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: `${(day.g / max) * 100}%`, height: 1.5, background: "var(--accent)", opacity: .85, borderRadius: 1 }} />
              <div style={{ width: "100%", height: `${(day.v / max) * 100}%`, background: "var(--ink-1)", borderRadius: "10px 10px 4px 4px", position: "relative" }}>
                {i === 6 && (
                  <div style={{ position: "absolute", top: -26, left: "50%", transform: "translateX(-50%)", background: "var(--ink-1)", color: "oklch(98% 0.005 85)", fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 6 }}>
                    {day.v.toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, padding: "0 4px", marginTop: 8 }}>
        {data.map((day, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 11.5, color: "var(--ink-3)", fontWeight: 500 }}>{day.d}</div>
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
