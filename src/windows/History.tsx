import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TranscriptRow } from "./Dashboard";
import type { TranscriptRecord } from "./settingsTypes";

export default function History() {
  const [records, setRecords] = useState<TranscriptRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void invoke<TranscriptRecord[]>("get_transcript_history")
      .then((items) => {
        if (!cancelled) setRecords(items);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = records.find((record) => record.id === selectedId) ?? records[0] ?? null;

  return (
    <div className="wv-pane wv-history-page">
      <div className="wv-pane-head">
        <div>
          <div className="wv-pane-title">History</div>
          <div className="wv-pane-sub">Recent transcripts saved locally and protected on this device.</div>
        </div>
      </div>

      {loading ? (
        <div className="wv-history-empty">Loading...</div>
      ) : records.length === 0 ? (
        <div className="wv-history-empty">
          Completed transcriptions will appear here after your first recording.
        </div>
      ) : (
        <div className="wv-history-layout">
          <div className="wv-history-list">
            {records.map((record) => (
              <button
                type="button"
                key={record.id}
                className="wv-history-row-btn"
                data-active={record.id === selected?.id ? "1" : "0"}
                onClick={() => setSelectedId(record.id)}
              >
                <TranscriptRow record={record} />
              </button>
            ))}
          </div>
          <aside className="wv-history-detail">
            {selected && (
              <>
                <div className="wv-dash-section-title">Transcript</div>
                <p>{selected.text}</p>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
