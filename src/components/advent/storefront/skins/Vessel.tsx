import { useId } from "react";

import type { Facade } from "@/config/facade";

/** Цвета слоёв чередуются по токенам бренда; пустой слой — пунктирный контур, поэтому состояние слоя читается и без цвета. */
export const LAYER_COLORS = ["var(--gold)", "var(--coral)", "var(--cyan)", "var(--green)", "var(--amber)", "var(--ice)"] as const;

export type VesselLayer = { filled: boolean; verdict: "right" | "wrong" | null };

type Props = { kind: Facade["vessel"]; layers: VesselLayer[] };

const W = 120;
const H = 150;

/**
 * Ёмкость задания «собери»: чашка с паром (кофейня), коробка или стопка. Слои — полосы снизу вверх по числу слотов.
 * Чисто визуальный элемент: смысл для скринридера даёт список слоёв рядом (легенда), сам рисунок `aria-hidden`.
 */
export function Vessel({ kind, layers }: Props) {
  const clip = `ves-${useId().replace(/:/g, "")}`;
  const count = Math.max(1, layers.length);
  const region = kind === "cup" ? { x: 20, y: 44, w: 80, h: 76 } : kind === "box" ? { x: 16, y: 42, w: 88, h: 84 } : { x: 14, y: 30, w: 92, h: 98 };
  const gap = kind === "stack" ? 4 : 0;
  const bandH = (region.h - gap * (count - 1)) / count;

  return (
    <svg className="adv-vessel" data-kind={kind} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
      <defs>
        {kind === "cup" && (
          <clipPath id={clip}>
            <path d="M20 44h80l-10 76a8 8 0 0 1-8 7H38a8 8 0 0 1-8-7z" />
          </clipPath>
        )}
        {kind === "box" && (
          <clipPath id={clip}>
            <rect x="16" y="42" width="88" height="84" rx="6" />
          </clipPath>
        )}
      </defs>
      {kind === "cup" && (
        <g className="adv-steam">
          <path d="M44 34c-6-7 6-10 0-18" />
          <path d="M60 34c-6-7 6-10 0-18" />
          <path d="M76 34c-6-7 6-10 0-18" />
        </g>
      )}
      {kind === "cup" && (
        <>
          <ellipse className="adv-vessel-saucer" cx="60" cy="136" rx="46" ry="8" />
          <path className="adv-vessel-handle" d="M96 56h8a12 12 0 0 1 0 28h-12" />
          <path className="adv-vessel-body" d="M20 44h80l-10 76a8 8 0 0 1-8 7H38a8 8 0 0 1-8-7z" />
        </>
      )}
      {kind === "box" && (
        <>
          <ellipse className="adv-vessel-saucer" cx="60" cy="134" rx="50" ry="7" />
          <rect className="adv-vessel-body" x="16" y="42" width="88" height="84" rx="6" />
        </>
      )}
      {kind === "stack" && <rect className="adv-vessel-saucer" x="8" y="130" width="104" height="9" rx="4" />}
      <g clipPath={kind === "stack" ? undefined : `url(#${clip})`}>
        {layers.map((layer, index) => {
          // Слой 0 — нижний.
          const y = region.y + region.h - (index + 1) * bandH - index * gap;
          return (
            <rect
              key={index}
              className={`adv-layer${layer.filled ? " filled" : ""}${layer.verdict ? ` ${layer.verdict}` : ""}`}
              x={region.x}
              y={y}
              width={region.w}
              height={bandH}
              rx={kind === "stack" ? 5 : 0}
              style={layer.filled ? { fill: LAYER_COLORS[index % LAYER_COLORS.length] } : undefined}
              data-layer={index + 1}
            />
          );
        })}
      </g>
      {kind === "cup" && <path className="adv-vessel-rim" d="M20 44h80" />}
      {kind === "box" && (
        <>
          <rect className="adv-vessel-ribbon" x="54" y="42" width="12" height="84" />
          <path className="adv-vessel-rim" d="M16 42h88" />
        </>
      )}
    </svg>
  );
}
