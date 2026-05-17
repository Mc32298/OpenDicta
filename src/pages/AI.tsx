import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import PageHead from "./PageHead";
import { CheckIcon, KeyIcon } from "../ui/icons";

const PROVIDERS = [
  { id: "gemini", name: "Gemini",  sub: "Google · Fast + cheap",  models: ["gemini-2.5-flash", "gemini-2.5-pro"], color: "oklch(72% 0.13 220)", mark: "G" },
  { id: "openai", name: "OpenAI",  sub: "Industry standard",       models: ["gpt-4o", "gpt-4o-mini"],              color: "oklch(70% 0.13 150)", mark: "◯" },
  { id: "claude", name: "Claude",  sub: "Anthropic · Best prose",  models: ["claude-sonnet-4", "claude-haiku-4"],  color: "oklch(70% 0.13 50)",  mark: "※" },
  { id: "ollama", name: "Ollama",  sub: "Local models",             models: ["llama3.1:8b", "qwen2.5:7b"],          color: "oklch(68% 0.1 255)", mark: "◉" },
];

type ProviderId = "gemini" | "openai" | "claude" | "ollama";
type AiSettingsInfo = {
  backend: "openai" | "gemini" | "anthropic" | "ollama";
  model: string;
  api_key_masked: string;
  ollama_url: string;
};
type AiConnectionTestResult = {
  ok: boolean;
  message: string;
  latency_ms: number;
};

const providerToBackend: Record<ProviderId, AiSettingsInfo["backend"]> = {
  openai: "openai",
  gemini: "gemini",
  claude: "anthropic",
  ollama: "ollama",
};

function backendToProvider(backend: AiSettingsInfo["backend"]): ProviderId {
  if (backend === "openai") return "openai";
  if (backend === "gemini") return "gemini";
  if (backend === "ollama") return "ollama";
  return "claude";
}

export default function AI({ aiEnabled, setAiEnabled }: { aiEnabled: boolean; setAiEnabled: (v: boolean) => void }) {
  const [provider, setProvider] = useState<ProviderId>("claude");
  const [apiKeys, setApiKeys] = useState<Record<ProviderId, string>>({
    openai: "",
    gemini: "",
    claude: "",
    ollama: "",
  });
  const [savedKeyForProvider, setSavedKeyForProvider] = useState<Record<ProviderId, boolean>>({
    openai: false,
    gemini: false,
    claude: false,
    ollama: false,
  });
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>(PROVIDERS[2].models[0]);
  const [ollamaUrl, setOllamaUrl] = useState<string>("http://localhost:11434");
  const [testStatus, setTestStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testBusy, setTestBusy] = useState(false);

  useEffect(() => {
    invoke<AiSettingsInfo>("get_ai_settings")
      .then((s) => {
        const p = backendToProvider(s.backend);
        setProvider(p);
        const providerModels = PROVIDERS.find((x) => x.id === p)?.models ?? [];
        setSelectedModel(providerModels.includes(s.model) ? s.model : providerModels[0] ?? s.model);
        setOllamaUrl(s.ollama_url || "http://localhost:11434");
        setSavedKeyForProvider((prev) => ({ ...prev, [p]: Boolean(s.api_key_masked) }));
      })
      .catch(console.error);
    invoke<boolean>("get_ai_enabled")
      .then((enabled) => setAiEnabled(enabled))
      .catch(console.error);
  }, []);

  async function selectProvider(next: ProviderId) {
    setProvider(next);
    const backend = providerToBackend[next];
    const providerModels = PROVIDERS.find((x) => x.id === next)?.models ?? [];
    const nextModel = providerModels.includes(selectedModel) ? selectedModel : (providerModels[0] ?? selectedModel);
    setSelectedModel(nextModel);
    try {
      await invoke("set_ai_backend", { backend });
      await invoke("set_ai_model", { model: nextModel });
      const s = await invoke<AiSettingsInfo>("get_ai_settings");
      setSavedKeyForProvider((prev) => ({ ...prev, [next]: Boolean(s.api_key_masked) }));
    } catch (e) {
      console.error(e);
    }
  }

  async function onModelChange(model: string) {
    setSelectedModel(model);
    try {
      await invoke("set_ai_model", { model });
    } catch (e) {
      console.error(e);
    }
  }

  async function onTestConnection() {
    if (testBusy) return;
    setTestBusy(true);
    setTestStatus(null);
    try {
      const res = await invoke<AiConnectionTestResult>("test_ai_connection");
      setTestStatus({
        ok: res.ok,
        text: res.ok ? `${res.message} ${res.latency_ms}ms` : `${res.message}${res.latency_ms ? ` (${res.latency_ms}ms)` : ""}`,
      });
    } catch (e) {
      setTestStatus({ ok: false, text: `Connection test failed: ${String(e)}` });
    } finally {
      setTestBusy(false);
    }
  }

  async function toggleAiEnabled() {
    const next = !aiEnabled;
    setAiEnabled(next);
    try {
      await invoke("set_ai_enabled", { enabled: next });
    } catch (e) {
      console.error(e);
      setAiEnabled(!next);
    }
  }

  const onSave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const backend = providerToBackend[provider];
      await invoke("set_ai_backend", { backend });
      if (provider === "ollama") {
        await invoke("set_ai_ollama_url", { url: ollamaUrl.trim() || "http://localhost:11434" });
      } else {
        await invoke("set_ai_api_key", { key: apiKeys[provider].trim() });
      }
      await invoke("set_ai_model", { model: selectedModel.trim() });
      setSavedKeyForProvider((prev) => ({
        ...prev,
        [provider]: provider === "ollama" ? ollamaUrl.trim().length > 0 : apiKeys[provider].trim().length > 0,
      }));
      setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
      setTimeout(() => setSavedAt(null), 3500);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHead
        eyebrow="AI"
        title={<>Bring your own <em>brain</em>.</>}
        sub="Pick a provider and paste your API key. VoiceNote stores it locally — your keys never touch our servers."
      >
        <div className="chip" style={{ background: aiEnabled ? "var(--accent-soft)" : "var(--bg-sunken)" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: aiEnabled ? "oklch(60% 0.18 145)" : "var(--ink-4)" }} />
          {aiEnabled ? "AI is enabled" : "AI is disabled"}
        </div>
      </PageHead>

      <div className="row" style={{ alignItems: "stretch" }}>
        {/* Left: provider picker */}
        <div className="card card-lg" style={{ flex: 1.4 }}>
          <h3>Choose a provider</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            {PROVIDERS.map((p) => {
              const on = provider === p.id;
              return (
                <button key={p.id} onClick={() => void selectProvider(p.id as ProviderId)} className="card" style={{
                  padding: 18, cursor: "pointer", font: "inherit", textAlign: "left",
                  border: on ? "1.5px solid var(--ink-1)" : "0.5px solid var(--line)",
                  background: on ? "var(--bg-sunken)" : "var(--bg-card)",
                  boxShadow: "none",
                  display: "flex", alignItems: "center", gap: 14,
                  transition: "background .12s, border-color .12s",
                }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 14,
                    background: `color-mix(in oklch, ${p.color} 28%, white)`,
                    color: `color-mix(in oklch, ${p.color} 70%, black)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 22, fontWeight: 600,
                    flexShrink: 0,
                  }}>{p.mark}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-1)" }}>{p.name}</div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>{p.sub}</div>
                  </div>
                  <div style={{
                    width: 20, height: 20, borderRadius: "50%",
                    border: on ? "6px solid var(--ink-1)" : "1.5px solid var(--line-2)",
                    transition: "border .12s",
                  }} />
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: key + config */}
        <div className="col" style={{ flex: 1.6 }}>
          <div className="card card-lg">
            <h3>API key</h3>
            <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 6, marginBottom: 18 }}>
              {provider === "ollama"
                ? "Enter your Ollama server URL."
                : `Paste your ${PROVIDERS.find((p) => p.id === provider)?.name} key. Stored encrypted in your OS keychain.`}
            </div>

            <div className="field">
              <label>{provider === "ollama" ? "Ollama URL" : "Secret key"}</label>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1, position: "relative" }}>
                  <KeyIcon style={{ width: 15, height: 15, position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)" }} />
                  {provider === "ollama" ? (
                    <input
                      className="input input-mono"
                      type="text"
                      placeholder="http://localhost:11434"
                      value={ollamaUrl}
                      onChange={(e) => setOllamaUrl(e.target.value)}
                      style={{ width: "100%", paddingLeft: 38 }}
                    />
                  ) : (
                    <input
                      className="input input-mono"
                      type="password"
                      placeholder={
                        provider === "openai" ? "sk-proj-…" :
                        provider === "claude" ? "sk-ant-api03-…" :
                        "AIza…"
                      }
                      value={apiKeys[provider]}
                      onChange={(e) => setApiKeys((prev) => ({ ...prev, [provider]: e.target.value }))}
                      style={{ width: "100%", paddingLeft: 38 }}
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="field" style={{ marginTop: 14 }}>
              <label>Model</label>
              {provider === "ollama" ? (
                <>
                  <input
                    className="input input-mono"
                    list="ollama-model-suggestions"
                    value={selectedModel}
                    onChange={(e) => void onModelChange(e.target.value)}
                    placeholder="e.g. llama3.1:8b"
                  />
                  <datalist id="ollama-model-suggestions">
                    {PROVIDERS.find((p) => p.id === "ollama")?.models.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </>
              ) : (
                <select className="input" value={selectedModel} onChange={(e) => void onModelChange(e.target.value)}>
                  {PROVIDERS.find((p) => p.id === provider)?.models.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="divider" style={{ margin: "18px 0" }} />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {savedAt
                  ? <span style={{ color: "oklch(50% 0.15 150)", fontWeight: 500 }}>✓ Saved at {savedAt}</span>
                  : testStatus
                    ? <span style={{ color: testStatus.ok ? "oklch(50% 0.15 150)" : "oklch(62% 0.2 25)", fontWeight: 500 }}>{testStatus.text}</span>
                  : savedKeyForProvider[provider]
                    ? <>Saved key for <span style={{ color: "var(--ink-2)" }}>{PROVIDERS.find((p) => p.id === provider)?.name}</span></>
                    : <>{provider === "ollama" ? "No saved URL for " : "No saved key for "}<span style={{ color: "var(--ink-2)" }}>{PROVIDERS.find((p) => p.id === provider)?.name}</span></>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-sm" onClick={() => void onTestConnection()} disabled={testBusy || busy}>
                  {testBusy ? "Testing..." : "Test connection"}
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => void onSave()} disabled={busy}>
                  <CheckIcon style={{ width: 13, height: 13 }} /> Save key
                </button>
              </div>
            </div>
          </div>

          <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-1)" }}>Enable AI refinement</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 3 }}>Turns on the Style tab and any AI-powered features app-wide.</div>
            </div>
            <div
              className="toggle"
              data-on={aiEnabled}
              onClick={() => void toggleAiEnabled()}
              role="switch"
              aria-checked={aiEnabled}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
