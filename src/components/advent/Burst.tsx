import type { CSSProperties } from "react";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

const COLORS = ["var(--gold)", "var(--cyan)", "var(--coral)", "var(--green)", "var(--gold-soft)", "var(--ice)"];

/**
 * Салют из частиц на CSS (transform/opacity). Детерминированный (без `Math.random`): сервер и клиент рисуют одно и то же.
 * Без движения (`prefers-reduced-motion`) скрывается стилями; полностью декоративный.
 */
export function Burst({ count = 28, spread = 150, className = "" }: { count?: number; spread?: number; className?: string }) {
  return (
    <span className={`adv-burst ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + (i % 3) * 0.21;
        const distance = spread * (0.55 + ((i * 7) % 10) / 22);
        return (
          <i
            key={i}
            style={
              {
                "--dx": `${Math.round(Math.cos(angle) * distance)}px`,
                "--dy": `${Math.round(Math.sin(angle) * distance - spread * 0.18)}px`,
                "--rot": `${(i * 47) % 360}deg`,
                "--c": COLORS[i % COLORS.length],
                "--w": `${5 + (i % 3) * 2}px`,
                animationDelay: `${(i % 6) * 18}ms`
              } as Vars
            }
          />
        );
      })}
    </span>
  );
}
