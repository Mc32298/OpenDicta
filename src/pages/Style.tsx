import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import PageHead from "./PageHead";
import {
  MicIcon, CheckIcon, MailIcon, CodeIcon, BriefcaseIcon, ListIcon,
  ChatIcon, SparkleIcon, LockSolidIcon,
} from "../ui/icons";
import { STYLE_CATALOG } from "../lib/catalog";

const STYLE_META: Record<string, { desc: string; Ico: typeof MicIcon }> = {
  raw:     { desc: "Verbatim. Nothing changed. No AI processing.", Ico: MicIcon },
  grammar: { desc: "Punctuation + sentence flow.",                 Ico: CheckIcon },
  email:   { desc: "Subject + greeting + sign-off.",               Ico: MailIcon },
  prompt:  { desc: "Reformats into a clean LLM prompt.",           Ico: CodeIcon },
  pro:     { desc: "Business tone, extracts action items.",        Ico: BriefcaseIcon },
  bullets: { desc: "Hierarchical bullet list.",                    Ico: ListIcon },
  chat:    { desc: "Short, casual, with emoji.",                   Ico: ChatIcon },
  summary: { desc: "Compresses to 3-5 sentences.",                 Ico: SparkleIcon },
};

const STYLES = STYLE_CATALOG.map((c) => {
  const meta = STYLE_META[c.id] ?? { desc: "", Ico: MicIcon };
  return { id: c.id, name: c.name, desc: meta.desc, Ico: meta.Ico };
});

function mapModeToStyle(mode: string): string {
  return mode === "clean" ? "grammar" : mode;
}

export default function Style({ aiEnabled }: { aiEnabled: boolean }) {
  const [selected, setSelected] = useState("grammar");

  useEffect(() => {
    invoke<string>("get_ai_default_mode")
      .then((mode) => {
        const mapped = mapModeToStyle(mode);
        if (STYLES.some((s) => s.id === mapped)) setSelected(mapped);
      })
      .catch(console.error);

    const unlistenMode = listen<string>("ai-default-mode-changed", (event) => {
      const mapped = mapModeToStyle(event.payload);
      if (STYLES.some((s) => s.id === mapped)) setSelected(mapped);
    });

    return () => {
      void unlistenMode.then((fn) => fn());
    };
  }, []);

  async function chooseStyle(id: string) {
    setSelected(id);
    try {
      await invoke("set_ai_default_mode", { mode: id });
    } catch (e) {
      console.error(e);
    }
  }

  const body = (
    <>
      <div className="grid grid-4" style={{ gap: 14 }}>
        {STYLES.map((s) => {
          const on = selected === s.id;
          return (
            <button
              key={s.id}
              onClick={() => void chooseStyle(s.id)}
              className="card"
              style={{
                textAlign: "left", cursor: "pointer",
                border: on ? "1.5px solid var(--ink-1)" : "0.5px solid var(--line)",
                background: on ? "var(--ink-1)" : "var(--bg-card)",
                color: on ? "oklch(98% 0.005 85)" : "var(--ink-1)",
                font: "inherit", display: "flex", flexDirection: "column", gap: 12,
                minHeight: 160, padding: 18,
                transition: "transform .12s, background .15s",
                position: "relative",
              }}
            >
              <div style={{
                width: 38, height: 38, borderRadius: 11,
                background: on ? "var(--accent)" : "var(--bg-sunken)",
                color: on ? "#1a1a1a" : "var(--ink-1)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <s.Ico style={{ width: 18, height: 18 }} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>{s.name}</div>
              <div style={{ fontSize: 12, color: on ? "oklch(75% 0.008 85)" : "var(--ink-3)", lineHeight: 1.45 }}>{s.desc}</div>
              {on && (
                <div style={{ position: "absolute", top: 14, right: 14, width: 22, height: 22, borderRadius: "50%", background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", color: "#1a1a1a" }}>
                  <CheckIcon style={{ width: 13, height: 13 }} />
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="card card-lg" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <h3>Live preview</h3>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-1)", marginTop: 4 }}>
              Style: <span style={{ color: "var(--ink-2)" }}>{STYLES.find((x) => x.id === selected)?.name}</span>
            </div>
          </div>
          <span className="chip">Sample input: standup recap</span>
        </div>
        <div className="row" style={{ gap: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 8 }}>You spoke</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-2)", padding: "14px 16px", background: "var(--bg-sunken)", borderRadius: 14, border: "0.5px solid var(--line)" }}>
              uh so today i'm gonna work on the transcript editor we talked about
              yesterday um and i also need to follow up with mark about the latency
              thing and oh yeah send the design review notes to the team before
              standup tomorrow
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 8 }}>OpenDicta outputs</div>
            <StylePreview style={selected} />
          </div>
        </div>
      </div>
    </>
  );

  if (!aiEnabled) {
    return (
      <div className="page">
        <PageHead
          eyebrow="Style"
          title={<>Refine your <em>words</em>.</>}
          sub="AI refinement is currently turned off. Set up a provider on the AI tab to unlock styles."
        />
        <div className="locked">
          <div className="lock-banner">
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--accent)", color: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <LockSolidIcon style={{ width: 22, height: 22 }} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Styles need an AI provider</div>
              <div style={{ fontSize: 12.5, color: "oklch(75% 0.008 85)", marginTop: 4 }}>Add a Gemini, OpenAI, or Claude key on the AI tab to enable refinement.</div>
            </div>
          </div>
          <div style={{ filter: "saturate(0.4)", opacity: 0.7, pointerEvents: "none" }}>{body}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHead
        eyebrow="Style"
        title={<>Refine your <em>words</em>.</>}
        sub="Pick how OpenDicta should reshape your raw transcript after you stop speaking."
      >
        <div className="chip chip-accent"><SparkleIcon style={{ width: 12, height: 12 }} /> AI is on</div>
      </PageHead>
      {body}
    </div>
  );
}

function StylePreview({ style }: { style: string }) {
  const samples: Record<string, React.ReactNode> = {
    raw: <pre style={{ margin: 0, fontFamily: "Geist Mono, ui-monospace, monospace", fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>uh so today i'm gonna work on the transcript editor we talked about yesterday um and i also need to follow up with mark about the latency thing and oh yeah send the design review notes to the team before standup tomorrow</pre>,
    grammar: <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6 }}>Today I'm going to work on the transcript editor we talked about yesterday. I also need to follow up with Mark about the latency thing, and send the design review notes to the team before standup tomorrow.</p>,
    email: <div style={{ fontSize: 13, lineHeight: 1.55 }}>
      <div style={{ color: "var(--ink-3)", marginBottom: 6 }}><b style={{ color: "var(--ink-1)" }}>Subject:</b> Today's focus + 2 follow-ups</div>
      <div>Hi team,</div>
      <div style={{ marginTop: 8 }}>Heads-up on today: I'll be focused on the transcript editor we discussed yesterday. Two follow-ups on my plate — checking in with Mark on latency, and getting the design review notes out before standup tomorrow.</div>
      <div style={{ marginTop: 8 }}>Best,<br />Alex</div>
    </div>,
    prompt: <pre style={{ margin: 0, fontFamily: "Geist Mono, ui-monospace, monospace", fontSize: 11.5, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{`# Role\nYou are a project planning assistant.\n\n# Context\n- Working on the transcript editor (carried over)\n- Open thread with Mark re: model latency\n- Design review notes pending\n\n# Task\nDraft a one-line standup update covering today's focus and the two outstanding items.`}</pre>,
    pro: <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
      <div style={{ color: "var(--ink-1)", fontWeight: 600 }}>Summary</div>
      <div style={{ color: "var(--ink-2)", marginTop: 4 }}>Focus today is the transcript editor. Two outstanding items: a latency check-in with Mark, and design review notes due before tomorrow's standup.</div>
      <div style={{ color: "var(--ink-1)", fontWeight: 600, marginTop: 10 }}>Action items</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
        {["Ship transcript editor work", "Follow up with Mark on latency", "Send design review notes before standup"].map((t, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <span style={{ width: 14, height: 14, border: "1.2px solid var(--ink-3)", borderRadius: 3, flexShrink: 0, marginTop: 2 }} />
            <span>{t}</span>
          </div>
        ))}
      </div>
    </div>,
    bullets: <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.65 }}>
      <li>Work on the transcript editor</li>
      <li>Follow up with Mark on latency</li>
      <li>Send design review notes before standup</li>
    </ul>,
    chat: <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55 }}>heads up — heads-down on the transcript editor today 🎙️ also: pinging mark re: latency, and design review notes going out before standup tomorrow ✅</p>,
    summary: <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6 }}>Working on the transcript editor today, plus following up with Mark on latency and getting design notes out before tomorrow's standup.</p>,
  };
  return (
    <div style={{ padding: "14px 16px", background: "var(--bg-sunken)", borderRadius: 14, border: "0.5px solid var(--line)", color: "var(--ink-1)" }}>
      {samples[style] ?? samples["grammar"]}
    </div>
  );
}
