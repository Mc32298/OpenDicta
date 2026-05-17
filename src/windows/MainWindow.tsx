import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Dashboard from "./Dashboard";
import History from "./History";
import { SettingsContent } from "./Settings";
import type { MainPage, Page } from "./settingsTypes";
import { ActivityIcon, GearIcon, MicIcon } from "../ui/icons";

const SETTINGS_PAGE_ALIASES: Record<string, Page> = {
  general: "general",
  shortcuts: "shortcut",
  keyboard: "shortcut",
  shortcut: "shortcut",
  mic: "microphone",
  microphone: "microphone",
  model: "model",
  models: "model",
  ai: "ai",
  productivity: "productivity",
  appearance: "appearance",
  diagnostics: "diagnostics",
  about: "about",
};

function normalizeSettingsPage(input: string | null): Page {
  if (!input) return "general";
  return SETTINGS_PAGE_ALIASES[input] ?? "general";
}

function getInitialSettingsPage(): Page {
  const params = new URLSearchParams(window.location.search);
  return normalizeSettingsPage(params.get("page"));
}

function getInitialMainPage(): MainPage {
  const params = new URLSearchParams(window.location.search);
  return params.has("page") ? "settings" : "dashboard";
}

export default function MainWindow() {
  const [mainPage, setMainPage] = useState<MainPage>(getInitialMainPage);
  const [settingsPage, setSettingsPage] = useState<Page>(getInitialSettingsPage);
  const [accent, setAccent] = useState("#0A84FF");

  useEffect(() => {
    void getCurrentWindow().setFocus();
    void invoke<string>("get_waveform_color").then(setAccent).catch(console.error);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--ac", accent);
  }, [accent]);

  useEffect(() => {
    const unlisten = listen<string>("navigate-to-page", (event) => {
      setSettingsPage(normalizeSettingsPage(event.payload));
      setMainPage("settings");
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const close = () => {
    void getCurrentWindow().hide();
  };

  return (
    <div className="wv-settings wv-main-window" data-appearance="light" data-variant="warm">
      <div className="wv-chrome">
        <div className="wv-traffic">
          <button aria-label="Close VoiceNote" onClick={close} style={{ background: "#FF5F57" }} />
          <button aria-label="Hide VoiceNote" onClick={close} style={{ background: "#FEBC2E" }} />
          <button aria-label="VoiceNote status" type="button" style={{ background: "#28C840" }} disabled />
        </div>
        <div className="wv-chrome-title">VoiceNote</div>
        <div className="wv-chrome-spacer" />
      </div>

      <div className="wv-body">
        <aside className="wv-sidebar">
          <div className="wv-sidebar-head">
            <span className="wv-brand-mark"><MicIcon /></span>
            <div className="wv-brand-block">
              <div className="wv-brand-name">VoiceNote</div>
              <div className="wv-brand-ver">Dashboard</div>
            </div>
          </div>
          <nav className="wv-nav">
            <MainNavItem
              id="dashboard"
              label="Dashboard"
              active={mainPage}
              onSelect={setMainPage}
              icon={<ActivityIcon />}
            />
            <MainNavItem
              id="history"
              label="History"
              active={mainPage}
              onSelect={setMainPage}
              icon={<ActivityIcon />}
            />
            <MainNavItem
              id="settings"
              label="Settings"
              active={mainPage}
              onSelect={setMainPage}
              icon={<GearIcon />}
            />
          </nav>
        </aside>

        <main className="wv-main">
          {mainPage === "dashboard" && <Dashboard />}
          {mainPage === "history" && <History />}
          {mainPage === "settings" && (
            <SettingsContent
              page={settingsPage}
              onPageChange={setSettingsPage}
              accent={accent}
              onAccentChange={setAccent}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function MainNavItem({
  id,
  label,
  icon,
  active,
  onSelect,
}: {
  id: MainPage;
  label: string;
  icon: ReactNode;
  active: MainPage;
  onSelect: (page: MainPage) => void;
}) {
  return (
    <button
      type="button"
      className="wv-nav-item"
      data-active={active === id ? "1" : "0"}
      aria-current={active === id ? "page" : undefined}
      onClick={() => onSelect(id)}
    >
      <span className="wv-nav-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
