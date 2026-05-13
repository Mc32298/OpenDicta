import type { ButtonHTMLAttributes, ReactNode } from "react";

export type NoticeTone = "info" | "ok" | "err" | "warn";
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  busy?: boolean;
  busyLabel?: string;
};

export function Button({ variant = "secondary", busy = false, busyLabel, disabled, children, className = "", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      className={`wv-btn wv-btn--${variant} ${className}`.trim()}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? (busyLabel ?? "Working...") : children}
    </button>
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  variant?: ButtonVariant;
};

export function IconButton({ label, variant = "ghost", children, className = "", ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`wv-icon-btn wv-icon-btn--${variant} ${className}`.trim()}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}

export function ToggleSwitch({ on, onToggle, disabled, label }: { on: boolean; onToggle: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      className="wv-switch"
      data-on={on ? "1" : "0"}
      onClick={onToggle}
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
    >
      <span className="wv-switch-knob" />
    </button>
  );
}

export function Notice({ tone = "info", children }: { tone?: NoticeTone; children: ReactNode }) {
  if (!children) return null;
  return <div className="wv-notice" data-tone={tone}>{children}</div>;
}

export function StatusBadge({ tone = "info", children }: { tone?: NoticeTone; children: ReactNode }) {
  return <span className="wv-status-badge" data-tone={tone}>{children}</span>;
}

export function SettingsSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="wv-group">
      {title && <div className="wv-group-title">{title}</div>}
      <div className="wv-group-card">{children}</div>
    </section>
  );
}

export function SettingsRow({ label, hint, children, last }: { label: string; hint?: ReactNode; children?: ReactNode; last?: boolean }) {
  return (
    <div className="wv-row" data-last={last ? "1" : "0"}>
      <div className="wv-row-label">
        <div>{label}</div>
        {hint && <div className="wv-row-hint">{hint}</div>}
      </div>
      <div className="wv-row-control">{children}</div>
    </div>
  );
}
