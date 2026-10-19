"use client";

import { useEffect, useRef, useState } from "react";

/** `prefers-reduced-motion: reduce`. Без matchMedia (тесты, SSR) считается, что движение разрешено. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

/** Текущее время в мс, обновляется каждые `intervalMs`. Нужен только для показа таймеров. */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, active]);
  return now;
}

/**
 * Защита от повторного ответа. `lock()` вызывается в момент отправки; пока родитель держит
 * `disabled` или показан разбор, повторные нажатия игнорируются. Если отправка не удалась
 * (`disabled` снова false, разбора нет), замок снимается и игрок может повторить.
 */
export function useSubmitLock(disabled: boolean, revealed: boolean) {
  const [sent, setSent] = useState(false);
  const sentRef = useRef(false);
  const previousDisabled = useRef(disabled);

  useEffect(() => {
    if (previousDisabled.current && !disabled && !revealed) {
      sentRef.current = false;
      setSent(false);
    }
    previousDisabled.current = disabled;
  }, [disabled, revealed]);

  return {
    locked: disabled || revealed || sent,
    /** Возвращает false, если ответ уже отправлен. */
    lock(): boolean {
      if (disabled || revealed || sentRef.current) return false;
      sentRef.current = true;
      setSent(true);
      return true;
    }
  };
}

/** Цифры 1–9 как быстрые клавиши выбора карточки. Не срабатывает в полях ввода и с модификаторами. */
export function useDigitKeys(enabled: boolean, count: number, onDigit: (index: number) => void) {
  const handler = useRef(onDigit);
  useEffect(() => {
    handler.current = onDigit;
  });
  useEffect(() => {
    if (!enabled) return;
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const index = Number.parseInt(event.key, 10) - 1;
      if (Number.isInteger(index) && index >= 0 && index < count) {
        event.preventDefault();
        handler.current(index);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, count]);
}
