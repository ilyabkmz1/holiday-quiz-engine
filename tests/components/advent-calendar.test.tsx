// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CalendarView, DOOR_SHAPE } from "@/components/advent/CalendarView";
import type { AdventState } from "@/types/advent";

import { config, fiveStatusState } from "../support/advent-ui";

afterEach(cleanup);

let state: AdventState;
beforeAll(async () => {
  state = await fiveStatusState();
});

function mount(overrides: Partial<Parameters<typeof CalendarView>[0]> = {}) {
  const onOpen = vi.fn();
  const onHint = vi.fn();
  render(<CalendarView doors={state.doors} copy={config.copy} timezone="Europe/Moscow" phase="running" busy={null} onOpen={onOpen} onHint={onHint} {...overrides} />);
  return { onOpen, onHint };
}

const door = (n: number) => screen.getAllByRole("button").find((button) => button.getAttribute("data-door") === String(n))!;

describe("CalendarView: статусы дверей", () => {
  it("день 4 с открытым первым днём: у дверей есть все пять статусов", () => {
    mount();
    expect(state.doors.map((item) => item.status).slice(0, 5)).toEqual(["opened", "missed", "catchup", "today", "locked"]);
    expect(door(1)).toHaveAttribute("data-status", "opened");
    expect(door(2)).toHaveAttribute("data-status", "missed");
    expect(door(3)).toHaveAttribute("data-status", "catchup");
    expect(door(4)).toHaveAttribute("data-status", "today");
    expect(door(5)).toHaveAttribute("data-status", "locked");
  });

  it("статус виден не только цветом: у каждого свои форма, значок и подпись", () => {
    mount();
    const statuses = ["opened", "missed", "catchup", "today", "locked"] as const;
    const buttons = [1, 2, 3, 4, 5].map(door);
    expect(new Set(buttons.map((button) => button.dataset.shape)).size).toBe(5);
    expect(new Set(buttons.map((button) => button.querySelector("svg")!.getAttribute("data-icon"))).size).toBe(5);
    statuses.forEach((status, index) => expect(buttons[index].dataset.shape).toBe(DOOR_SHAPE[status]));
    expect(buttons[3]).toHaveTextContent(config.copy.doorToday);
    expect(buttons[2]).toHaveTextContent(config.copy.doorCatchup);
    expect(buttons[1]).toHaveTextContent(config.copy.doorMissed);
    expect(buttons[0]).toHaveTextContent(config.copy.doorOpened);
    expect(buttons[4]).toHaveTextContent(config.copy.doorLocked);
  });

  it("aria-метка: номер дня и статус, а у закрытой двери — когда она откроется", () => {
    mount();
    expect(door(4)).toHaveAccessibleName(/^День 4: Сегодня\./);
    expect(door(1)).toHaveAccessibleName(/^День 1: Открыта\. /);
    expect(door(5)).toHaveAccessibleName("День 5: Закрыта. Откроется 24 декабря");
    expect(door(2)).toHaveAccessibleName(`День 2: Пропущена. ${config.copy.doorMissedHint}`);
  });

  it("все двери в списке с подписью группы", () => {
    mount();
    expect(screen.getByRole("list", { name: config.copy.calendarTitle })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(12);
  });
});

describe("CalendarView: нажатия", () => {
  it("сегодняшняя, догоняемая и открытая двери открываются", () => {
    const { onOpen, onHint } = mount();
    for (const n of [4, 3, 1]) fireEvent.click(door(n));
    expect(onOpen.mock.calls).toEqual([[4], [3], [1]]);
    expect(onHint).not.toHaveBeenCalled();
  });

  it("закрытая и пропущенная двери не открываются, а объясняют почему", () => {
    const { onOpen, onHint } = mount();
    fireEvent.click(door(5));
    fireEvent.click(door(2));
    expect(onOpen).not.toHaveBeenCalled();
    expect(onHint).toHaveBeenNthCalledWith(1, "Откроется 24 декабря");
    expect(onHint).toHaveBeenNthCalledWith(2, config.copy.doorMissedHint);
  });

  it("вне основной фазы неоткрытая дверь не открывается (финал), открытая — открывается", () => {
    const { onOpen, onHint } = mount({ phase: "finale" });
    fireEvent.click(door(4));
    expect(onOpen).not.toHaveBeenCalled();
    expect(onHint).toHaveBeenCalledWith(config.copy.doorFinaleHint);
    fireEvent.click(door(1));
    expect(onOpen).toHaveBeenCalledWith(1);
  });
});

describe("CalendarView: клавиатура", () => {
  it("в сетку заходит одна остановка Tab — сегодняшняя дверь", () => {
    mount();
    const stops = screen.getAllByRole("button").filter((button) => button.tabIndex === 0);
    expect(stops).toEqual([door(4)]);
  });

  it("стрелки вправо и влево, Home и End двигают фокус", () => {
    mount();
    door(4).focus();
    fireEvent.keyDown(door(4), { key: "ArrowRight" });
    expect(door(5)).toHaveFocus();
    expect(door(5).tabIndex).toBe(0);
    expect(door(4).tabIndex).toBe(-1);
    fireEvent.keyDown(door(5), { key: "ArrowLeft" });
    expect(door(4)).toHaveFocus();
    fireEvent.keyDown(door(4), { key: "End" });
    expect(door(12)).toHaveFocus();
    fireEvent.keyDown(door(12), { key: "ArrowRight" });
    expect(door(12)).toHaveFocus();
    fireEvent.keyDown(door(12), { key: "Home" });
    expect(door(1)).toHaveFocus();
    fireEvent.keyDown(door(1), { key: "ArrowLeft" });
    expect(door(1)).toHaveFocus();
  });

  it("стрелки вверх и вниз переходят на строку (по числу дверей в первой строке)", () => {
    mount();
    // В jsdom нет вёрстки: первую строку из трёх дверей задаём положением.
    for (const button of screen.getAllByRole("button")) {
      const n = Number(button.getAttribute("data-door"));
      button.getBoundingClientRect = () => ({ top: Math.floor((n - 1) / 3) * 100, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
    }
    door(4).focus();
    fireEvent.keyDown(door(4), { key: "ArrowDown" });
    expect(door(7)).toHaveFocus();
    fireEvent.keyDown(door(7), { key: "ArrowUp" });
    fireEvent.keyDown(door(4), { key: "ArrowUp" });
    expect(door(1)).toHaveFocus();
    fireEvent.keyDown(door(1), { key: "ArrowUp" });
    expect(door(1)).toHaveFocus();
  });

  it("клавиши с модификаторами и прочие клавиши фокус не двигают", () => {
    mount();
    door(4).focus();
    fireEvent.keyDown(door(4), { key: "ArrowRight", ctrlKey: true });
    fireEvent.keyDown(door(4), { key: "a" });
    expect(door(4)).toHaveFocus();
  });
});
