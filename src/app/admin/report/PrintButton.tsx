"use client";

/** «Сохранить в PDF»: диалог печати браузера (там «Сохранить как PDF»); в самой печати кнопка скрыта. */
export function PrintButton() {
  return (
    <button type="button" className="admin-button no-print" onClick={() => window.print()}>
      Сохранить в PDF
    </button>
  );
}
