// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuestGame } from "@/components/quest/QuestGame";
import { snowGlobe } from "../support/world";
import { campaign as config } from "@tenants/demo-office/campaign";
import { publicTask } from "@/server/presentation";
import { campaign, cued, finalSession, json, room, rushSession, stubResizeObserver } from "./quest-fixtures";

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.setItem("hqe-holiday-quiz-session", "s1");
  vi.stubGlobal("ResizeObserver", stubResizeObserver());
  Element.prototype.scrollTo = () => undefined;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("Квест: «Сыграть ещё раз»", () => {
  it("перезапускает пролог и мир с нуля: общий план, робот на месте, нет облачка Тимура и кнопки «Войти в офис»", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ campaign, session: finalSession() }));
    const { container } = render(<QuestGame campaign={campaign} world={snowGlobe} />);
    fireEvent.click(await screen.findByRole("button", { name: "Сыграть ещё раз" }));

    await waitFor(() => expect(container.querySelector("main.quest")).toHaveAttribute("data-phase", "prologue"));
    // Пролог начинается с общего плана: первая кнопка «Дальше», а не переключатель MFA.
    expect(await screen.findByRole("button", { name: "Дальше" })).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Войти в офис" })).not.toBeInTheDocument();
    // Мир перемонтирован: персонаж скрыт до приближения камеры, Тимура у входа нет, ёлка без игрушек.
    expect(container.querySelector(".qw-player")).toHaveAttribute("hidden");
    expect(container.querySelector(".qw-hero-prologue")).toBeNull();
    expect(container.querySelector(".qw-stage")).toHaveAttribute("data-stage", "prologue");
    expect(container.querySelectorAll('.qw-room[data-lit="true"]')).toHaveLength(0);
    expect(window.localStorage.getItem("hqe-holiday-quiz-session")).toBeNull();
  });
});

describe("Квест: открытая карточка", () => {
  function openRoomSession() {
    const mail = config.rooms[0];
    const entered = room("mail", { entered: true, enteredAt: new Date().toISOString(), currentTaskId: mail.tasks[0].id, taskShownAt: new Date().toISOString() });
    const base = cued();
    return { entered, session: { ...base, rooms: base.rooms.map((item) => (item.roomId === "mail" ? entered : item)) } };
  }

  it("пока карточка открыта, мир и HUD недоступны (inert), а Tab ходит по кругу внутри диалога", async () => {
    const { entered, session } = openRoomSession();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/enter")) return json({ room: entered });
      if (url.includes("/task")) return json({ room: entered, task: publicTask("mail", config.rooms[0].tasks[0], "s1"), taskNumber: 1 });
      return json({ campaign, session });
    });
    const { container } = render(<QuestGame campaign={campaign} world={snowGlobe} />);
    const dialog = await screen.findByRole("dialog", { name: /Заявка в комнате/ });
    await screen.findByRole("button", { name: /sever-0ffice\.ru/ });
    expect(container.querySelector(".qw-layer")).toHaveAttribute("inert");
    expect(container.querySelector(".qw-hud")).toHaveAttribute("inert");

    const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])")];
    expect(focusable.length).toBeGreaterThan(2);
    focusable.at(-1)!.focus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(focusable[0]);
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(focusable.at(-1));

    // Карточка закрыта — мир снова доступен.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(container.querySelector(".qw-layer")).not.toHaveAttribute("inert"));
    expect(container.querySelector(".qw-hud")).not.toHaveAttribute("inert");
  });

  it("итог игры тоже диалог: мир и HUD недоступны, поверх открывается «Поделиться» — тогда недоступна и карточка итога", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ campaign, session: finalSession() }));
    const { container } = render(<QuestGame campaign={campaign} world={snowGlobe} />);
    const result = await screen.findByRole("dialog", { name: "Результат игры" });
    expect(container.querySelector(".qw-hud")).toHaveAttribute("inert");
    expect(result).not.toHaveAttribute("inert");
    fireEvent.click(screen.getByRole("button", { name: /Поделиться/ }));
    expect(await screen.findByRole("dialog", { name: "Карточка результата" })).toBeInTheDocument();
    expect(result).toHaveAttribute("inert");
  });
});

describe("Квест: завершение игры после рывка", () => {
  function finishedRush() {
    const base = rushSession();
    return { ...base, rush: { ...base.rush!, status: "finished" as const, secondsLeft: 0, current: null } };
  }

  it("400 при завершении — настоящая ошибка (без повторов), а не «рывок ещё идёт»", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/complete")) {
        calls.push(`${init?.method} ${url}`);
        return new Response(JSON.stringify({ error: "Проверьте заполнение полей." }), { status: 400, headers: { "content-type": "application/json" } });
      }
      return json({ campaign, session: finishedRush() });
    });
    render(<QuestGame campaign={campaign} world={snowGlobe} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Проверьте заполнение полей.");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1300));
    });
    expect(calls).toHaveLength(1);
  });

  it("409 при идущем на сервере рывке — ждём и повторяем, затем показываем итог", async () => {
    let completes = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/complete")) {
        completes += 1;
        return completes === 1 ? new Response(JSON.stringify({ error: "Рывок ещё идёт." }), { status: 409, headers: { "content-type": "application/json" } }) : json({ score: 1500 });
      }
      return json({ campaign, session: completes >= 2 ? finalSession() : finishedRush() });
    });
    render(<QuestGame campaign={campaign} world={snowGlobe} />);
    expect(await screen.findByRole("dialog", { name: "Результат игры" }, { timeout: 4000 })).toBeInTheDocument();
    expect(completes).toBe(2);
  });
});
