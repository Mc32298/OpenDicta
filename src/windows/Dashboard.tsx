import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DashboardStats, TranscriptRecord } from "./settingsTypes";

const EMPTY_STATS: DashboardStats = {
  avg_wpm: 0,
  total_words: 0,
  total_speaking_seconds: 0,
  minutes_saved: 0,
  weekly_words: 0,
  weekly_goal_words: 5000,
  weekly_progress: 0,
};

export default function Dashboard() {
  const [records, setRecords] = useState<TranscriptRecord[]>([]);
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [history, dashboardStats] = await Promise.all([
          invoke<TranscriptRecord[]>("get_transcript_history"),
          invoke<DashboardStats>("get_dashboard_stats"),
        ]);
        if (!cancelled) {
          setRecords(history);
          setStats(dashboardStats);
        }
      } catch (error) {
        console.error(error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const lastFive = records.slice(0, 5);
  const coachText = useMemo(() => {
    if (stats.total_words === 0) {
      return "Start your first note and VoiceNote will track your progress here.";
    }
    if (stats.minutes_saved >= 60) {
      return `You saved ${formatHours(stats.minutes_saved)} by talking. Keep going.`;
    }
    return `You saved ${Math.round(stats.minutes_saved)} minutes by talking. Keep going.`;
  }, [stats.minutes_saved, stats.total_words]);

  return (
    <div className="wv-pane wv-dashboard">
      <div className="wv-pane-head">
        <div>
          <div className="wv-pane-title">Dashboard</div>
          <div className="wv-pane-sub">Your dictation pace, saved time, and recent notes.</div>
        </div>
      </div>

      <div className="wv-dash-grid">
        <section className="wv-dash-progress" aria-label="Weekly word goal">
          <ProgressRing progress={stats.weekly_progress} />
          <div className="wv-dash-progress-copy">
            <div className="wv-dash-progress-value">{stats.weekly_words.toLocaleString()}</div>
            <div className="wv-dash-progress-label">
              of {stats.weekly_goal_words.toLocaleString()} words this week
            </div>
          </div>
        </section>

        <section className="wv-dash-metrics" aria-label="VoiceNote metrics">
          <Metric label="Avg WPM" value={Math.round(stats.avg_wpm).toString()} />
          <Metric label="Words total" value={stats.total_words.toLocaleString()} />
          <Metric label="Hours saved" value={formatSaved(stats.minutes_saved)} />
        </section>

        <section className="wv-dash-list">
          <div className="wv-dash-section-title">Last 5 transcriptions</div>
          {loading ? (
            <div className="wv-history-empty">Loading...</div>
          ) : lastFive.length === 0 ? (
            <div className="wv-history-empty">Completed transcriptions will appear here.</div>
          ) : (
            <div className="wv-history-list">
              {lastFive.map((record) => (
                <TranscriptRow key={record.id} record={record} compact />
              ))}
            </div>
          )}
        </section>

        <section className="wv-dash-coach">
          <div className="wv-dash-section-title">Keep going</div>
          <p>{coachText}</p>
        </section>
      </div>
    </div>
  );
}

function ProgressRing({ progress }: { progress: number }) {
  const clamped = Math.max(0, Math.min(1, progress));
  const degrees = clamped * 360;

  return (
    <div
      className="wv-progress-ring"
      style={{ "--progress-deg": `${degrees}deg` } as CSSProperties}
      aria-hidden="true"
    >
      <div className="wv-progress-ring-core">{Math.round(clamped * 100)}%</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="wv-dash-metric">
      <div className="wv-dash-metric-label">{label}</div>
      <div className="wv-dash-metric-value">{value}</div>
    </div>
  );
}

export function TranscriptRow({
  record,
  compact = false,
}: {
  record: TranscriptRecord;
  compact?: boolean;
}) {
  return (
    <div className="wv-history-row" data-compact={compact ? "1" : "0"}>
      <div className="wv-history-preview">{record.text}</div>
      <div className="wv-history-meta">
        <span>{formatDate(record.created_at)}</span>
        <span>{record.word_count.toLocaleString()} words</span>
        <span>{Math.round(record.wpm)} WPM</span>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSaved(minutes: number) {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

function formatHours(minutes: number) {
  return `${(minutes / 60).toFixed(1)} hours`;
}
