import { useState, type ReactNode } from "react";
import { Button } from "../ui/controls";
import { DEFAULT_SHORTCUT } from "../lib/shortcutUtils";

type Shortcuts = { record: string; quickSwitcher: string };
type VisualProps = { shortcuts: Shortcuts };

const DEFAULT_SHORTCUTS: Shortcuts = {
  record: DEFAULT_SHORTCUT,
  quickSwitcher: "Ctrl+Shift+Space",
};

type TourStep = {
  id: string;
  title: string;
  body: string;
  // Functions with fewer params are assignable here — unused visuals can omit the arg.
  Visual: (p: VisualProps) => ReactNode;
  imageSrc?: string;
};

function DictationVisual({ shortcuts }: VisualProps) {
  return (
    <div className="wv-tv">
      <span className="wv-tv-key">{shortcuts.record}</span>
      <div className="wv-tv-wave">
        {[0, 1, 2, 3, 4, 5, 6].map((n) => (
          <span key={n} style={{ animationDelay: `${n * 0.09}s` }} />
        ))}
      </div>
      <div className="wv-tv-line" />
    </div>
  );
}

function ToolbarVisual({ shortcuts }: VisualProps) {
  return (
    <div className="wv-tv" style={{ flexDirection: "column", gap: 18 }}>
      <div className="wv-tv-quick">
        <div className="wv-tv-quick-search">Switch model or style...</div>
        <div className="wv-tv-quick-list">
          <div className="wv-tv-quick-item wv-tv-quick-item-on">
            <span className="wv-tv-quick-name">
              Parakeet V3
              <span className="wv-tv-quick-active">active</span>
            </span>
            <span className="wv-tv-quick-kind">model</span>
          </div>
          <div className="wv-tv-quick-item">
            <span className="wv-tv-quick-name">
              Raw transcript
              <span className="wv-tv-quick-active">active</span>
            </span>
            <span className="wv-tv-quick-kind">style</span>
          </div>
          {[
            "Fix grammar",
            "Email",
            "Prompt engineering",
            "Professional + todo",
            "Bullet points",
            "Slack message",
            "TL;DR summary",
          ].map((name) => (
            <div key={name} className="wv-tv-quick-item">
              <span className="wv-tv-quick-name">{name}</span>
              <span className="wv-tv-quick-kind">style</span>
            </div>
          ))}
        </div>
      </div>
      <span className="wv-tv-key">{shortcuts.quickSwitcher}</span>
    </div>
  );
}

function ModelsVisual() {
  return (
    <div className="wv-tv wv-tv-models">
      <div className="wv-tv-chip is-active">Parakeet</div>
      <div className="wv-tv-chip">Whisper</div>
      <div className="wv-tv-chip">Custom</div>
    </div>
  );
}

function AiVisual() {
  return (
    <div className="wv-tv wv-tv-ai">
      <div className="wv-tv-ai-source">
        <div className="wv-tv-ai-label">You spoke</div>
        <div className="wv-tv-raw">
          uh so today i'm gonna work on the transcript editor we talked about
          yesterday and i need to follow up with mark about latency and send the
          design review notes before standup tomorrow
        </div>
      </div>
      <div className="wv-tv-ai-scroll">
        <div className="wv-tv-ai-grid">
          <div className="wv-tv-ai-card">
            <div className="wv-tv-ai-card-title">Fix grammar</div>
            <div className="wv-tv-clean">Today I&apos;m working on the transcript editor, following up with Mark about latency, and sending the design review notes before tomorrow&apos;s standup. <span className="wv-tv-spark">✦</span></div>
          </div>
          <div className="wv-tv-ai-card">
            <div className="wv-tv-ai-card-title">Bullet points</div>
            <ul className="wv-tv-ai-list">
              <li>Work on the transcript editor</li>
              <li>Follow up with Mark on latency</li>
              <li>Send design review notes before standup</li>
            </ul>
          </div>
          <div className="wv-tv-ai-card">
            <div className="wv-tv-ai-card-title">Email</div>
            <div className="wv-tv-clean">
              Subject: Transcript editor update
              {"\n\n"}
              Hi team, I&apos;m working on the transcript editor today, following up with Mark on latency, and sending design review notes before standup tomorrow.
            </div>
          </div>
          <div className="wv-tv-ai-card">
            <div className="wv-tv-ai-card-title">Prompt engineering</div>
            <div className="wv-tv-clean">
              Prompt:
              {"\n"}
              Summarize the latency issue, list blockers, and suggest the next two engineering steps.
            </div>
          </div>
          <div className="wv-tv-ai-card">
            <div className="wv-tv-ai-card-title">Slack message</div>
            <div className="wv-tv-clean">
              Heads-up: I&apos;m on the transcript editor today. I&apos;ll ping Mark about latency and send the design notes before standup. ✅
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InsightsVisual() {
  return (
    <div className="wv-tv wv-tv-insights">
      {[40, 65, 50, 80, 95].map((h, n) => (
        <span key={n} style={{ height: `${h}%`, animationDelay: `${n * 0.08}s` }} />
      ))}
    </div>
  );
}

function WrapVisual() {
  return (
    <div className="wv-tv">
      <div className="wv-tv-check">✓</div>
    </div>
  );
}

const TOUR_STEPS: TourStep[] = [
  {
    id: "dictation",
    title: "How dictation works",
    body: "Hold or press your shortcut, speak, and OpenDicta transcribes locally and pastes the text straight into whatever app you're using.",
    Visual: DictationVisual,
  },
  {
    id: "toolbar",
    title: "The quick toolbar",
    body: "A small floating bar shows recording state and quick actions. Open the Quick-switch palette to jump between models and styles without leaving your keyboard.",
    Visual: ToolbarVisual,
  },
  {
    id: "models",
    title: "Changing models",
    body: "Switch transcription models any time from the Models page or the Quick-switch palette. The installed model runs fully on-device.",
    Visual: ModelsVisual,
  },
  {
    id: "ai",
    title: "AI features",
    body: "Turn raw speech into clean text. The AI page lets you auto-format, remove filler, and apply custom styles to your dictation.",
    Visual: AiVisual,
  },
  {
    id: "insights",
    title: "Insights",
    body: "See how much time you've saved versus typing, your word counts, and usage trends over time on the Insights page.",
    Visual: InsightsVisual,
  },
  {
    id: "wrap",
    title: "You're all set",
    body: "Everything lives in Settings, and you can replay this tour any time from there. Press your shortcut and start speaking.",
    Visual: WrapVisual,
  },
];

export default function Tutorial({
  onDone,
  shortcuts = DEFAULT_SHORTCUTS,
}: {
  onDone: () => void;
  shortcuts?: Shortcuts;
}) {
  const [i, setI] = useState(0);
  const step = TOUR_STEPS[i];
  const last = i === TOUR_STEPS.length - 1;
  const Visual = step.Visual;

  return (
    <div className="wv-tour">
      <div className="wv-tour-stage" key={step.id}>
        {step.imageSrc ? (
          <img className="wv-tour-img" src={step.imageSrc} alt={step.title} />
        ) : (
          <Visual shortcuts={shortcuts} />
        )}
      </div>

      <div className="wv-tour-copy">
        <div className="wv-onboarding-step">Step {i + 1} of {TOUR_STEPS.length}</div>
        <h1>{step.title}</h1>
        <p>{step.body}</p>
      </div>

      <div className="wv-tour-foot">
        <div className="wv-tour-dots">
          {TOUR_STEPS.map((s, n) => (
            <span key={s.id} className="wv-tour-dot" data-on={n === i ? "1" : "0"} />
          ))}
        </div>
        <div className="wv-tour-nav">
          <Button variant="ghost" className="wv-tour-skip" onClick={onDone}>Skip tour</Button>
          <Button variant="ghost" disabled={i === 0} onClick={() => setI((n) => Math.max(0, n - 1))}>
            Back
          </Button>
          <Button
            variant="primary"
            onClick={() => (last ? onDone() : setI((n) => Math.min(TOUR_STEPS.length - 1, n + 1)))}
          >
            {last ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}
