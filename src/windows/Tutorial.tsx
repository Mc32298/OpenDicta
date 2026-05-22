import { useState, type ReactNode } from "react";
import { Button } from "../ui/controls";

type TourStep = {
  id: string;
  title: string;
  body: string;
  Visual: () => ReactNode;
  imageSrc?: string;
};

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

export default function Tutorial({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const step = TOUR_STEPS[i];
  const last = i === TOUR_STEPS.length - 1;
  const Visual = step.Visual;

  return (
    <div className="wv-tour">
      <button type="button" className="wv-btn wv-btn-ghost wv-tour-skip" onClick={onDone}>
        Skip tour
      </button>

      <div className="wv-tour-stage" key={step.id}>
        {step.imageSrc ? (
          <img className="wv-tour-img" src={step.imageSrc} alt={step.title} />
        ) : (
          <Visual />
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

function DictationVisual() {
  return (
    <div className="wv-tv wv-tv-dictation">
      <span className="wv-tv-key">Ctrl</span>
      <div className="wv-tv-wave">
        {[0, 1, 2, 3, 4, 5, 6].map((n) => (
          <span key={n} style={{ animationDelay: `${n * 0.09}s` }} />
        ))}
      </div>
      <div className="wv-tv-line" />
    </div>
  );
}

function ToolbarVisual() {
  return (
    <div className="wv-tv wv-tv-toolbar">
      <div className="wv-tv-pill">
        <span className="wv-tv-rec" />
        <span className="wv-tv-bar" />
        <span className="wv-tv-bar" />
        <span className="wv-tv-dot" />
      </div>
    </div>
  );
}

function ModelsVisual() {
  return (
    <div className="wv-tv wv-tv-models">
      <div className="wv-tv-chip">Parakeet</div>
      <div className="wv-tv-chip is-active">Whisper</div>
      <div className="wv-tv-chip">Custom</div>
    </div>
  );
}

function AiVisual() {
  return (
    <div className="wv-tv wv-tv-ai">
      <div className="wv-tv-raw">um, so like, the report is, uh, done</div>
      <div className="wv-tv-arrow">→</div>
      <div className="wv-tv-clean">The report is done. <span className="wv-tv-spark">✦</span></div>
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
    <div className="wv-tv wv-tv-wrap">
      <div className="wv-tv-check">✓</div>
    </div>
  );
}
