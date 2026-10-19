"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export type SheetSize = { bottom: number; right: number };

/**
 * Карточка поверх мира: нижний лист на телефоне (не выше ~45% экрана, высота по содержимому),
 * панель справа на десктопе. Кнопка «×» всегда поверх шапки. Сообщает миру свой размер,
 * чтобы камера держала героя в свободной области.
 */
export function QuestSheet({ label, onClose, onSize, tall = false, closeLabel = "Отойти от героя: закрыть заявку", inert = false, children }: {
  label: string;
  onClose?: () => void;
  onSize: (size: SheetSize) => void;
  /** Итог и заявка: мир не нужен для действия, карточка выше. */
  tall?: boolean;
  closeLabel?: string;
  /** Поверх карточки открыт другой диалог. */
  inert?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const report = useRef(onSize);
  useEffect(() => {
    report.current = onSize;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const wide = window.innerWidth >= 760;
      report.current(wide ? { bottom: 0, right: rect.width + 32 } : { bottom: rect.height, right: 0 });
    };
    measure();
    // Фокус внутрь диалога без прокрутки: содержимое начинается сверху.
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      report.current({ bottom: 0, right: 0 });
    };
  }, []);
  // Tab не уходит из диалога: с последнего элемента — на первый и наоборот (остальная страница inert).
  const trapTab = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
    const root = ref.current;
    if (!root) return;
    const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.checkVisibility?.() ?? true);
    if (items.length === 0) {
      event.preventDefault();
      root.focus({ preventScroll: true });
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === root)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <aside className={`qw-sheet quest-sheet${tall ? " qw-sheet-tall" : ""}`} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} ref={ref} inert={inert} onKeyDown={trapTab}>
      <div className="qw-sheet-grip" aria-hidden="true" />
      {onClose && (
        <button type="button" className="qw-sheet-close" aria-label={closeLabel} onClick={onClose}>×</button>
      )}
      <div className="qw-sheet-body">{children}</div>
    </aside>
  );
}
