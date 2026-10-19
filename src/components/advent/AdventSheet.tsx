"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

import { AdventIcon } from "@/components/advent/icons";

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Нижний лист на телефоне и панель справа на десктопе (как `QuestSheet`, но без мира под ним): модальный диалог.
 * Фокус заходит внутрь и не уходит из листа по Tab, Escape и кнопка «×» закрывают, прокрутка страницы под листом отключена.
 * Классы `quest-sheet` дают механикам заданий их плоскую вёрстку внутри карточки.
 */
export function AdventSheet({ label, closeLabel, onClose, children }: { label: string; closeLabel: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
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
  }

  return (
    <>
      <div className="adv-scrim" aria-hidden="true" onClick={onClose} />
      <aside className="adv-sheet quest-sheet" tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} ref={ref} onKeyDown={onKeyDown}>
        <div className="adv-sheet-grip" aria-hidden="true" />
        <button type="button" className="adv-sheet-close" aria-label={closeLabel} onClick={onClose}>
          <AdventIcon name="close" size={20} />
        </button>
        <div className="adv-sheet-body">{children}</div>
      </aside>
    </>
  );
}
