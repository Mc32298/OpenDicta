import type { ReactNode } from "react";

export default function PageHead({
  eyebrow,
  title,
  sub,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="page-eyebrow">{eyebrow}</div>
        <h1 className="page-title">{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {children && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>{children}</div>
      )}
    </div>
  );
}
