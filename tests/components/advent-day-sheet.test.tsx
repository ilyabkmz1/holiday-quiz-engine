// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DaySheet, outcomeToReveal } from "@/components/advent/DaySheet";
import type { Task } from "@/config/schema";
import type { AdventState, AdventTaskOutcome } from "@/types/advent";

import { at } from "../support/advent";
import { memoryAdventApi } from "../support/advent-client";
import { config, mockReducedMotion, publicConfig } from "../support/advent-ui";
import { renderInWorld as render } from "./world-render";

afterEach(cleanup);
beforeEach(() => mockReducedMotion(true));

const copy = config.copy;
const task = (id: string) => config.days.flatMap((day) => day.blocks).flatMap((block) => (block.type === "task" ? [block.task] : [])).find((item) => item.id === id) as Task;

type Harness = ReturnType<typeof memoryAdventApi>;

function Host({ harness, initial, n, onClose, onError }: { harness: Harness; initial: AdventState; n: number; onClose: () => void; onError: (error: unknown) => void }) {
  const [state, setState] = useState(initial);
  return <DaySheet advent={publicConfig} state={state} n={n} reduced nowMs={harness.clock.now.getTime()} api={harness.api} onClose={onClose} onState={setState} onError={onError} />;
}

/** Участник на день `day`, дверь открыта; лист смонтирован. */
async function openSheet(day: number, options: { signedIn?: boolean } = {}) {
  const harness = memoryAdventApi({ start: at(day) });
  await harness.ensureParticipant();
  if (options.signedIn) {
    await harness.api.requestLink({ email: "guest@example.test", consent: true, marketingConsent: false, reminderOptIn: false });
    await harness.confirmLogin();
  }
  const { state } = await harness.api.openDay(day);
  const onClose = vi.fn();
  const onError = vi.fn();
  const view = render(<Host harness={harness} initial={state} n={day} onClose={onClose} onError={onError} />);
  return { harness, state, onClose, onError, view };
}

const dayOf = (state: AdventState, n: number) => state.days.find((day) => day.n === n)!;
const dialog = () => screen.getByRole("dialog");
const next = (name: string | RegExp) => fireEvent.click(within(dialog()).getByRole("button", { name }));

describe("DaySheet: глава и блоки", () => {
  it("лист — модальный диалог с названием дня; сначала глава истории героя", async () => {
    await openSheet(5);
    expect(dialog()).toHaveAttribute("aria-modal", "true");
    expect(dialog()).toHaveAccessibleName(/^День 5: Идеальный эспрессо/);
    for (const line of config.days[4].chapter.lines) expect(within(dialog()).getByText(line)).toBeInTheDocument();
    expect(within(dialog()).getByText("Мила")).toBeInTheDocument();
  });

  it("правильных ответов, разбора и совета в листе нет, пока сервер не принял ответ", async () => {
    const { state } = await openSheet(5);
    next(copy.chapterNext);
    await screen.findByRole("button", { name: copy.storyNext });
    next(copy.storyNext);
    const pick = task("brew-shot") as Extract<Task, { type: "pick" }>;
    await within(dialog()).findByRole("group", { name: "Варианты ответа" });
    const shown = dialog().textContent!;
    for (const secret of [pick.explanation, pick.tip, pick.thanks, pick.oops]) expect(shown).not.toContain(secret);
    // Нет их и в состоянии, пришедшем с сервера: ни разбора, ни признака правильности.
    const json = JSON.stringify(state.days);
    for (const secret of [pick.explanation, pick.tip, pick.thanks, pick.oops, "correctOptionId", "correctIds"]) expect(json).not.toContain(secret);
  });

  it("ответ: разбор появляется только после ответа сервера и остаётся, пока игрок не нажмёт «Дальше»", async () => {
    const { harness } = await openSheet(5);
    const pick = task("brew-shot") as Extract<Task, { type: "pick" }>;
    next(copy.chapterNext);
    next(await screen.findByRole("button", { name: copy.storyNext }).then(() => copy.storyNext));
    const right = pick.options.find((option) => option.id === pick.correctOptionId)!;
    fireEvent.click(await within(dialog()).findByRole("button", { name: right.title }));
    const title = await within(dialog()).findByRole("heading", { level: 3, name: copy.outcomePerfect });
    expect(title).toBeInTheDocument();
    expect(within(dialog()).getByText(pick.explanation)).toBeInTheDocument();
    // Блок уже отмечен выполненным на сервере, но экран разбора не исчез и подарок дня ещё не показан.
    const state = await harness.api.getState();
    expect(dayOf(state, 5).blocks[1]).toMatchObject({ type: "task", done: true });
    expect(within(dialog()).queryByRole("button", { name: copy.promoOpen })).not.toBeInTheDocument();
    next(copy.outcomeNext);
    expect(await within(dialog()).findByRole("button", { name: copy.promoOpen })).toBeInTheDocument();
  });

  it("ошибка ответа не ломает лист: onError вызван, задание можно повторить", async () => {
    const { harness, onError } = await openSheet(5);
    const pick = task("brew-shot") as Extract<Task, { type: "pick" }>;
    next(copy.chapterNext);
    next(await screen.findByRole("button", { name: copy.storyNext }).then(() => copy.storyNext));
    const original = harness.api.submitBlock;
    harness.api.submitBlock = vi.fn().mockRejectedValueOnce(new Error("сеть")).mockImplementation(original);
    const right = pick.options.find((option) => option.id === pick.correctOptionId)!;
    fireEvent.click(await within(dialog()).findByRole("button", { name: right.title }));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    fireEvent.click(await within(dialog()).findByRole("button", { name: right.title }));
    expect(await within(dialog()).findByRole("heading", { level: 3, name: copy.outcomePerfect })).toBeInTheDocument();
  });

  it("возвращение в начатый день: глава не повторяется, лист продолжает с первого невыполненного блока", async () => {
    const harness = memoryAdventApi({ start: at(5) });
    await harness.ensureParticipant();
    const { state: opened } = await harness.api.openDay(5);
    await harness.api.submitBlock(5, 0);
    const state = await harness.api.getState();
    expect(dayOf(opened, 5).blocks[0].done).toBe(false);
    render(<Host harness={harness} initial={state} n={5} onClose={vi.fn()} onError={vi.fn()} />);
    expect(within(dialog()).queryByRole("button", { name: copy.chapterNext })).not.toBeInTheDocument();
    expect(await within(dialog()).findByRole("group", { name: "Варианты ответа" })).toBeInTheDocument();
  });
});

describe("DaySheet: награды и вход", () => {
  it("подарок дня анонимному: identity_required, показана «Сохранить прогресс», подарок не выдан", async () => {
    const { harness } = await openSheet(5);
    const pick = task("brew-shot") as Extract<Task, { type: "pick" }>;
    next(copy.chapterNext);
    next(await screen.findByRole("button", { name: copy.storyNext }).then(() => copy.storyNext));
    fireEvent.click(await within(dialog()).findByRole("button", { name: pick.options.find((option) => option.id === pick.correctOptionId)!.title }));
    next(await within(dialog()).findByRole("button", { name: copy.outcomeNext }).then(() => copy.outcomeNext));
    fireEvent.click(await within(dialog()).findByRole("button", { name: copy.promoOpen }));
    expect(await within(dialog()).findByRole("region", { name: copy.saveTitle })).toBeInTheDocument();
    expect(within(dialog()).getByText(copy.saveIdentityRequired)).toBeInTheDocument();
    expect(within(dialog()).queryByTestId("promo-code")).not.toBeInTheDocument();
    const state = await harness.api.getState();
    expect(dayOf(state, 5).blocks[2]).toMatchObject({ type: "promo", done: false });
    expect(state.grants.filter((grant) => grant.day === 5)).toEqual([]);
  });

  it("удача анонимному: identity_required, анимации раскрытия нет, приз не разыгран, остаток не списан", async () => {
    const harness = memoryAdventApi({ start: at(4) });
    await harness.ensureParticipant();
    const { state } = await harness.api.openDay(4);
    render(<Host harness={harness} initial={state} n={4} onClose={vi.fn()} onError={vi.fn()} />);
    next(copy.chapterNext);
    next(await screen.findByRole("button", { name: copy.storyNext }).then(() => copy.storyNext));
    fireEvent.click(await within(dialog()).findByRole("button", { name: /^Коробка 1/ }));
    expect(await within(dialog()).findByRole("region", { name: copy.saveTitle })).toBeInTheDocument();
    expect(within(dialog()).queryByText(copy.luckWon)).not.toBeInTheDocument();
    expect(document.querySelector('[data-state="open"]')).toBeNull();
    const fresh = await harness.api.getState();
    expect(fresh.grants.filter((grant) => grant.source === "luck")).toEqual([]);
    expect(dayOf(fresh, 4).blocks[1]).toMatchObject({ type: "luck", done: false, reveal: null });
  });

  it("удача вошедшему: исход из ответа сервера (приз и код), без входа — нет", async () => {
    const { harness } = await openSheet(4, { signedIn: true });
    next(copy.chapterNext);
    next(await screen.findByRole("button", { name: copy.storyNext }).then(() => copy.storyNext));
    fireEvent.click(await within(dialog()).findByRole("button", { name: /^Коробка 2/ }));
    expect(await within(dialog()).findByText(copy.luckWon)).toBeInTheDocument();
    const state = await harness.api.getState();
    const grant = state.grants.find((item) => item.source === "luck")!;
    expect(grant).toBeDefined();
    expect(within(dialog()).getAllByText(grant.label).length).toBeGreaterThan(0);
    expect(within(dialog()).getByTestId("promo-code")).toHaveTextContent(grant.code!);
    next(copy.outcomeNext);
    expect(await within(dialog()).findByRole("heading", { level: 3, name: copy.dayDoneTitle })).toBeInTheDocument();
  });

  it("итог дня: награда дня анонимному — без кода, с пояснением и формой сохранения прогресса", async () => {
    // День 2: история, задание «собрать» и награда за закрытие дня (без блока подарка).
    const harness = memoryAdventApi({ start: at(2) });
    await harness.ensureParticipant();
    const { state: opened } = await harness.api.openDay(2);
    render(<Host harness={harness} initial={opened} n={2} onClose={vi.fn()} onError={vi.fn()} />);
    next(copy.chapterNext);
    next(await screen.findByRole("button", { name: copy.storyNext }).then(() => copy.storyNext));
    const build = task("beans-store") as Extract<Task, { type: "build" }>;
    for (const id of build.correctOptionIds) {
      fireEvent.click(await within(dialog()).findByRole("button", { name: build.options.find((option) => option.id === id)!.title }));
    }
    fireEvent.click(within(dialog()).getByRole("button", { name: "Запустить сценарий" }));
    next(await within(dialog()).findByRole("button", { name: copy.outcomeNext }).then(() => copy.outcomeNext));
    expect(await within(dialog()).findByRole("heading", { level: 3, name: copy.dayDoneTitle })).toBeInTheDocument();
    expect(within(dialog()).getByText(copy.promoNeedsIdentity)).toBeInTheDocument();
    expect(within(dialog()).queryByTestId("promo-code")).not.toBeInTheDocument();
    expect(within(dialog()).getByRole("region", { name: copy.saveTitle })).toBeInTheDocument();
  });
});

describe("DaySheet: диалог", () => {
  it("Escape и кнопка закрытия вызывают onClose", async () => {
    const { onClose } = await openSheet(5);
    fireEvent.keyDown(dialog(), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: copy.sheetClose }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("Tab не уходит из листа: с последнего элемента — на первый, Shift+Tab — наоборот", async () => {
    await openSheet(5);
    const items = [...dialog().querySelectorAll<HTMLElement>("button")];
    const first = items[0];
    const last = items[items.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("прокрутка страницы под листом отключена и возвращается при закрытии", async () => {
    document.body.style.overflow = "auto";
    const { view } = await openSheet(5);
    expect(document.body.style.overflow).toBe("hidden");
    view.unmount();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("пока дверь не открыта (дня нет в состоянии), лист показывает «Открываем дверь…»", async () => {
    const harness = memoryAdventApi({ start: at(5) });
    await harness.ensureParticipant();
    const state = await harness.api.getState();
    render(<Host harness={harness} initial={state} n={5} onClose={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(copy.sheetOpening);
  });
});

describe("outcomeToReveal", () => {
  it("переносит разбор адвента в форму механик заданий без очков и комбо", () => {
    const outcome: AdventTaskOutcome = {
      taskId: "t", type: "pick", payload: { optionId: "a" }, base: 100, outcome: "perfect", correctIds: ["a"], explanation: "e", tip: "t", mood: "happy", line: "l"
    };
    expect(outcomeToReveal(outcome)).toMatchObject({ taskId: "t", type: "pick", outcome: "perfect", correctIds: ["a"], comboBonus: 0, combo: 0, explanation: "e", tip: "t", mood: "happy", line: "l" });
  });
});
