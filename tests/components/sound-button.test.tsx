// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SoundButton } from "@/components/play/SoundButton";
import { SOUND_STORAGE_KEY, SoundController, setSoundForTests, type AudioLike } from "@/components/play/sound";

const audio = (): AudioLike => ({ src: "", loop: false, volume: 0, paused: true, play: () => undefined, pause: () => undefined });

afterEach(() => {
  cleanup();
  setSoundForTests(null);
});

describe("кнопка звука в HUD", () => {
  it("по умолчанию выключена (aria-pressed=false), нажатие включает и сохраняет выбор", () => {
    const store = new Map<string, string>();
    setSoundForTests(
      new SoundController({
        createAudio: audio,
        storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
        synth: null,
        onFirstGesture: () => () => undefined,
        now: () => 0,
        schedule: () => () => undefined
      })
    );
    render(<SoundButton />);
    const button = screen.getByRole("button", { name: "Звук" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(store.get(SOUND_STORAGE_KEY)).toBe("on");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(store.get(SOUND_STORAGE_KEY)).toBe("off");
  });
});
