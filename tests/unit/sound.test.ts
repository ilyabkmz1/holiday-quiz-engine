import { describe, expect, it, vi } from "vitest";

import { FADE_MS, MUSIC_VOLUME, SOUND_STORAGE_KEY, SoundController, THEME_FILES, type AudioLike, type SoundEnv } from "@/components/play/sound";

function setup(stored?: string, blocked = false) {
  let now = 0;
  const audios = new Map<string, AudioLike & { plays: number }>();
  const store = new Map<string, string>(stored ? [[SOUND_STORAGE_KEY, stored]] : []);
  let gesture: (() => void) | null = null;
  let visibility: ((hidden: boolean) => void) | null = null;
  const pending: Array<() => void> = [];
  const synth = vi.fn();
  const env: SoundEnv = {
    createAudio: (src) => {
      const audio = { src, loop: false, volume: 1, paused: true, plays: 0, play() { this.plays += 1; this.paused = false; if (blocked) return Promise.reject(new Error("blocked")); }, pause() { this.paused = true; } };
      audios.set(src, audio);
      return audio;
    },
    storage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => void store.set(key, value) },
    synth,
    onFirstGesture: (callback) => { gesture = callback; return () => { gesture = null; }; },
    now: () => now,
    onVisibility: (callback) => { visibility = callback; return () => { visibility = null; }; },
    schedule: (callback) => { pending.push(callback); return () => undefined; }
  };
  const run = (ms: number) => {
    now += ms;
    const batch = pending.splice(0);
    batch.forEach((callback) => callback());
  };
  return { controller: new SoundController(env), audios, hide: (hidden: boolean) => visibility?.(hidden), store, synth, run, fire: () => gesture?.(), hasGesture: () => gesture !== null };
}

describe("звук квеста", () => {
  it("по умолчанию выключен: ни музыки, ни эффектов, ни запросов файлов", () => {
    const { controller, audios, synth } = setup();
    controller.setTheme("world");
    controller.effect("correct");
    expect(controller.getSnapshot().enabled).toBe(false);
    expect(audios.size).toBe(0);
    expect(synth).not.toHaveBeenCalled();
  });

  it("кнопка включает тему с плавным нарастанием до ~30% и запоминает выбор", () => {
    const { controller, audios, store, run } = setup();
    controller.setTheme("world");
    controller.setEnabled(true);
    const world = audios.get(THEME_FILES.world)!;
    expect(world.loop).toBe(true);
    expect(world.plays).toBe(1);
    expect(store.get(SOUND_STORAGE_KEY)).toBe("on");
    run(FADE_MS / 2);
    expect(world.volume).toBeGreaterThan(0);
    expect(world.volume).toBeLessThan(MUSIC_VOLUME);
    run(FADE_MS);
    expect(world.volume).toBeCloseTo(MUSIC_VOLUME, 5);
    expect(MUSIC_VOLUME).toBeCloseTo(0.3, 5);
  });

  it("смена фазы — кроссфейд: старая тема затихает и ставится на паузу, новая нарастает", () => {
    const { controller, audios, run } = setup();
    controller.setEnabled(true);
    controller.setTheme("world");
    run(FADE_MS * 2);
    controller.setTheme("rush");
    run(FADE_MS / 2);
    const world = audios.get(THEME_FILES.world)!;
    const rush = audios.get(THEME_FILES.rush)!;
    expect(world.volume).toBeLessThan(MUSIC_VOLUME);
    expect(rush.volume).toBeGreaterThan(0);
    run(FADE_MS * 2);
    expect(world.paused).toBe(true);
    expect(rush.volume).toBeCloseTo(MUSIC_VOLUME, 5);
  });

  it("выключение гасит всё сразу, эффекты тоже молчат", () => {
    const { controller, audios, synth, run } = setup();
    controller.setEnabled(true);
    controller.setTheme("finale");
    run(FADE_MS * 2);
    controller.effect("lit");
    expect(synth).toHaveBeenCalledTimes(1);
    controller.setEnabled(false);
    expect(audios.get(THEME_FILES.finale)!.paused).toBe(true);
    controller.effect("lit");
    expect(synth).toHaveBeenCalledTimes(1);
  });

  it("сохранённое «включено» не стартует само: звук ждёт первого жеста игрока", () => {
    const { controller, audios, fire, hasGesture } = setup("on");
    controller.setTheme("world");
    expect(controller.getSnapshot().enabled).toBe(true);
    expect(audios.size).toBe(0);
    expect(hasGesture()).toBe(true);
    fire();
    expect(audios.get(THEME_FILES.world)!.plays).toBe(1);
  });

  it("если браузер отклонил воспроизведение или хранилище недоступно, игра не падает", () => {
    const blocked = setup(undefined, true);
    expect(() => blocked.controller.setEnabled(true)).not.toThrow();
    const env = setup().controller;
    expect(env.isEnabled()).toBe(false);
  });

  it("фоновая вкладка: музыка на паузе и эффекты молчат, при возвращении музыка продолжается с плавным выходом на громкость", () => {
    const { controller, audios, synth, run, hide } = setup();
    controller.setEnabled(true);
    controller.setTheme("world");
    run(FADE_MS * 2);
    const world = audios.get(THEME_FILES.world)!;
    expect(world.paused).toBe(false);
    hide(true);
    expect(world.paused).toBe(true);
    controller.effect("correct");
    expect(synth).not.toHaveBeenCalled();
    // Смена фазы в фоне не запускает воспроизведение.
    controller.setTheme("rush");
    expect(audios.get(THEME_FILES.rush)?.paused ?? true).toBe(true);
    hide(false);
    expect(audios.get(THEME_FILES.rush)!.paused).toBe(false);
    run(FADE_MS / 2);
    expect(audios.get(THEME_FILES.rush)!.volume).toBeGreaterThan(0);
    expect(audios.get(THEME_FILES.rush)!.volume).toBeLessThan(MUSIC_VOLUME);
    run(FADE_MS * 2);
    expect(audios.get(THEME_FILES.rush)!.volume).toBeCloseTo(MUSIC_VOLUME, 5);
    controller.effect("correct");
    expect(synth).toHaveBeenCalledTimes(1);
  });

  it("выключенный звук не просыпается при возвращении во вкладку", () => {
    const { controller, audios, hide } = setup();
    controller.setTheme("world");
    hide(true);
    hide(false);
    expect(audios.size).toBe(0);
    expect(controller.getSnapshot().enabled).toBe(false);
  });
});
