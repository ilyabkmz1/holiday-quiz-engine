// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OverlayLayer } from "@/components/quest/overlay";
import { QuestGame } from "@/components/quest/QuestGame";
import { snowGlobe } from "../support/world";
import { campaign, json, rushSession, stubResizeObserver } from "./quest-fixtures";

/** Счётчики перерисовок: тяжёлый слой мира не должен перерисовываться из-за таймера рывка. */
const counts = vi.hoisted(() => ({ worldLayer: 0, world: 0 }));
vi.mock("@/components/quest/WorldLayer", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/quest/WorldLayer")>();
  const React = await import("react");
  const Inner = original.WorldLayer.type as React.ComponentType<React.ComponentProps<typeof original.WorldLayer>>;
  return {
    ...original,
    WorldLayer: React.memo(function CountedWorldLayer(props: React.ComponentProps<typeof original.WorldLayer>) {
      counts.worldLayer += 1;
      return <Inner {...props} />;
    })
  };
});

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.setItem("hqe-holiday-quiz-session", "s1");
  vi.stubGlobal("ResizeObserver", stubResizeObserver());
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ campaign, session: rushSession() }));
  counts.worldLayer = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("Квест: производительность рывка", () => {
  it("за полторы секунды рывка мир не перерисовывается, облачка и сервисы не перерегистрируются, цикл не ищет элементы заново", async () => {
    const register = vi.spyOn(OverlayLayer.prototype, "register");
    const query = vi.spyOn(Element.prototype, "querySelector");
    const frames = vi.spyOn(window, "requestAnimationFrame");
    render(<QuestGame campaign={campaign} world={snowGlobe} />);
    await screen.findByRole("group", { name: "Сервисы" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    const before = { world: counts.worldLayer, register: register.mock.calls.length, query: query.mock.calls.length, frames: frames.mock.calls.length };
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    });
    const after = { world: counts.worldLayer, register: register.mock.calls.length, query: query.mock.calls.length, frames: frames.mock.calls.length };
    const delta = { world: after.world - before.world, register: after.register - before.register, query: after.query - before.query, frames: after.frames - before.frames };
    process.stderr.write(`PERF ${JSON.stringify(delta)}\n`);
    expect(delta.world).toBe(0);
    expect(delta.register).toBe(0);
    expect(delta.query).toBeLessThanOrEqual(2);
    // Мир ничего не двигает: кадры уступают место редким тикам (до этого — ~60 кадров в секунду).
    expect(delta.frames).toBeLessThanOrEqual(5);
  });
});
