"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Звук квеста: три музыкальные темы из `public/audio` с плавными кроссфейдами по фазе игры
 * и короткие эффекты, синтезированные Web Audio API (без файлов).
 *
 * Правила: звук выключен по умолчанию; выбор игрока хранится в localStorage (с try/catch);
 * воспроизведение стартует только после действия игрока (нажатие кнопки или первый жест
 * при сохранённом «включено»); одна кнопка отключает и музыку, и эффекты.
 */

export type SoundTheme = "world" | "rush" | "finale";
export type SoundEffect = "step" | "correct" | "miss" | "lit" | "flake" | "tap" | "tick";

export const SOUND_STORAGE_KEY = "hqe-quest-sound";
export const THEME_FILES: Record<SoundTheme, string> = {
  world: "/audio/office-theme.m4a",
  rush: "/audio/midnight-rush.m4a",
  finale: "/audio/office-lights-up.m4a"
};
/** Громкость музыки (доля от максимума). */
export const MUSIC_VOLUME = 0.3;
export const FADE_MS = 1100;

export type AudioLike = {
  src: string;
  loop: boolean;
  volume: number;
  paused: boolean;
  play: () => Promise<void> | void;
  pause: () => void;
};

export type SoundEnv = {
  createAudio: (src: string) => AudioLike;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  /** Синтез эффекта; `null` — Web Audio недоступен. */
  synth: ((effect: SoundEffect, volume: number) => void) | null;
  /** Подписка на первый жест игрока: возвращает отписку. */
  onFirstGesture: (callback: () => void) => () => void;
  now: () => number;
  /** Шаг сглаживания громкости; возвращает отмену. Не rAF: в фоновой вкладке он замирает, а таймер идёт. */
  schedule: (callback: () => void) => () => void;
  /** Вкладка скрыта или снова видна: возвращает отписку. Без поддержки музыка играла бы в фоне. */
  onVisibility?: (callback: (hidden: boolean) => void) => () => void;
};

/** Период шагов сглаживания громкости, мс. */
export const FADE_STEP_MS = 50;

export type SoundSnapshot = { enabled: boolean; theme: SoundTheme | null };

export class SoundController {
  private enabled = false;
  private started = false;
  private hidden = false;
  private theme: SoundTheme | null = null;
  private readonly audios = new Map<SoundTheme, AudioLike>();
  private readonly levels = new Map<SoundTheme, { from: number; to: number; at: number }>();
  private cancelStep: (() => void) | null = null;
  private cancelGesture: (() => void) | null = null;
  private listeners = new Set<() => void>();
  private snapshot: SoundSnapshot = { enabled: false, theme: null };

  constructor(private readonly env: SoundEnv) {
    let stored: string | null = null;
    try {
      stored = env.storage?.getItem(SOUND_STORAGE_KEY) ?? null;
    } catch {
      stored = null;
    }
    if (stored === "on") {
      this.enabled = true;
      // Браузер не даст играть без жеста: запускаем на первом жесте игрока.
      this.cancelGesture = env.onFirstGesture(() => {
        this.cancelGesture = null;
        if (this.enabled) this.start();
      });
    }
    env.onVisibility?.((hidden) => this.setHidden(hidden));
    this.refresh();
  }

  /** Фоновая вкладка: музыка на паузе, возвращение — музыка с того же места и плавный выход на громкость. */
  private setHidden(hidden: boolean) {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (hidden) {
      this.cancelStep?.();
      this.cancelStep = null;
      for (const audio of this.audios.values()) if (!audio.paused) audio.pause();
    } else if (this.enabled && this.started) {
      this.retarget();
    }
  }

  private refresh() {
    this.snapshot = { enabled: this.enabled, theme: this.theme };
    this.listeners.forEach((listener) => listener());
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  /** Включить или выключить звук. Вызывать из обработчика нажатия: это и есть жест игрока. */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    try {
      this.env.storage?.setItem(SOUND_STORAGE_KEY, enabled ? "on" : "off");
    } catch {
      // Хранилище недоступно: выбор действует до перезагрузки.
    }
    this.cancelGesture?.();
    this.cancelGesture = null;
    if (enabled) this.start();
    else this.silence();
    this.refresh();
  }

  toggle() {
    this.setEnabled(!this.enabled);
  }

  isEnabled() {
    return this.enabled;
  }

  /** Тема по фазе игры; кроссфейд. До включения звука только запоминается. */
  setTheme(theme: SoundTheme | null) {
    if (theme === this.theme) return;
    this.theme = theme;
    if (this.enabled && this.started) this.retarget();
    this.refresh();
  }

  effect(effect: SoundEffect) {
    if (!this.enabled || !this.started || this.hidden) return;
    try {
      this.env.synth?.(effect, MUSIC_VOLUME);
    } catch {
      // Эффект не критичен.
    }
  }

  private start() {
    this.started = true;
    this.retarget();
  }

  private audioFor(theme: SoundTheme): AudioLike | null {
    let audio = this.audios.get(theme) ?? null;
    if (!audio) {
      try {
        audio = this.env.createAudio(THEME_FILES[theme]);
      } catch {
        return null;
      }
      audio.loop = true;
      audio.volume = 0;
      this.audios.set(theme, audio);
    }
    return audio;
  }

  private retarget() {
    const at = this.env.now();
    for (const theme of Object.keys(THEME_FILES) as SoundTheme[]) {
      const want = this.enabled && theme === this.theme ? MUSIC_VOLUME : 0;
      const audio = want > 0 ? this.audioFor(theme) : (this.audios.get(theme) ?? null);
      if (!audio) continue;
      this.levels.set(theme, { from: audio.volume, to: want, at });
      if (want > 0 && audio.paused && !this.hidden) {
        try {
          void Promise.resolve(audio.play()).catch(() => undefined);
        } catch {
          // Браузер отклонил запуск: попробуем на следующем жесте.
        }
      }
    }
    if (!this.hidden) this.step();
  }

  private step = () => {
    this.cancelStep?.();
    this.cancelStep = null;
    const now = this.env.now();
    let active = false;
    for (const [theme, level] of this.levels) {
      const audio = this.audios.get(theme);
      if (!audio) continue;
      const t = Math.min(1, (now - level.at) / FADE_MS);
      audio.volume = Math.max(0, Math.min(1, level.from + (level.to - level.from) * t));
      if (t < 1) active = true;
      else if (level.to === 0 && !audio.paused) audio.pause();
    }
    if (active) this.cancelStep = this.env.schedule(this.step);
  };

  private silence() {
    this.cancelStep?.();
    this.cancelStep = null;
    for (const audio of this.audios.values()) {
      audio.volume = 0;
      audio.pause();
    }
    this.levels.clear();
  }
}

// ——— Синтез эффектов (Web Audio) ———

type Note = { freq: number; at: number; length: number; type?: OscillatorType; gain?: number; slideTo?: number };

const EFFECTS: Record<SoundEffect, Note[]> = {
  step: [{ freq: 130, at: 0, length: 0.05, type: "triangle", gain: 0.5 }],
  tap: [{ freq: 520, at: 0, length: 0.06, type: "sine", gain: 0.6 }],
  tick: [{ freq: 880, at: 0, length: 0.04, type: "square", gain: 0.25 }],
  flake: [
    { freq: 1320, at: 0, length: 0.09, type: "sine", gain: 0.5 },
    { freq: 1760, at: 0.05, length: 0.12, type: "sine", gain: 0.4 }
  ],
  correct: [
    { freq: 660, at: 0, length: 0.12, type: "triangle", gain: 0.7 },
    { freq: 880, at: 0.1, length: 0.2, type: "triangle", gain: 0.7 }
  ],
  miss: [{ freq: 220, at: 0, length: 0.28, type: "sawtooth", gain: 0.45, slideTo: 140 }],
  lit: [
    { freq: 523, at: 0, length: 0.2, type: "triangle", gain: 0.6 },
    { freq: 659, at: 0.12, length: 0.2, type: "triangle", gain: 0.6 },
    { freq: 784, at: 0.24, length: 0.2, type: "triangle", gain: 0.6 },
    { freq: 1047, at: 0.36, length: 0.5, type: "sine", gain: 0.7 }
  ]
};

function browserSynth(): SoundEnv["synth"] {
  const Ctx: typeof AudioContext | undefined =
    typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctx) return null;
  let context: AudioContext | null = null;
  return (effect, volume) => {
    context ??= new Ctx();
    if (context.state === "suspended") void context.resume();
    const start = context.currentTime;
    for (const note of EFFECTS[effect]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = note.type ?? "sine";
      oscillator.frequency.setValueAtTime(note.freq, start + note.at);
      if (note.slideTo) oscillator.frequency.linearRampToValueAtTime(note.slideTo, start + note.at + note.length);
      // Тихо: эффекты вдвое тише музыки.
      const peak = (note.gain ?? 0.5) * volume * 0.5;
      gain.gain.setValueAtTime(0.0001, start + note.at);
      gain.gain.exponentialRampToValueAtTime(peak, start + note.at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.length);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + note.at);
      oscillator.stop(start + note.at + note.length + 0.02);
    }
  };
}

export function browserEnv(): SoundEnv {
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return {
    createAudio: (src) => {
      const audio = new Audio(src);
      audio.preload = "auto";
      return audio;
    },
    storage,
    synth: browserSynth(),
    onFirstGesture: (callback) => {
      const events = ["pointerdown", "keydown", "touchstart"] as const;
      const handler = () => {
        remove();
        callback();
      };
      const remove = () => events.forEach((name) => window.removeEventListener(name, handler, true));
      events.forEach((name) => window.addEventListener(name, handler, true));
      return remove;
    },
    now: () => performance.now(),
    schedule: (callback) => {
      const id = window.setTimeout(callback, FADE_STEP_MS);
      return () => window.clearTimeout(id);
    },
    onVisibility: (callback) => {
      const handler = () => callback(document.visibilityState === "hidden");
      document.addEventListener("visibilitychange", handler);
      if (document.visibilityState === "hidden") callback(true);
      return () => document.removeEventListener("visibilitychange", handler);
    }
  };
}

let shared: SoundController | null = null;
const SERVER_SNAPSHOT: SoundSnapshot = { enabled: false, theme: null };

/** Общий контроллер (создаётся в браузере по первому обращению). */
export function getSound(): SoundController {
  shared ??= new SoundController(browserEnv());
  return shared;
}

/** Только для тестов: подменить или сбросить общий контроллер. */
export function setSoundForTests(controller: SoundController | null) {
  shared = controller;
}

export function useSound() {
  const controller = typeof window === "undefined" ? null : getSound();
  const snapshot = useSyncExternalStore(
    (listener) => controller?.subscribe(listener) ?? (() => undefined),
    () => controller?.getSnapshot() ?? SERVER_SNAPSHOT,
    () => SERVER_SNAPSHOT
  );
  return {
    enabled: snapshot.enabled,
    toggle: () => getSound().toggle(),
    effect: (effect: SoundEffect) => getSound().effect(effect)
  };
}

/** Тема музыки по фазе игры. */
export function useSoundTheme(theme: SoundTheme | null) {
  useEffect(() => {
    getSound().setTheme(theme);
  }, [theme]);
}
