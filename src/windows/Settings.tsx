import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ActivityIcon, BoxIcon, GearIcon, KeyboardIcon, MicIcon, PaletteIcon } from "../ui/icons";

type DashboardPage = "home" | "insights" | "dictionary" | "ai" | "style" | "transforms" | "settings";
type SttEngine = "parakeet" | "parakeet_v2_en" | "canary_qwen_2_5b";
type InstalledMap = Record<SttEngine, boolean>;
type IntervalScope = "today" | "week";
type TranscriptReadyPayload = { text: string; timestamp?: string };

type DashboardData = {
  metrics: { totalWords: number; wpm: number; dayStreak: number };
  activity: Array<{ timestamp: string; text: string }>;
  notices: string[];
};

type ProfilePreset = {
  id: string;
  name: string;
  description: string;
  hotkey: string;
};
type StylePreset = {
  id: string;
  name: string;
  instruction: string;
  builtIn: boolean;
};

const STT_MODEL_OPTIONS: Array<{ id: SttEngine; title: string; subtitle: string; size: string; command: string | null }> = [
  { id: "parakeet", title: "Parakeet Multilingual", subtitle: "Default and recommended", size: "1.1 GB", command: "download_model" },
  { id: "parakeet_v2_en", title: "Parakeet v2 English", subtitle: "English-only variant", size: "1.1 GB", command: "download_language_aware_model" },
  { id: "canary_qwen_2_5b", title: "Canary Qwen 2.5B", subtitle: "Local compatible canary package", size: "Medium", command: "download_canary_qwen_model" },
];

const PAGE_ALIASES: Record<string, DashboardPage> = {
  home: "home",
  insights: "insights",
  dictionary: "dictionary",
  snippets: "ai",
  ai: "ai",
  style: "style",
  transforms: "transforms",
  settings: "settings",
  diagnostics: "settings",
};

const NAV_ITEMS: Array<{ id: DashboardPage; label: string; icon: React.ReactNode }> = [
  { id: "home", label: "Home", icon: <GearIcon /> },
  { id: "insights", label: "Insights", icon: <ActivityIcon /> },
  { id: "dictionary", label: "Dictionary", icon: <BoxIcon /> },
  { id: "ai", label: "AI", icon: <KeyboardIcon /> },
  { id: "style", label: "Style", icon: <PaletteIcon /> },
  { id: "transforms", label: "Transforms", icon: <MicIcon /> },
  { id: "settings", label: "Settings", icon: <GearIcon /> },
];

const PROFILE_PRESETS: ProfilePreset[] = [
  { id: "fix_grammar", name: "Fix Grammar", description: "Clean punctuation and grammar before paste", hotkey: "" },
  { id: "summarize", name: "Summarize", description: "Condense transcript to a short summary", hotkey: "" },
  { id: "bullet_points", name: "Bullet Points", description: "Convert transcript to concise bullets", hotkey: "" },
  { id: "make_formal", name: "Make Formal", description: "Rewrite in a formal professional tone", hotkey: "" },
  { id: "prompt_builder", name: "Prompt Builder", description: "Transform transcript into a strong LLM prompt", hotkey: "" },
];
const STYLE_PRESETS: StylePreset[] = [
  { id: "natural", name: "Natural", instruction: "Keep text natural and clean.", builtIn: true },
  { id: "professional", name: "Professional", instruction: "Rewrite in professional tone.", builtIn: true },
  { id: "concise", name: "Concise", instruction: "Shorten while preserving meaning.", builtIn: true },
  { id: "friendly", name: "Friendly", instruction: "Keep it warm and friendly.", builtIn: true },
  { id: "prompt", name: "Prompt-ready", instruction: "Turn into high quality LLM prompt.", builtIn: true },
  { id: "email", name: "Email-ready", instruction: "Turn into clear professional email.", builtIn: true },
];

async function safeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    return await invoke<T>(command, args);
  } catch {
    return null;
  }
}

function getInitialPage(): DashboardPage {
  const page = new URLSearchParams(window.location.search).get("page");
  if (!page) return "home";
  return PAGE_ALIASES[page] ?? "home";
}

function formatTime(value?: string) {
  if (!value) return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function countWords(input: string) {
  return input.trim().split(/\s+/).filter(Boolean).length;
}

export default function Settings() {
  const [activePage, setActivePage] = useState<DashboardPage>(getInitialPage);
  const [dashboard, setDashboard] = useState<DashboardData>({ metrics: { totalWords: 0, wpm: 0, dayStreak: 0 }, activity: [], notices: [] });
  const [toast, setToast] = useState<string | null>(null);
  const [scope, setScope] = useState<IntervalScope>("today");
  const [feedFilter, setFeedFilter] = useState<"all" | "favorites">("all");
  const [favorites, setFavorites] = useState<string[]>([]);

  const [aiProvider, setAiProvider] = useState<"openai" | "anthropic" | "gemini" | "ollama">("openai");
  const [aiModel, setAiModel] = useState("gpt-4o-mini");
  const [openAiKey, setOpenAiKey] = useState("");
  const [claudeKey, setClaudeKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [showKey, setShowKey] = useState<{ openai: boolean; claude: boolean; gemini: boolean }>({ openai: false, claude: false, gemini: false });
  const [presets, setPresets] = useState<ProfilePreset[]>(PROFILE_PRESETS);
  const [dictionary, setDictionary] = useState<string[]>([]);
  const [dictSearch, setDictSearch] = useState("");
  const [dictDraft, setDictDraft] = useState("");
  const [stylePresets, setStylePresets] = useState<StylePreset[]>(STYLE_PRESETS);
  const [selectedStyleId, setSelectedStyleId] = useState("natural");
  const [styleSample, setStyleSample] = useState("Please rewrite this transcript as a better prompt.");
  const [stylePreview, setStylePreview] = useState("");

  const [sttEngine, setSttEngine] = useState<SttEngine>("parakeet");
  const [sttBusy, setSttBusy] = useState(false);
  const [installed, setInstalled] = useState<InstalledMap>({ parakeet: false, parakeet_v2_en: false, canary_qwen_2_5b: false });
  const [downloadingModel, setDownloadingModel] = useState<SttEngine | null>(null);

  useEffect(() => {
    void getCurrentWindow().setFocus();
  }, []);

  useEffect(() => {
    const load = async () => {
      const [rawMetrics, rawActivity] = await Promise.all([
        safeInvoke<Record<string, unknown>>("get_dashboard_stats"),
        safeInvoke<Array<Record<string, unknown>>>("get_transcript_history"),
      ]);
      setDashboard({
        metrics: {
          totalWords: typeof rawMetrics?.total_words === "number" ? rawMetrics.total_words : 0,
          wpm: typeof rawMetrics?.wpm === "number" ? rawMetrics.wpm : 0,
          dayStreak: typeof rawMetrics?.day_streak === "number" ? rawMetrics.day_streak : 0,
        },
        activity: (rawActivity ?? []).map((entry) => ({ timestamp: formatTime(), text: typeof entry.text === "string" ? entry.text : "" })).filter((r) => r.text.trim().length > 0).slice(0, 24),
        notices: rawMetrics ? [] : ["Metrics unavailable. Showing placeholders."],
      });

      const engine = await safeInvoke<string>("get_stt_engine");
      if (engine === "parakeet" || engine === "parakeet_v2_en" || engine === "canary_qwen_2_5b") setSttEngine(engine);
      const [a, b, c] = await Promise.all([
        safeInvoke<boolean>("get_stt_model_installed", { engine: "parakeet" }),
        safeInvoke<boolean>("get_stt_model_installed", { engine: "parakeet_v2_en" }),
        safeInvoke<boolean>("get_stt_model_installed", { engine: "canary_qwen_2_5b" }),
      ]);
      setInstalled({ parakeet: a === true, parakeet_v2_en: b === true, canary_qwen_2_5b: c === true });

      const profileInfo = await safeInvoke<Array<{ id: string; hotkey: string | null }>>("get_profiles");
      if (profileInfo) {
        setPresets((prev) =>
          prev.map((item) => {
            const found = profileInfo.find((p) => p.id === item.id);
            return found ? { ...item, hotkey: found.hotkey ?? "" } : item;
          }),
        );
      }
    };
    void load();

    const unlistenNav = listen<string>("navigate-to-page", (event) => {
      setActivePage(PAGE_ALIASES[event.payload] ?? "home");
    });
    const unlistenTranscript = listen<TranscriptReadyPayload>("transcript-ready", (event) => {
      const text = event.payload?.text?.trim();
      if (!text) return;
      setDashboard((prev) => ({
        ...prev,
        metrics: { ...prev.metrics, totalWords: prev.metrics.totalWords + countWords(text) },
        activity: [{ timestamp: formatTime(event.payload?.timestamp), text }, ...prev.activity].slice(0, 24),
      }));
    });

    return () => {
      unlistenNav.then((fn) => fn());
      unlistenTranscript.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const onMinimize = () => void getCurrentWindow().minimize();
  const onMaximize = () => void getCurrentWindow().toggleMaximize();
  const onClose = () => void getCurrentWindow().close();

  const visibleActivity = useMemo(() => {
    return feedFilter === "favorites" ? dashboard.activity.filter((row) => favorites.includes(row.text)) : dashboard.activity;
  }, [dashboard.activity, feedFilter, favorites]);
  const filteredDictionary = useMemo(() => {
    const q = dictSearch.trim().toLowerCase();
    const sorted = [...dictionary].sort((a, b) => a.localeCompare(b));
    return q ? sorted.filter((w) => w.toLowerCase().includes(q)) : sorted;
  }, [dictSearch, dictionary]);
  const selectedStyle = useMemo(() => stylePresets.find((p) => p.id === selectedStyleId) ?? stylePresets[0], [stylePresets, selectedStyleId]);

  const saveProvider = async () => {
    if (openAiKey.trim()) await safeInvoke("set_ai_api_key", { key: openAiKey.trim() });
    if (claudeKey.trim()) await safeInvoke("set_ai_provider_api_key", { provider: "anthropic", key: claudeKey.trim() });
    if (geminiKey.trim()) await safeInvoke("set_ai_provider_api_key", { provider: "gemini", key: geminiKey.trim() });
    await safeInvoke("set_ai_backend", { backend: aiProvider });
    await safeInvoke("set_ai_model", { model: aiModel });
    setToast("AI settings saved");
  };

  const setPresetHotkey = async (presetId: string, hotkey: string) => {
    setPresets((prev) => prev.map((p) => (p.id === presetId ? { ...p, hotkey } : p)));
    const ok = await safeInvoke("set_profile_hotkey", { profileId: presetId, hotkey: hotkey.trim() ? hotkey.trim() : null });
    if (ok == null) setToast("Could not save hotkey. It is local only.");
  };

  const onSttEngineChange = async (next: SttEngine) => {
    if (next === sttEngine) return;
    if (!installed[next]) return setToast("Model not installed yet. Use download first.");
    setSttBusy(true);
    const ok = await safeInvoke("set_stt_engine", { engine: next });
    setSttBusy(false);
    if (ok == null) return setToast("STT engine change failed");
    setSttEngine(next);
    setToast("STT engine updated");
  };

  const onDownloadModel = async (next: SttEngine) => {
    const model = STT_MODEL_OPTIONS.find((item) => item.id === next);
    if (!model?.command) return;
    setDownloadingModel(next);
    const ok = await safeInvoke(model.command);
    setDownloadingModel(null);
    if (ok == null) return setToast("Download failed");
    const ready = await safeInvoke<boolean>("get_stt_model_installed", { engine: next });
    if (ready === true) setInstalled((prev) => ({ ...prev, [next]: true }));
    setToast("Model download complete");
  };
  const addDictionaryWord = () => {
    const word = dictDraft.trim();
    if (!word) return;
    if (dictionary.includes(word)) return setToast("Word already exists");
    setDictionary((prev) => [word, ...prev]);
    setDictDraft("");
  };
  const runStylePreview = () => {
    if (!selectedStyle) return;
    setStylePreview(`[${selectedStyle.name}] ${styleSample}`);
  };

  return (
    <div className="wv-settings wv-dashboard" data-appearance="light" data-variant="flowish">
      <header className="wv-dashboard-topbar">
        <div className="wv-dashboard-title">VoiceNote</div>
        <div className="wv-dashboard-controls">
          <button type="button" aria-label="Minimize" onClick={onMinimize}>−</button>
          <button type="button" aria-label="Maximize" onClick={onMaximize}>□</button>
          <button type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
      </header>

      <div className="wv-dashboard-body">
        <aside className="wv-dashboard-nav">
          <div className="wv-dashboard-brand">
            <span className="wv-dashboard-brand-mark"><MicIcon /></span>
            <div>
              <p className="wv-dashboard-brand-title">Flow</p>
              <p className="wv-dashboard-brand-pill">VoiceNote Pro</p>
            </div>
          </div>
          <nav className="wv-dashboard-menu">
            {NAV_ITEMS.map((item) => (
              <button key={item.id} type="button" className="wv-dashboard-menu-item" data-active={activePage === item.id ? "1" : "0"} onClick={() => setActivePage(item.id)}>
                <span className="wv-dashboard-menu-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="wv-dashboard-main">
          {dashboard.notices.map((notice) => <div key={notice} className="wv-notice" data-tone="warn">{notice}</div>)}

          {activePage === "home" && (
            <section className="wv-dashboard-feed">
              <h3>TODAY</h3>
              <div className="wv-insights-wrap">
                <div className="wv-segmented">
                  <button type="button" data-active={feedFilter === "all" ? "1" : "0"} onClick={() => setFeedFilter("all")}>All</button>
                  <button type="button" data-active={feedFilter === "favorites" ? "1" : "0"} onClick={() => setFeedFilter("favorites")}>Favorites</button>
                </div>
                {visibleActivity.length === 0 ? (
                  <div className="wv-dashboard-empty">No transcripts yet. Start recording and entries will appear here.</div>
                ) : (
                  <ul>
                    {visibleActivity.map((row, idx) => (
                      <li key={`${row.timestamp}-${idx}`}>
                        <span>{row.timestamp}</span>
                        <div className="wv-home-row">
                          <button type="button" className="wv-dashboard-transcript" onClick={() => navigator.clipboard?.writeText(row.text)}>{row.text}</button>
                          <button type="button" className="wv-home-fav" data-active={favorites.includes(row.text) ? "1" : "0"} onClick={() => setFavorites((prev) => prev.includes(row.text) ? prev.filter((t) => t !== row.text) : [row.text, ...prev])}>★</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {activePage === "insights" && (
            <section className="wv-dashboard-feed">
              <h3>INSIGHTS</h3>
              <div className="wv-insights-wrap">
                <div className="wv-segmented">
                  <button type="button" data-active={scope === "today" ? "1" : "0"} onClick={() => setScope("today")}>Today</button>
                  <button type="button" data-active={scope === "week" ? "1" : "0"} onClick={() => setScope("week")}>This Week</button>
                </div>
                <div className="wv-insights-grid">
                  <div className="wv-dashboard-card"><small>Words</small><strong>{dashboard.metrics.totalWords}</strong></div>
                  <div className="wv-dashboard-card"><small>Avg WPM</small><strong>{dashboard.metrics.wpm}</strong></div>
                  <div className="wv-dashboard-card"><small>Sessions</small><strong>{dashboard.activity.length}</strong></div>
                  <div className="wv-dashboard-card"><small>Streak</small><strong>{dashboard.metrics.dayStreak}</strong></div>
                </div>
              </div>
            </section>
          )}

          {activePage === "ai" && (
            <section className="wv-dashboard-feed">
              <h3>AI</h3>
              <div className="wv-ai-grid">
                <div className="wv-ai-card">
                  <div className="wv-ai-provider-tabs">
                    {(["openai", "anthropic", "gemini", "ollama"] as const).map((provider) => (
                      <button key={provider} type="button" data-active={aiProvider === provider ? "1" : "0"} onClick={() => setAiProvider(provider)}>{provider === "anthropic" ? "Claude" : provider[0].toUpperCase() + provider.slice(1)}</button>
                    ))}
                  </div>
                  <div className="wv-ai-controls">
                    <label className="wv-ai-label">
                      <span>Model</span>
                      <select className="wv-input-light" value={aiModel} onChange={(e) => setAiModel(e.target.value)}>
                        <option value="gpt-4o-mini">gpt-4o-mini</option>
                        <option value="gpt-5-mini">gpt-5-mini</option>
                        <option value="claude-3-5-sonnet-latest">claude-3.5-sonnet</option>
                        <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                      </select>
                    </label>
                    <label className="wv-ai-label"><span>OpenAI API key</span><div className="wv-key-row"><input className="wv-input-light" type={showKey.openai ? "text" : "password"} value={openAiKey} onChange={(e) => setOpenAiKey(e.target.value)} /><button type="button" className="wv-inline-btn" onClick={() => setShowKey((prev) => ({ ...prev, openai: !prev.openai }))}>{showKey.openai ? "Hide" : "Show"}</button></div></label>
                    <label className="wv-ai-label"><span>Claude API key</span><div className="wv-key-row"><input className="wv-input-light" type={showKey.claude ? "text" : "password"} value={claudeKey} onChange={(e) => setClaudeKey(e.target.value)} /><button type="button" className="wv-inline-btn" onClick={() => setShowKey((prev) => ({ ...prev, claude: !prev.claude }))}>{showKey.claude ? "Hide" : "Show"}</button></div></label>
                    <label className="wv-ai-label"><span>Gemini API key</span><div className="wv-key-row"><input className="wv-input-light" type={showKey.gemini ? "text" : "password"} value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} /><button type="button" className="wv-inline-btn" onClick={() => setShowKey((prev) => ({ ...prev, gemini: !prev.gemini }))}>{showKey.gemini ? "Hide" : "Show"}</button></div></label>
                    <button type="button" className="wv-inline-btn wv-ai-save" onClick={() => void saveProvider()}>Save AI Settings</button>
                  </div>
                </div>

                <div className="wv-ai-card">
                  <div className="wv-ai-section-head">
                    <strong>Preset Shortcuts</strong>
                    <small>Choose only hotkeys. Preset behavior is fixed.</small>
                  </div>
                  <ul className="wv-preset-list">
                    {presets.map((preset) => (
                      <li key={preset.id}>
                        <div>
                          <p>{preset.name}</p>
                          <small>{preset.description}</small>
                        </div>
                        <input className="wv-input-light" placeholder="Press shortcut" value={preset.hotkey} onChange={(e) => setPresets((prev) => prev.map((p) => (p.id === preset.id ? { ...p, hotkey: e.target.value } : p)))} onBlur={(e) => void setPresetHotkey(preset.id, e.target.value)} />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          )}

          {activePage === "dictionary" && (
            <section className="wv-dashboard-feed">
              <h3>DICTIONARY</h3>
              <div className="wv-form-grid">
                <div className="wv-inline-form">
                  <input className="wv-input-light" placeholder="Add word" value={dictDraft} onChange={(e) => setDictDraft(e.target.value)} />
                  <button type="button" className="wv-inline-btn" onClick={addDictionaryWord}>Add</button>
                </div>
                <input className="wv-input-light" placeholder="Search words" value={dictSearch} onChange={(e) => setDictSearch(e.target.value)} />
                {filteredDictionary.length === 0 ? (
                  <div className="wv-dashboard-empty">No words yet. Add your first dictionary word.</div>
                ) : (
                  <ul className="wv-simple-list">
                    {filteredDictionary.map((word) => (
                      <li key={word}>
                        <input className="wv-input-light" defaultValue={word} onBlur={(e) => setDictionary((prev) => prev.map((w) => (w === word ? (e.target.value.trim() || w) : w)))} />
                        <button type="button" className="wv-inline-btn danger" onClick={() => setDictionary((prev) => prev.filter((w) => w !== word))}>Delete</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {activePage === "style" && (
            <section className="wv-dashboard-feed">
              <h3>STYLE</h3>
              <div className="wv-style-layout">
                <div className="wv-style-list">
                  {stylePresets.map((preset) => (
                    <button key={preset.id} type="button" className="wv-style-item" data-active={selectedStyleId === preset.id ? "1" : "0"} onClick={() => setSelectedStyleId(preset.id)}>
                      {preset.name}
                    </button>
                  ))}
                </div>
                <div className="wv-style-editor">
                  {selectedStyle && (
                    <>
                      <input className="wv-input-light" value={selectedStyle.name} disabled />
                      <textarea className="wv-input-light wv-textarea" value={selectedStyle.instruction} onChange={(e) => setStylePresets((prev) => prev.map((p) => (p.id === selectedStyle.id && !p.builtIn ? { ...p, instruction: e.target.value } : p)))} />
                      <h4>Preview</h4>
                      <textarea className="wv-input-light wv-textarea" value={styleSample} onChange={(e) => setStyleSample(e.target.value)} />
                      <button type="button" className="wv-inline-btn" onClick={runStylePreview}>Run preview</button>
                      <div className="wv-dashboard-empty">{stylePreview || "Preview output appears here."}</div>
                    </>
                  )}
                </div>
              </div>
            </section>
          )}

          {activePage === "transforms" && (
            <section className="wv-dashboard-feed">
              <h3>TRANSFORMS</h3>
              <div className="wv-dashboard-empty">Transforms is deferred for now.</div>
            </section>
          )}

          {activePage === "settings" && (
            <section className="wv-dashboard-feed">
              <h3>SETTINGS</h3>
              <div className="wv-form-grid">
                <div style={{ border: "1px solid #d5d7dc", borderRadius: 10, overflow: "hidden", background: "#f4f5f6" }}>
                  {STT_MODEL_OPTIONS.map((item) => {
                    const isActive = item.id === sttEngine;
                    const isDownloading = downloadingModel === item.id;
                    return (
                      <div key={item.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", alignItems: "center", gap: 8, padding: "8px 10px", borderTop: "1px solid #e0e2e6", background: isActive ? "#dde9fc" : "transparent" }}>
                        <button type="button" onClick={() => void onDownloadModel(item.id)} disabled={sttBusy || isDownloading} style={{ width: 22, height: 22, borderRadius: 11, border: "1px solid #7d8796", background: "#fff", color: "#1f2937", fontSize: 11 }}>↓</button>
                        <button type="button" onClick={() => void onSttEngineChange(item.id)} disabled={sttBusy} style={{ border: "none", background: "transparent", textAlign: "left", color: "#1f2937" }}>
                          <div style={{ fontWeight: 650 }}>{item.title}</div>
                          <div style={{ fontSize: 12, color: "#4b5563" }}>{item.subtitle}</div>
                        </button>
                        <small style={{ color: "#374151" }}>{item.size}</small>
                        <small style={{ color: "#374151" }}>{isDownloading ? "..." : installed[item.id] ? "Ready" : "Missing"}</small>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}
        </main>

        <aside className="wv-dashboard-rail">
          <div className="wv-dashboard-card">
            <p><strong>{dashboard.metrics.totalWords || "--"}</strong> total words</p>
            <p><strong>{dashboard.metrics.wpm || "--"}</strong> avg wpm</p>
            <p><strong>{dashboard.metrics.dayStreak || "--"}</strong> day streak</p>
          </div>
        </aside>
      </div>

      {toast && <div className="wv-dashboard-toast">{toast}</div>}
    </div>
  );
}
