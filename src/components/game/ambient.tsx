import type { CSSProperties, ReactNode } from "react";

import type { LightSet as LightSetData } from "@/worlds/world";

/**
 * Живой декор поверх иллюстраций: снег и мерцающие огоньки.
 * Только CSS-анимации (transform/opacity), всё `aria-hidden`.
 * Координаты огней (из `world.json`) — в процентах от размеров иллюстрации (соотношение 3:2), поэтому
 * совпадают с картинкой при любом масштабе: слой `.art-layer` имеет то же
 * соотношение сторон и повторяет `object-fit: cover`.
 */

type Vars = CSSProperties & Record<`--${string}`, string | number>;

/** Детерминированно (без Math.random), чтобы сервер и клиент рисовали одно и то же. */
function flakes(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    x: (i * 37 + (i % 3) * 11) % 97,
    s: 2 + ((i * 5) % 4) * 0.8,
    o: 0.45 + ((i * 3) % 5) / 10,
    d: 7 + ((i * 7) % 9),
    delay: -((i * 1.7) % 11),
    dx: ((i % 5) - 2) * 14,
    sw: 2.6 + (i % 4) * 0.7,
    sa: 5 + (i % 4) * 3
  }));
}

/** Падающий снег: мягкий, разного размера и скорости, с лёгким дрейфом. */
export function Snow({ count = 16, className = "" }: { count?: number; className?: string }) {
  return (
    <div className={`snowfall ${className}`.trim()} aria-hidden="true">
      {flakes(count).map((f, i) => (
        <span
          key={i}
          className="flake"
          style={{ "--x": `${f.x}%`, "--s": `${f.s}px`, "--o": f.o, "--dx": `${f.dx}px`, "--sw": `${f.sw}s`, "--sa": `${f.sa}px`, animationDuration: `${f.d}s`, animationDelay: `${f.delay}s` } as Vars}
        />
      ))}
    </div>
  );
}

export type LampPoint = readonly [x: number, y: number];

/** Огни одной иллюстрации (мир или зона): координаты лежат в `world.json`. */
export type LightSet = LightSetData;

/**
 * Слой огней в координатах иллюстрации. `progress` 0..1 — сколько ламп «живых»:
 * остальные тускло горят без мерцания, а свечение ёлки и размер огней растут.
 * `wave` — огни разгораются волной слева направо (финал).
 */
export function Lights({ set, progress = 1, wave = false, halo }: { set: LightSet; progress?: number; wave?: boolean; halo?: LampPoint }) {
  const p = Math.max(0, Math.min(1, progress));
  const liveGarland = Math.max(Math.min(3, set.garland.length), Math.round(set.garland.length * (0.3 + 0.7 * p)));
  const liveTree = Math.max(2, Math.round(set.tree.length * (0.25 + 0.75 * p)));
  const lamp = (pt: LampPoint, i: number, live: boolean, kind: string) => {
    const style: Vars = {
      left: `${pt[0]}%`,
      top: `${pt[1]}%`,
      "--t": `${1.7 + ((i * 7) % 9) * 0.28}s`,
      "--dl": wave ? `${(pt[0] / 100) * 2.4}s` : `${-((i * 0.83) % 3)}s`
    };
    return <i key={`${kind}${i}`} className={`lamp ${kind}${live ? "" : " off"}${wave ? " wave" : ""}`} style={style} />;
  };
  return (
    <div className="lights" aria-hidden="true" style={{ "--p": p } as Vars}>
      <i
        className="tree-glow"
        style={{ left: `${set.glow[0]}%`, top: `${set.glow[1]}%`, width: `${set.glowSize}%`, "--lo": 0.25 + 0.35 * p, "--hi": 0.55 + 0.45 * p } as Vars}
      />
      {set.garland.map((pt, i) => lamp(pt, i, i < liveGarland, "g"))}
      {set.tree.map((pt, i) => lamp(pt, i + 3, i < liveTree, "t"))}
      {halo && <i className="robot-halo" style={{ left: `${halo[0]}%`, top: `${halo[1]}%` }} />}
      <i className="star-glow" style={{ left: `${set.star[0]}%`, top: `${set.star[1]}%`, "--hi": 0.7 + 0.3 * p } as Vars} />
    </div>
  );
}

/**
 * Слой, повторяющий `object-fit: cover` картинки 3:2 внутри родителя.
 * Родитель обязан быть `position: relative` с известными размерами; контейнерные
 * единицы берутся от `.art-box` (position: absolute; inset: 0).
 */
export function ArtOverlay({ children }: { children: ReactNode }) {
  return (
    <div className="art-box" aria-hidden="true">
      <div className="art-layer">{children}</div>
    </div>
  );
}

const SPARK_COLORS = ["#ffe29a", "#62e0ff", "#ff8a7a", "#6ee7a8", "#ffffff", "#ffcb5c"];

/**
 * Салют/конфетти: вспышки в заданных центрах (проценты), по `per` искр.
 * `loop` — длительность цикла в секундах (вспышки идут по кругу со сдвигом), иначе один раз.
 */
export function Sparks({ centers, per = 8, radius = 46, loop, className = "" }: { centers: LampPoint[]; per?: number; radius?: number; loop?: number; className?: string }) {
  return (
    <div className={`sparks ${className}`.trim()} aria-hidden="true">
      {centers.flatMap((c, b) =>
        Array.from({ length: per }, (_, i) => {
          const a = (Math.PI * 2 * i) / per + b * 0.4;
          const r = radius * (0.7 + ((i * 5 + b) % 4) / 8);
          const style: Vars = {
            left: `${c[0]}%`,
            top: `${c[1]}%`,
            "--tx": `${Math.round(Math.cos(a) * r)}px`,
            "--ty": `${Math.round(Math.sin(a) * r)}px`,
            "--sc": SPARK_COLORS[(i + b) % SPARK_COLORS.length],
            animationDuration: loop ? `${loop}s` : "1.4s",
            animationDelay: `${loop ? (loop / centers.length) * b * 0.9 : b * 0.18}s`,
            animationIterationCount: loop ? "infinite" : 1
          };
          return <i key={`${b}-${i}`} className={loop ? "spark loop" : "spark"} style={style} />;
        })
      )}
    </div>
  );
}
