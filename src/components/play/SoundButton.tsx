"use client";

import { useSound } from "@/components/play/sound";

/** Кнопка звука в HUD: переключатель музыки и эффектов, выбор запоминается. */
export function SoundButton() {
  const { enabled, toggle } = useSound();
  return (
    <button type="button" className="pill pill-btn qw-sound" aria-pressed={enabled} aria-label="Звук" title={enabled ? "Звук включён" : "Звук выключен"} onClick={toggle}>
      <span aria-hidden="true">{enabled ? "🔊" : "🔇"}</span>
    </button>
  );
}
