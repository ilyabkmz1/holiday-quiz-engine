// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { browserEnv, FADE_STEP_MS } from "@/components/play/sound";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("звуковое окружение браузера", () => {
  it("плавное изменение громкости идёт таймером, а не requestAnimationFrame (в фоновой вкладке кадры замирают)", () => {
    vi.useFakeTimers();
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const step = vi.fn();
    browserEnv().schedule(step);
    expect(step).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FADE_STEP_MS);
    expect(step).toHaveBeenCalledTimes(1);
    expect(raf).not.toHaveBeenCalled();
    const cancel = browserEnv().schedule(step);
    cancel();
    vi.advanceTimersByTime(FADE_STEP_MS * 2);
    expect(step).toHaveBeenCalledTimes(1);
  });

  it("visibilitychange сообщает, скрыта ли вкладка, и отписывается", () => {
    const state = { value: "visible" as DocumentVisibilityState };
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => state.value);
    const callback = vi.fn();
    const off = browserEnv().onVisibility!(callback);
    state.value = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    state.value = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callback.mock.calls).toEqual([[true], [false]]);
    off();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
