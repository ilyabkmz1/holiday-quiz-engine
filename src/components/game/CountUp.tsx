"use client";

import { useEffect, useRef, useState } from "react";

import { usePrefersReducedMotion } from "@/components/game/hooks";

/**
 * Число «набегает» от прежнего значения к новому (requestAnimationFrame, ~0.8 с).
 * Только для визуального показа: родитель обязан дать скринридеру итоговое значение отдельно.
 */
export function CountUp({ value, format = String, duration = 800, from }: { value: number; format?: (value: number) => string; duration?: number; from?: number }) {
  const reduced = usePrefersReducedMotion();
  const previous = useRef(from ?? value);
  const [shown, setShown] = useState(from ?? value);

  useEffect(() => {
    const start = previous.current;
    previous.current = value;
    if (reduced || start === value) {
      setShown(value);
      return;
    }
    let frame = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced, duration]);

  return <>{format(shown)}</>;
}
