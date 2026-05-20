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

export function Notice({ tone = "info", children }: { tone?: NoticeTone; children: ReactNode }) {
  if (!children) return null;
  return <div className="wv-notice" data-tone={tone}>{children}</div>;
}

export function StatusBadge({ tone = "info", children }: { tone?: NoticeTone; children: ReactNode }) {
  return <span className="wv-status-badge" data-tone={tone}>{children}</span>;
}

