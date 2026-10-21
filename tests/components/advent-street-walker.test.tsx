// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Storefront } from "@/components/advent/storefront/Storefront";
import { facadeLayout, standPoints, walkDuration, WALK_MAX_MS } from "@/domain/advent";
import { publicAdvent } from "@/server/presentation";
import type { AdventState, PublicAdvent } from "@/types/advent";

import { adventConfig, at } from "../support/advent";
import { memoryAdventApi } from "../support/advent-client";
import { mockReducedMotion } from "../support/advent-ui";
import { renderInWorld as render } from "./world-render";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- черновик пакета до разбора схемой
const storefrontConfig = (tweak?: (draft: any) => void) =>
  adventConfig((draft) => {
    draft.presentation = "storefront";
    draft.facade = { templateId: "cafe", hostHeroId: "mila", signText: "Зерно" };
    tweak?.(draft);
  });
const publicOf = (config = storefrontConfig()): PublicAdvent => publicAdvent(config, "zerno-advent", "snow-globe");

/** Участник открыл день 1, на день 4: открытое, пропущенное, догоняемое, сегодняшнее и закрытое окна. */
async function fiveStatus(): Promise<AdventState> {
  const harness = memoryAdventApi({ advent: storefrontConfig(), start: at(1) });
  await harness.ensureParticipant();
  await harness.api.openDay(1);
  harness.clock.now = at(4);
  return harness.api.getState();
}

const win = (n: number) => document.querySelector<HTMLElement>(`[data-door="${n}"]`)!;
const track = () => document.querySelector<HTMLElement>(".adv-street-track")!;
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

function mount(state: AdventState, props: { reduced?: boolean; advent?: PublicAdvent } = {}) {
  const onOpen = vi.fn();
  const onHint = vi.fn();
  render(<Storefront advent={props.advent ?? publicOf()} state={state} busy={null} lit={null} reduced={props.reduced ?? false} onOpen={onOpen} onHint={onHint} onStreak={vi.fn()} />);
  return { onOpen, onHint };
}

/** Положение дорожки: доля ширины из `translate3d(X%, …)`. */
const trackX = () => Number(/translate3d\(([-\d.]+)%/.exec(track().style.transform)![1]) / 100;

let state: AdventState;
const points = (s: AdventState) => standPoints(facadeLayout(s.doors.length, s.today, publicOf().facade!.template));

beforeEach(async () => {
  mockReducedMotion(false);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
  state = await fiveStatus();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Витрина: хозяин на улице", () => {
  it("хозяин декоративный и на улице, в двери его нет", () => {
    mount(state);
    const street = document.querySelector(".adv-street")!;
    expect(street).toHaveAttribute("aria-hidden", "true");
    expect(street.querySelector("svg")).not.toBeNull();
    expect(document.querySelector(".adv-host")).toBeNull();
    expect(win(4)).toHaveAccessibleName(/^Окно 4: Сегодня/);
  });

  it("при первом показе выходит из двери к сегодняшнему окну, окно откликается, день не открывается", () => {
    const { onOpen, onHint } = mount(state);
    const p = points(state);
    expect(trackX()).toBeCloseTo(p.door);
    advance(300);
    expect(trackX()).toBeCloseTo(p.door);
    advance(450 + walkDuration(p.byDay.get(4)! - p.door) + 100);
    expect(trackX()).toBeCloseTo(p.byDay.get(4)!);
    expect(win(4)).toHaveAttribute("data-knock", "true");
    expect(document.querySelector(".adv-street-host")).toHaveAttribute("data-pose", "wave");
    advance(3000);
    expect(win(4)).not.toHaveAttribute("data-knock");
    expect(document.querySelector(".adv-street-host")).toHaveAttribute("data-pose", "idle");
    expect(onOpen).not.toHaveBeenCalled();
    expect(onHint).not.toHaveBeenCalled();
  });

  it("тап по окну: onOpen после ходьбы, не раньше и не позже предела", () => {
    const { onOpen } = mount(state);
    advance(450 + WALK_MAX_MS + 3500);
    fireEvent.click(win(1));
    expect(onOpen).not.toHaveBeenCalled();
    advance(200);
    expect(onOpen).not.toHaveBeenCalled();
    advance(WALK_MAX_MS);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(1);
    expect(trackX()).toBeCloseTo(points(state).byDay.get(1)!);
  });

  it("закрытое окно: onHint после прихода, onOpen нет", () => {
    const { onOpen, onHint } = mount(state);
    advance(5000);
    fireEvent.click(win(5));
    expect(onHint).not.toHaveBeenCalled();
    advance(WALK_MAX_MS + 100);
    expect(onHint).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("двойной тап и повторный тап по пути дают одно действие — по последнему окну", () => {
    const { onOpen } = mount(state);
    advance(5000);
    fireEvent.click(win(1));
    fireEvent.click(win(1));
    advance(1000);
    expect(onOpen).toHaveBeenCalledTimes(1);
    onOpen.mockClear();
    fireEvent.click(win(2));
    advance(50);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(win(4));
    advance(WALK_MAX_MS + 100);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(4);
    expect(trackX()).toBeCloseTo(points(state).byDay.get(4)!);
  });

  it("кнопка плашки ведёт себя как тап по сегодняшнему окну", () => {
    const { onOpen } = mount(state);
    advance(5000);
    fireEvent.click(win(1));
    advance(1000);
    onOpen.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Открыть окно 4/ }));
    expect(onOpen).not.toHaveBeenCalled();
    advance(WALK_MAX_MS + 100);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(4);
  });

  it("клавиатура: Enter и пробел на окне и на кнопке плашки действуют сразу, фокус остаётся на окне", () => {
    const { onOpen } = mount(state);
    advance(5000);
    win(1).focus();
    fireEvent.keyDown(win(1), { key: "Enter" });
    fireEvent.click(win(1));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenLastCalledWith(1);
    expect(win(1)).toHaveFocus();
    fireEvent.keyDown(win(4), { key: " " });
    fireEvent.click(win(4));
    expect(onOpen).toHaveBeenCalledTimes(2);
    const button = screen.getByRole("button", { name: /Открыть окно 4/ });
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(3);
    // Герой лишь идёт следом и второго действия не порождает.
    advance(2000);
    expect(onOpen).toHaveBeenCalledTimes(3);
    expect(trackX()).toBeCloseTo(points(state).byDay.get(4)!);
  });

  it("клавиатура гасит ожидающий тап: выполняется только действие с клавиатуры", () => {
    const { onOpen } = mount(state);
    advance(5000);
    fireEvent.click(win(1));
    advance(100);
    fireEvent.keyDown(win(4), { key: "Enter" });
    fireEvent.click(win(4));
    advance(2000);
    expect(onOpen.mock.calls).toEqual([[4]]);
  });

  it("prefers-reduced-motion: сразу под сегодняшним окном, тап действует без задержки", () => {
    mockReducedMotion(true);
    const { onOpen } = mount(state, { reduced: true });
    expect(trackX()).toBeCloseTo(points(state).byDay.get(4)!);
    fireEvent.click(win(1));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(1);
    expect(trackX()).toBeCloseTo(points(state).byDay.get(1)!);
    fireEvent.click(screen.getByRole("button", { name: /Открыть окно 4/ }));
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".adv-street-host")).toHaveAttribute("data-pose", "idle");
  });

  it("hostWalks: false в пакете — хозяин в двери, действия без ходьбы", () => {
    const advent = publicOf(storefrontConfig((draft) => { draft.facade.hostWalks = false; }));
    expect(advent.facade!.hostWalks).toBe(false);
    const { onOpen } = mount(state, { advent });
    expect(document.querySelector(".adv-street")).toBeNull();
    expect(document.querySelector(".adv-host")).not.toBeNull();
    fireEvent.click(win(1));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("по умолчанию ходьба включена", () => {
    expect(publicOf().facade!.hostWalks).toBe(true);
  });

  it("размонтирование на ходу не вызывает действие", () => {
    const { onOpen } = mount(state);
    advance(5000);
    fireEvent.click(win(1));
    cleanup();
    advance(2000);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
