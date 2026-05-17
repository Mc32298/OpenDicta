import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const DashboardIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <path d="M3 11.5 12 4l9 7.5" />
    <path d="M5 10.5V20h14v-9.5" />
    <path d="M10 20v-5h4v5" />
  </svg>
);

export const InsightsIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <path d="M4 19V5" />
    <path d="M4 19h16" />
    <path d="M8 15v-4" />
    <path d="M13 15V7" />
    <path d="M18 15v-6" />
  </svg>
);

export const ModelsIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" />
    <path d="M3 12.5 12 17l9-4.5" />
    <path d="M3 17.5 12 22l9-4.5" />
  </svg>
);

export const StyleIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <path d="m4 20 8-8" />
    <path d="m14 14 6-6" />
    <path d="M14 4h2v2" />
    <path d="M18 6h2v2" />
    <path d="M6 14H4v2" />
    <path d="M8 18H6v2" />
  </svg>
);

export const AIIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2.5" />
    <path d="M9 10v4M12 9v6M15 10v4" />
    <path d="M6 9H4M6 12H4M6 15H4M20 9h-2M20 12h-2M20 15h-2M9 6V4M12 6V4M15 6V4M9 20v-2M12 20v-2M15 20v-2" />
  </svg>
);

export const SettingsIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <circle cx="12" cy="12" r="2.8" />
    <path d="M19.4 14.4a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);

export const MicIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
  </svg>
);

export const SparkleIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M12 3 13.7 9 19 10.7l-5.3 1.7L12 18l-1.7-5.6L5 10.7 10.3 9 12 3Z" />
    <path d="M19 14.5 19.7 17l2.3.8-2.3.7L19 21l-.7-2.5L16 17.8l2.3-.8L19 14.5Z" opacity=".5" />
  </svg>
);

export const PlayIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M8 5.5v13l11-6.5L8 5.5Z" />
  </svg>
);

export const PauseIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <rect x="7" y="5" width="3.5" height="14" rx="1" />
    <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
  </svg>
);

export const CopyIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2.5" />
    <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
  </svg>
);

export const CheckIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} strokeWidth={2} {...p}>
    <path d="m4 12.5 5 5 11-11" />
  </svg>
);

export const BoltIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
  </svg>
);

export const ClockIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const TrophyIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" />
    <path d="M17 6h3v2a3 3 0 0 1-3 3M7 6H4v2a3 3 0 0 0 3 3" />
    <path d="M9 17h6l-1 4h-4l-1-4ZM12 13v4" />
  </svg>
);

export const WaveIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <path d="M3 12h2M7 8v8M10 5v14M13 9v6M16 6v12M19 10v4M21 12h-1" />
  </svg>
);

export const PlusIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} strokeWidth={1.8} {...p}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const SearchIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4-4" />
  </svg>
);

export const MailIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);

export const CodeIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <path d="m9 7-5 5 5 5M15 7l5 5-5 5" />
  </svg>
);

export const EditIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <path d="M4 20h4l10-10-4-4L4 16v4Z" />
    <path d="m14 6 4 4" />
  </svg>
);

export const ListIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <path d="M4 6h2M4 12h2M4 18h2" />
    <path d="M9 6h11M9 12h11M9 18h11" />
  </svg>
);

export const BriefcaseIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    <path d="M3 13h18" />
  </svg>
);

export const ChatIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
  </svg>
);

export const LockIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

export const LockSolidIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M6 10V8a6 6 0 0 1 12 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1Zm2 0h8V8a4 4 0 0 0-8 0v2Z" />
  </svg>
);

export const KeyIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <circle cx="8" cy="14" r="4" />
    <path d="m11 11 9-9M16 6l3 3M14 8l3 3" />
  </svg>
);

export const DiagnosticIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <path d="M3 12h3l2-5 4 10 2-5h7" />
  </svg>
);

export const KeyboardIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
  </svg>
);

export const PowerIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <path d="M12 3v9" />
    <path d="M7 6a8 8 0 1 0 10 0" />
  </svg>
);

export const AlertIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4M12 16h.01" />
  </svg>
);

export const XIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...stroke} {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const StopIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
  </svg>
);

// Aliases for back-compat with un-migrated windows.
export const ActivityIcon = InsightsIcon;
export const GearIcon = SettingsIcon;
