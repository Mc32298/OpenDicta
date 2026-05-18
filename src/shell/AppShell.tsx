import { useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { usePrefs, type Prefs } from "./prefs";
import { ModelManagerContext, useModelManagerState } from "../hooks/useModelManager";
import {
  DashboardIcon,
  InsightsIcon,
  ModelsIcon,
  StyleIcon,
  AIIcon,
  SettingsIcon,
} from "../ui/icons";
import Dashboard from "../pages/Dashboard";
import Insights from "../pages/Insights";
import Models from "../pages/Models";
import Style from "../pages/Style";
import AI from "../pages/AI";
import Settings from "../pages/Settings";

export type PageId = "dashboard" | "insights" | "models" | "style" | "ai" | "settings";

interface NavItem {
  id: PageId;
  label: string;
  Icon: (p: React.SVGProps<SVGSVGElement>) => ReactNode;
}

const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", Icon: DashboardIcon },
  { id: "insights",  label: "Insights",  Icon: InsightsIcon },
  { id: "models",    label: "Models",    Icon: ModelsIcon },
  { id: "style",     label: "Style",     Icon: StyleIcon },
  { id: "ai",        label: "AI",        Icon: AIIcon },
  { id: "settings",  label: "Settings",  Icon: SettingsIcon },
];

const PAGE_ALIASES: Record<string, PageId> = {
  dashboard: "dashboard", history: "dashboard",
  insights: "insights",
  models: "models", model: "models",
  style: "style",
  ai: "ai",
  settings: "settings", general: "settings", shortcut: "settings",
  shortcuts: "settings", keyboard: "settings", microphone: "settings",
  mic: "settings", productivity: "settings", diagnostics: "settings",
  about: "settings", appearance: "settings",
};

function getInitialPage(): PageId {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("page");
  if (!raw) return "dashboard";
  return PAGE_ALIASES[raw] ?? "dashboard";
}

export default function AppShell() {
  const [prefs, setPrefs] = usePrefs();
  const [page, setPage] = useState<PageId>(getInitialPage);
  const modelManager = useModelManagerState();

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--accent", prefs.accent);
    root.dataset.density = prefs.density;
    root.dataset.sidebar = prefs.sidebar;
  }, [prefs.accent, prefs.density, prefs.sidebar]);

  useEffect(() => {
    void getCurrentWindow().setFocus();
  }, []);

  useEffect(() => {
    document.title = `VoiceNote — ${NAV.find((n) => n.id === page)?.label ?? ""}`;
  }, [page]);

  useEffect(() => {
    const unlisten = listen<string>("navigate-to-page", (e) => {
      const next = PAGE_ALIASES[e.payload] ?? "dashboard";
      setPage(next);
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, []);

  const current = NAV.find((n) => n.id === page) ?? NAV[0];

  return (
    <ModelManagerContext.Provider value={modelManager}>
    <div className="stage">
      <div className="win">
        <div className="titlebar">
          <div className="tl" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            <i onClick={() => void getCurrentWindow().hide()} role="button" aria-label="Close" style={{ cursor: "pointer" }} />
            <i onClick={() => void getCurrentWindow().hide()} role="button" aria-label="Minimize" style={{ cursor: "pointer" }} />
            <i aria-disabled />
          </div>
          <div className="title">VoiceNote — {current.label}</div>
          <div style={{ width: 54 }} />
        </div>

        <div className="app">
          <aside className="side">
            <div className="brand">
              <div className="brand-mark">V</div>
              <div className="brand-text">VoiceNote</div>
            </div>
            <nav className="nav">
              {NAV.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPage(item.id)}
                  className={"nav-item" + (page === item.id ? " active" : "")}
                  title={item.label}
                  aria-current={page === item.id ? "page" : undefined}
                >
                  <item.Icon />
                  <span className="nav-label">{item.label}</span>
                </button>
              ))}
            </nav>
            <div className="side-foot">
              <div className="avatar" title={prefs.userName || "You"}>
                {(prefs.userName || "A").charAt(0).toUpperCase()}
              </div>
            </div>
          </aside>

          <main className="main" key={page}>
            {renderPage(page, prefs, setPrefs)}
          </main>
        </div>
      </div>
    </div>
    </ModelManagerContext.Provider>
  );
}

function renderPage(
  page: PageId,
  prefs: Prefs,
  setPrefs: ReturnType<typeof usePrefs>[1],
): ReactNode {
  switch (page) {
    case "dashboard": return <Dashboard userName={prefs.userName} accent={prefs.accent} />;
    case "insights":  return <Insights />;
    case "models":    return <Models />;
    case "style":     return <Style aiEnabled={prefs.aiEnabled} />;
    case "ai":        return <AI aiEnabled={prefs.aiEnabled} setAiEnabled={(v) => setPrefs("aiEnabled", v)} />;
    case "settings":  return <Settings prefs={prefs} setPrefs={setPrefs} />;
  }
}
