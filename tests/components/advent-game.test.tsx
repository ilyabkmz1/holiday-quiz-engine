// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdventGame } from "@/components/advent/AdventGame";
import { ApiError } from "@/components/advent/api";

import { at } from "../support/advent";
import { memoryAdventApi } from "../support/advent-client";
import { config, mockReducedMotion, publicConfig } from "../support/advent-ui";
import { snowGlobe } from "../support/world";

beforeEach(() => {
  mockReducedMotion(false);
  window.history.replaceState(null, "", "/");
  try {
    window.localStorage.clear();
  } catch {
    // jsdom без localStorage: баннер возвращения не запоминается.
  }
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const copy = config.copy;
const mount = (api: ReturnType<typeof memoryAdventApi>["api"], strict = false) => {
  const tree = <AdventGame advent={publicConfig} world={snowGlobe} api={api} />;
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
};
const door = (n: number) => document.querySelector<HTMLElement>(`[data-door="${n}"]`)!;

describe("AdventGame: загрузка", () => {
  it("первый визит: состояние 401, участник создаётся, показаны название, серия и двери", async () => {
    const harness = memoryAdventApi({ start: at(3) });
    const getState = vi.spyOn(harness.api, "getState");
    const create = vi.spyOn(harness.api, "createParticipant");
    mount(harness.api);
    expect(screen.getByText(copy.loading)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 1, name: config.title })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll(".adv-door")).toHaveLength(12));
    expect(getState).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(door(3)).toHaveAttribute("data-status", "today");
    expect(screen.getByRole("heading", { level: 2, name: copy.calendarTitle })).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("повторный визит: участник уже есть, второй не создаётся", async () => {
    const harness = memoryAdventApi({ start: at(3) });
    await harness.ensureParticipant();
    const create = vi.spyOn(harness.api, "createParticipant");
    mount(harness.api);
    await waitFor(() => expect(document.querySelectorAll(".adv-door")).toHaveLength(12));
    expect(create).not.toHaveBeenCalled();
  });

  it("StrictMode (двойной запуск эффекта в dev) создаёт одного участника", async () => {
    const harness = memoryAdventApi({ start: at(3) });
    const create = vi.spyOn(harness.api, "createParticipant");
    mount(harness.api, true);
    await waitFor(() => expect(document.querySelectorAll(".adv-door")).toHaveLength(12));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("ошибка сервера: сообщение и «Повторить»", async () => {
    const harness = memoryAdventApi({ start: at(3) });
    vi.spyOn(harness.api, "getState").mockRejectedValueOnce(new ApiError(0, "Нет соединения."));
    mount(harness.api);
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.errorGeneric);
    fireEvent.click(screen.getByRole("button", { name: copy.retry }));
    await waitFor(() => expect(document.querySelectorAll(".adv-door")).toHaveLength(12));
  });

  it("ссылка входа не сработала (?login=error): подсказка", async () => {
    window.history.replaceState(null, "", "/?login=error");
    const harness = memoryAdventApi({ start: at(3) });
    mount(harness.api);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText(copy.loginError)).toBeInTheDocument();
  });
});

describe("AdventGame: фазы", () => {
  it("до старта: отсчёт и закрытые двери", async () => {
    const harness = memoryAdventApi({ start: new Date("2026-12-10T12:00:00+03:00") });
    mount(harness.api);
    expect(await screen.findByRole("heading", { level: 2, name: "Адвент откроется 20 декабря" })).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent(/^9 дн 12 ч /);
    expect(document.querySelectorAll('.adv-door[data-status="locked"]')).toHaveLength(12);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("отсчёт идёт по часам сервера и в момент старта подтягивает состояние", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    try {
      const harness = memoryAdventApi({ start: new Date("2026-12-19T23:59:57+03:00") });
      vi.setSystemTime(harness.clock.now);
      const getState = vi.spyOn(harness.api, "getState");
      mount(harness.api);
      await act(async () => void (await Promise.resolve()));
      await vi.waitFor(() => expect(document.querySelector(".adv-countdown")).not.toBeNull());
      const before = getState.mock.calls.length;
      harness.clock.now = new Date("2026-12-20T00:00:01+03:00");
      await act(async () => void vi.advanceTimersByTime(4000));
      await vi.waitFor(() => expect(getState.mock.calls.length).toBeGreaterThan(before));
      await vi.waitFor(() => expect(door(1)).toHaveAttribute("data-status", "today"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("после последнего дня в момент финала без перезагрузки подтягивает итоги", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    try {
      const harness = memoryAdventApi({ start: new Date("2026-12-31T23:59:57+03:00") });
      vi.setSystemTime(harness.clock.now);
      mount(harness.api);
      await act(async () => void (await Promise.resolve()));
      await vi.waitFor(() => expect(door(12)).toHaveAttribute("data-status", "today"));
      harness.clock.now = new Date("2027-01-01T00:00:01+03:00");
      await act(async () => void vi.advanceTimersByTime(4000));
      await vi.waitFor(() => expect(screen.getByRole("heading", { level: 2, name: copy.finaleTitle })).toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it("финал: итоги, цели, главный приз и «поделиться»; двери не открываются", async () => {
    const harness = memoryAdventApi({ start: new Date("2027-01-01T10:00:00+03:00") });
    mount(harness.api);
    expect(await screen.findByRole("heading", { level: 2, name: copy.finaleTitle })).toBeInTheDocument();
    expect(screen.getByText(copy.finaleMainPrize)).toBeInTheDocument();
    expect(screen.getByText(copy.finaleNoPrize)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.finaleShare })).toBeInTheDocument();
    const openDay = vi.spyOn(harness.api, "openDay");
    fireEvent.click(door(12));
    expect(openDay).not.toHaveBeenCalled();
  });

  it("после закрытия новому посетителю: участник не создаётся, «адвент завершён»", async () => {
    const harness = memoryAdventApi({ start: new Date("2027-02-01T10:00:00+03:00") });
    mount(harness.api);
    expect(await screen.findByRole("heading", { level: 2, name: copy.closedTitle })).toBeInTheDocument();
    expect(screen.getByText(copy.closedText)).toBeInTheDocument();
    expect(document.querySelector(".adv-door")).toBeNull();
  });

  it("после закрытия участнику: итоги и «адвент завершён»", async () => {
    const harness = memoryAdventApi({ start: at(1) });
    await harness.ensureParticipant();
    harness.clock.now = new Date("2027-02-01T10:00:00+03:00");
    mount(harness.api);
    expect(await screen.findByRole("heading", { level: 2, name: copy.closedTitle })).toBeInTheDocument();
    expect(screen.getByText(copy.closedText)).toBeInTheDocument();
  });
});

describe("AdventGame: двери и лист", () => {
  it("сегодняшняя дверь открывает лист, фон становится inert, Escape закрывает и возвращает фокус на дверь", async () => {
    const harness = memoryAdventApi({ start: at(3) });
    const open = vi.spyOn(harness.api, "openDay");
    mount(harness.api);
    await waitFor(() => expect(door(3)).toBeTruthy());
    fireEvent.click(door(3));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(open).toHaveBeenCalledWith(3);
    expect(document.querySelector("main")).toHaveAttribute("inert");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.querySelector("main")).not.toHaveAttribute("inert");
    await waitFor(() => expect(door(3)).toHaveFocus());
    expect(door(3)).toHaveAttribute("data-status", "opened");
  });

  it("закрытая дверь: подсказка «Откроется …», запросов нет", async () => {
    const harness = memoryAdventApi({ start: at(3) });
    const open = vi.spyOn(harness.api, "openDay");
    mount(harness.api);
    await waitFor(() => expect(door(6)).toBeTruthy());
    fireEvent.click(door(6));
    expect(screen.getByText("Откроется 25 декабря")).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ошибка открытия (409): сообщение сервера и обновление состояния", async () => {
    const harness = memoryAdventApi({ start: at(3) });
    mount(harness.api);
    await waitFor(() => expect(door(3)).toBeTruthy());
    const getState = vi.spyOn(harness.api, "getState");
    vi.spyOn(harness.api, "openDay").mockRejectedValueOnce(new ApiError(409, "Этот день уже нельзя открыть."));
    fireEvent.click(door(3));
    expect(await screen.findByText("Этот день уже нельзя открыть.")).toBeInTheDocument();
    await waitFor(() => expect(getState).toHaveBeenCalled());
  });

  it("ошибка ответа на блок при открытом листе видна и озвучивается: подсказка вне inert-фона", async () => {
    const harness = memoryAdventApi({ start: at(3) });
    mount(harness.api);
    await waitFor(() => expect(door(3)).toBeTruthy());
    fireEvent.click(door(3));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: copy.chapterNext }));
    vi.spyOn(harness.api, "submitBlock").mockRejectedValueOnce(new ApiError(409, "Слишком много попыток."));
    fireEvent.click(within(dialog).getByRole("button", { name: copy.storyNext }));
    const hint = await screen.findByText("Слишком много попыток.");
    expect(hint).toHaveAttribute("role", "status");
    expect(hint.closest("[inert]")).toBeNull();
    expect(document.querySelector("main")).toHaveAttribute("inert");
  });

  it("401 посреди игры (cookie пропала): участник создаётся заново, страница не падает", async () => {
    const harness = memoryAdventApi({ start: at(3) });
    mount(harness.api);
    await waitFor(() => expect(door(3)).toBeTruthy());
    const create = vi.spyOn(harness.api, "createParticipant");
    vi.spyOn(harness.api, "openDay").mockRejectedValueOnce(new ApiError(401, "Участник недоступен."));
    // Cookie пропала: состояние тоже отвечает 401, и страница делает первый визит заново.
    vi.spyOn(harness.api, "getState").mockRejectedValueOnce(new ApiError(401, "Участник недоступен."));
    fireEvent.click(door(3));
    await waitFor(() => expect(create).toHaveBeenCalled());
    await waitFor(() => expect(door(3)).toBeTruthy());
  });
});

describe("AdventGame: возвращение и сохранение прогресса", () => {
  async function returning() {
    const harness = memoryAdventApi({ start: at(1) });
    await harness.ensureParticipant();
    await harness.api.openDay(1);
    harness.clock.now = at(4);
    await harness.api.openDay(4);
    return harness;
  }

  it("баннер «С возвращением!» при бонусе, закрывается и не возвращается после перезагрузки", async () => {
    const harness = await returning();
    const first = mount(harness.api);
    const banner = await screen.findByRole("status", { name: copy.comebackTitle });
    expect(within(banner).getByText(copy.comebackTitle)).toBeInTheDocument();
    fireEvent.click(within(banner).getByRole("button", { name: copy.comebackClose }));
    expect(screen.queryByRole("status", { name: copy.comebackTitle })).not.toBeInTheDocument();
    first.unmount();
    mount(harness.api);
    await waitFor(() => expect(document.querySelectorAll(".adv-door")).toHaveLength(12));
    expect(screen.queryByRole("status", { name: copy.comebackTitle })).not.toBeInTheDocument();
  });

  it("после пройденного дня анониму предлагают сохранить прогресс; вошедшему — «прогресс сохранён: a***@…»", async () => {
    const harness = memoryAdventApi({ start: at(2) });
    await harness.ensureParticipant();
    await harness.api.openDay(2);
    mount(harness.api);
    await waitFor(() => expect(document.querySelectorAll(".adv-door")).toHaveLength(12));
    expect(screen.queryByRole("region", { name: copy.saveTitle })).not.toBeInTheDocument();
  });

  it("вошедший по ссылке видит маску email и не видит форму сохранения", async () => {
    const harness = memoryAdventApi({ start: at(2) });
    await harness.ensureParticipant();
    await harness.api.requestLink({ email: "guest@example.test", consent: true, marketingConsent: false, reminderOptIn: false });
    await harness.confirmLogin();
    mount(harness.api);
    expect(await screen.findByText(/^Прогресс сохранён: g\*+@example\.test$/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: copy.saveTitle })).not.toBeInTheDocument();
  });

  describe("напоминания на почту", () => {
    async function confirmed(options: { optIn: boolean }) {
      const harness = memoryAdventApi({ start: at(2) });
      await harness.ensureParticipant();
      await harness.api.requestLink({ email: "guest@example.test", consent: true, marketingConsent: false, reminderOptIn: options.optIn });
      await harness.confirmLogin();
      return harness;
    }

    it("вошедший видит переключатель, включает и выключает его; состояние берётся с сервера", async () => {
      const harness = await confirmed({ optIn: false });
      const setReminders = vi.spyOn(harness.api, "setReminders");
      mount(harness.api);
      const toggle = await screen.findByRole("checkbox", { name: copy.remindersToggle });
      expect(toggle).not.toBeChecked();
      expect(screen.getByText(copy.remindersToggleHint)).toBeInTheDocument();

      fireEvent.click(toggle);
      await waitFor(() => expect(screen.getByRole("checkbox", { name: copy.remindersToggle })).toBeChecked());
      expect(setReminders).toHaveBeenLastCalledWith(true);
      expect((await harness.api.getState()).participant.reminderOptIn).toBe(true);

      fireEvent.click(screen.getByRole("checkbox", { name: copy.remindersToggle }));
      await waitFor(() => expect(screen.getByRole("checkbox", { name: copy.remindersToggle })).not.toBeChecked());
      expect(setReminders).toHaveBeenLastCalledWith(false);
    });

    it("уже подписанный видит включённый переключатель; при ошибке сервера возвращается прежнее и звучит сообщение", async () => {
      const harness = await confirmed({ optIn: true });
      vi.spyOn(harness.api, "setReminders").mockRejectedValue(new ApiError(500, "сбой"));
      mount(harness.api);
      const toggle = await screen.findByRole("checkbox", { name: copy.remindersToggle });
      expect(toggle).toBeChecked();
      fireEvent.click(toggle);
      expect(await screen.findByRole("alert")).toHaveTextContent(copy.remindersToggleError);
      expect(screen.getByRole("checkbox", { name: copy.remindersToggle })).toBeChecked();
    });

    it("анониму переключателя нет", async () => {
      const harness = memoryAdventApi({ start: at(2) });
      await harness.ensureParticipant();
      mount(harness.api);
      await waitFor(() => expect(document.querySelectorAll(".adv-door")).toHaveLength(12));
      expect(screen.queryByRole("checkbox", { name: copy.remindersToggle })).not.toBeInTheDocument();
    });
  });

  describe("вход из письма-напоминания: /?day=N", () => {
    it("открывает указанный сегодняшний день один раз и убирает параметр из адреса", async () => {
      window.history.replaceState(null, "", "/?day=2&utm=x#top");
      const harness = memoryAdventApi({ start: at(2) });
      await harness.ensureParticipant();
      mount(harness.api);
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(window.location.search).toBe("?utm=x");
      expect(window.location.hash).toBe("#top");
      expect((await harness.api.getState()).doors.find((item) => item.n === 2)?.status).toBe("opened");
    });

    it("закрытый (будущий) день, мусор и день вне диапазона дверь не открывают", async () => {
      for (const value of ["9", "0", "abc", "-1", "100"]) {
        window.history.replaceState(null, "", `/?day=${value}`);
        const harness = memoryAdventApi({ start: at(2) });
        await harness.ensureParticipant();
        const view = mount(harness.api);
        await waitFor(() => expect(document.querySelectorAll(".adv-door")).toHaveLength(12));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        view.unmount();
      }
    });
  });
});
