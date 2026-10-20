import type { CSSProperties } from "react";

const PATHS = {
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z M12 14.5v2.5",
  star: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  replay: "M4 12a8 8 0 1 0 2.6-5.9M4 4v4.5h4.5 M12 8v4.5l3 1.8",
  cross: "M6 6l12 12M18 6L6 18",
  gift: "M4 10h16v10H4z M3 7h18v3H3z M12 7v13 M12 7c-1-3-5-3.5-5-1.2C7 7 9 7 12 7zm0 0c1-3 5-3.5 5-1.2C17 7 15 7 12 7z",
  snow: "M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9 M9.5 4.7L12 7l2.5-2.3 M9.5 19.3L12 17l2.5 2.3",
  copy: "M8 8h11v12H8z M5 16V4h11",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  close: "M6 6l12 12M18 6L6 18",
  flame: "M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4.2.2 1.3.8 2 1.6 2.4C10.4 8 10.8 5.2 12 3z",
  mail: "M4 6h16v12H4z M4 7l8 6 8-6",
  share: "M12 4v11M7.5 8.5L12 4l4.5 4.5 M5 13v7h14v-7",
  trophy: "M8 4h8v5a4 4 0 0 1-8 0z M8 6H4.5c0 3 1.5 4.5 3.5 5 M16 6h3.5c0 3-1.5 4.5-3.5 5 M12 13v4 M8.5 20h7M9.5 17h5",
  back: "M15 5l-7 7 7 7",
  next: "M9 5l7 7-7 7",
  // Значки наград открытого окна «Витрины» (`REWARD_ICONS`).
  cup: "M5 10h11v4.5A4.5 4.5 0 0 1 11.5 19h-2A4.5 4.5 0 0 1 5 14.5z M16 11h1.5a2.5 2.5 0 0 1 0 5H15.6 M8 3.5c0 1.4 1.2 1.4 1.2 2.8 M12 3.5c0 1.4 1.2 1.4 1.2 2.8",
  pastry: "M3 16c.6-5.4 4.4-9 9-9s8.4 3.6 9 9c-1.6.6-3.2.2-4.2-1.2-1 1.7-2.8 2.1-4.8 1.7-2 .4-3.8 0-4.8-1.7C6.2 16.2 4.6 16.6 3 16z M9 8.4l1.4 4.6 M15 8.4l-1.4 4.6",
  percent: "M18 6L6 18 M9.2 7.6a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0z M18 16.4a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0z",
  recipe: "M6 3h9l3 3v15H6z M9 10h6 M9 14h6 M9 18h4",
  ticket: "M3 8h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z M14.5 8.5v2 M14.5 12.5v2 M14.5 16v1.5",
  leaf: "M5 19c0-8.4 5-13.4 14-14.4 0 9-5 14.4-13 14.4z M5 19c3.2-4.4 6.4-6.6 9.6-7.6",
  sparkle: "M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8z M19 3v3 M17.5 4.5h3",
  book: "M4 5h6a2.4 2.4 0 0 1 2 1v13.4a2.4 2.4 0 0 0-2-1H4z M20 5h-6a2.4 2.4 0 0 0-2 1v13.4a2.4 2.4 0 0 1 2-1h6z"
} as const;

export type IconName = keyof typeof PATHS;

/** Контурная иконка 24×24 цвета текста. Декор: скринридеру нужна подпись рядом, поэтому `aria-hidden`. */
export function AdventIcon({ name, size = 22, strokeWidth = 1.9, className, style }: { name: IconName; size?: number; strokeWidth?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
