"use client";

import { useRef, useState } from "react";

/** Кнопка «Скопировать» для ссылки или текста поста. Если буфер недоступен, выделяет текст в соседнем поле. */
export function CopyLink({ value, label = "Скопировать" }: { value: string; label?: string }) {
  const [done, setDone] = useState<"ok" | "fail" | null>(null);
  const timer = useRef<number | null>(null);

  async function copy() {
    let result: "ok" | "fail" = "ok";
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      result = "fail";
    }
    setDone(result);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(null), 2400);
  }

  return (
    <>
      <button type="button" className="admin-button" onClick={() => void copy()}>{label}</button>
      <span role="status" aria-live="polite" className="admin-note">{done === "ok" ? " Скопировано" : done === "fail" ? " Не удалось: выделите и скопируйте вручную" : ""}</span>
    </>
  );
}
