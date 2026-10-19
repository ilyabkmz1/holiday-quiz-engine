import type { CSSProperties } from "react";

import { ICON_PATHS as PATHS } from "@/config/icon-paths";

export function Icon({
  name,
  size = 20,
  color = "currentColor",
  strokeWidth = 1.9,
  style
}: {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <path d={PATHS[name] ?? PATHS.fallback} />
    </svg>
  );
}

/** Ёлочная игрушка комнаты: пустая (контур) или повешенная (цвет комнаты). */
export function Ornament({
  color,
  on,
  width = 26,
  label
}: {
  color: string;
  on: boolean;
  width?: number;
  label?: string;
}) {
  const height = Math.round((width * 30) / 26);
  return (
    <svg
      className={on ? "ornament on" : "ornament"}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      width={width}
      height={height}
      viewBox="0 0 26 30"
    >
      <rect x="10" y="1" width="6" height="5" rx="1.5" fill={on ? "#FFE29A" : "rgba(160,190,255,.4)"} />
      <circle
        cx="13"
        cy="17"
        r="11"
        fill={on ? color : "none"}
        stroke={on ? "#FFFFFF" : "rgba(160,190,255,.4)"}
        strokeWidth={on ? 1.2 : 1.5}
      />
      <path d="M6 15c4 3 10 3 14 0" stroke="rgba(255,255,255,.55)" strokeWidth="1.5" fill="none" />
    </svg>
  );
}
