import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

const PANES = {
  history: {
    title: "No History Yet",
    body: "Completed dictations will appear here with transcript previews and quick actions.",
    cta: "Use Shortcut",
  },
  models: {
    title: "No Models Installed",
    body: "Download your first transcription model to begin offline dictation.",
    cta: "Open Settings → Models",
  },
  prompts: {
    title: "No Prompt Profiles",
    body: "Create custom AI prompt styles to reshape transcripts for specific tasks.",
    cta: "Open Settings → AI",
  },
} as const;

type EmptyTab = "history" | "models" | "prompts";

function normalizeTab(tab: string | null): EmptyTab {
  if (tab === "models") return "models";
  if (tab === "prompts") return "prompts";
  return "history";
}

export default function EmptyStates() {
  const params = new URLSearchParams(window.location.search);
  const [tab, setTab] = useState<EmptyTab>(normalizeTab(params.get("tab")));

  useEffect(() => {
    const unlisten = listen<string>("navigate-empty-tab", (event) => {
      setTab(normalizeTab(event.payload));
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const pane = PANES[tab];

  return (
    <div className="wv-empty-wrap">
      <div className="wv-empty-card">
        <div className="wv-empty-icon">•</div>
        <h2>{pane.title}</h2>
        <p>{pane.body}</p>
        <span className="wv-note">{pane.cta}</span>
      </div>
    </div>
  );
}
