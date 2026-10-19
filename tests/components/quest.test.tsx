// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderInWorld as render } from "./world-render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuestRoomFlow } from "@/components/quest/QuestRoomFlow";
import { QuestWorld, type HeroView } from "@/components/quest/QuestWorld";
import { readSeen } from "@/components/game/seen";
import { campaign as config } from "@tenants/demo-office/campaign";
import { publicCampaign, publicTask } from "@/server/presentation";
import type { AnswerResponse, RoomProgress, SessionProgress, TaskReveal } from "@/types/api";

const campaign = publicCampaign(config);
const mailConfig = config.rooms[0];
const [firstTask, secondTask] = mailConfig.tasks;

beforeEach(() => {
  window.sessionStorage.clear();
  // jsdom не знает ResizeObserver; размеры вьюпорта для логики игры не нужны
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function room(roomId: string, patch: Partial<RoomProgress> = {}): RoomProgress {
  return { roomId, entered: false, enteredAt: null, spentMs: 0, taskShownAt: null, answered: 0, completed: false, currentTaskId: null, next: null, fuses: 3, summary: null, ...patch };
}

function session(patch: Partial<SessionProgress> = {}): SessionProgress {
  return {
    id: "s1", status: "playing", score: 0, combo: 0, rooms: campaign.rooms.map((item) => room(item.id)), roomsCompleted: 0,
    rushUnlocked: false, rush: null, answers: [], completedAt: null, final: null, ...patch
  };
}

function cued(): SessionProgress {
  return session({
    rooms: config.rooms.map((item) => room(item.id, { next: { heroId: item.tasks[0].heroId, say: item.tasks[0].say } }))
  });
}

function mountWorld(options: { lit?: string[]; heroes?: Record<string, HeroView>; stage?: "explore" | "room"; focusRoom?: string | null; session?: SessionProgress } = {}) {
  const onHelp = vi.fn();
  render(
    <QuestWorld
      campaign={campaign}
      session={options.session ?? cued()}
      heroes={options.heroes ?? {}}
      stage={options.stage ?? "explore"}
      lit={new Set(options.lit ?? [])}
      focusRoom={options.focusRoom ?? null}
      sheet={{ bottom: 0, right: 0 }}
      goalRoom={campaign.rooms.find((item) => !(options.lit ?? []).includes(item.id))?.id ?? null}
      bubbles={[]}
      celebrate={null}
      onCelebrated={() => undefined}
      fault={null}
      prologueStep={3}
      prologueHero={null}
      services={null}
      onService={() => undefined}
      onHelp={onHelp}
      onFlakes={() => undefined}
      finale={false}
      treeFlakes={0}
    />
  );
  return onHelp;
}

/** Через список комнат (без ходьбы) подходит к герою; рядом с ним цикл мира замечает близость. */
async function approach(title: string) {
  fireEvent.click(screen.getByRole("button", { name: "Список комнат" }));
  const list = screen.getByRole("dialog", { name: "Список комнат" });
  fireEvent.click(within(list).getByRole("button", { name: new RegExp(title) }));
}

const spoken = (text: string) => screen.getAllByRole("status").some((region) => region.textContent?.includes(text));

describe("Квест: мир и взаимодействие с героем", () => {
  it("в начале игрок далеко от героев: кнопки «Помочь» нет, список комнат и цель доступны", () => {
    mountWorld();
    expect(screen.queryByRole("button", { name: /Помочь/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Список комнат" })).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /Настроение/ }).length).toBe(campaign.rooms.length);
    expect(document.querySelector('[data-pointer="goal"]')).not.toBeNull();
  });

  it("герой до входа в комнату говорит настоящую реплику своей заявки; «Помочь» открывает её после подхода к площадке", async () => {
    const onHelp = mountWorld();
    await approach("Почтовая");
    const help = await screen.findByRole("button", { name: "Помочь: Тимур" });
    await waitFor(() => expect(spoken(`Тимур, системный администратор: ${firstTask.say}`)).toBe(true));
    fireEvent.click(help);
    // Карточка открывается не на ходу: персонаж сначала поворачивается к герою.
    expect(onHelp).not.toHaveBeenCalled();
    await waitFor(() => expect(onHelp).toHaveBeenCalledWith("mail"), { timeout: 3000 });
  });

  it("доступны все пять комнат: у каждой герой зовёт на помощь по своей реплике", async () => {
    for (const item of config.rooms) {
      cleanup();
      mountWorld();
      await approach(item.title);
      await screen.findByRole("button", { name: /^Помочь: / });
      await waitFor(() => expect(spoken(item.tasks[0].say)).toBe(true));
      expect(spoken("Скоро открою дверь")).toBe(false);
    }
  });

  it("Enter рядом с героем открывает заявку; вдали от героев ничего не происходит", async () => {
    const onHelp = mountWorld();
    fireEvent.keyDown(window, { key: "Enter" });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(onHelp).not.toHaveBeenCalled();
    await approach("Почтовая");
    await screen.findByRole("button", { name: "Помочь: Тимур" });
    fireEvent.keyDown(window, { key: " " });
    await waitFor(() => expect(onHelp).toHaveBeenCalledWith("mail"), { timeout: 3000 });
  });

  it("у пройденной комнаты герой благодарит и больше не зовёт на помощь", async () => {
    const onHelp = mountWorld({ lit: ["mail"] });
    await approach("Почтовая");
    await waitFor(() => expect(spoken("Спасибо!")).toBe(true));
    expect(screen.queryByRole("button", { name: /Помочь/ })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onHelp).not.toHaveBeenCalled();
  });

  it("герой задания подменяет «хозяина» комнаты и реагирует настроением, пока открыта карточка", async () => {
    mountWorld({ stage: "room", focusRoom: "mail", heroes: { mail: { heroId: "marina", mood: "happy" } } });
    expect(screen.getByRole("img", { name: /^Марина, руководитель офиса\. Настроение: радость/ })).toBeInTheDocument();
  });

  it("после закрытия карточки имя героя, кнопка «Помочь» и реплика берутся из следующей заявки, а не из прошлого разбора", async () => {
    const next = { heroId: "marina", say: "Марина: срочно нужен доступ!" };
    const withNext = session({ rooms: cued().rooms.map((item) => (item.roomId === "mail" ? { ...item, entered: true, answered: 1, next } : item)) });
    // Прошлое задание комнаты вёл Тимур: его настроение осталось в состоянии мира.
    mountWorld({ session: withNext, heroes: { mail: { heroId: "timur", mood: "happy" } } });
    // Марина уже у «Почтовой» (плюс её собственный «Штаб ярмарки»); Тимура в мире нет.
    expect(screen.getAllByRole("img", { name: /^Марина, руководитель офиса/ })).toHaveLength(2);
    expect(screen.queryByRole("img", { name: /^Тимур/ })).not.toBeInTheDocument();
    await approach("Почтовая");
    expect(await screen.findByRole("button", { name: "Помочь: Марина" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Помочь: Тимур" })).not.toBeInTheDocument();
    await waitFor(() => expect(spoken("Марина, руководитель офиса: Марина: срочно нужен доступ!")).toBe(true));
  });

  it("Escape в списке комнат закрывает его и возвращает фокус на кнопку", async () => {
    mountWorld();
    const button = screen.getByRole("button", { name: "Список комнат" });
    fireEvent.click(button);
    expect(screen.getByRole("dialog", { name: "Список комнат" })).toHaveAttribute("aria-modal", "true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Список комнат" })).not.toBeInTheDocument();
    // Кнопка была inert, пока список был открыт: фокус возвращается после перерисовки.
    await waitFor(() => expect(button).toHaveFocus());
  });

  it("стрелки не мешают чтению в полях ввода", () => {
    mountWorld();
    const input = document.createElement("input");
    document.body.append(input);
    const event = new KeyboardEvent("keydown", { code: "ArrowUp", bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    input.remove();
    const world = new KeyboardEvent("keydown", { code: "ArrowUp", bubbles: true, cancelable: true });
    document.body.dispatchEvent(world);
    expect(world.defaultPrevented).toBe(true);
  });
});

describe("Квест: карточка задания на API сессий", () => {
  function reveal(taskId: string): TaskReveal {
    return {
      taskId, roomId: "mail", type: "phish", payload: { optionId: "m2" }, base: 100, comboBonus: 0, combo: 1, outcome: "perfect",
      correctIds: ["m2"], explanation: "Разбор подделки", tip: "Совет игроку", mood: "happy", line: "Спасибо!", fuses: 3, answeredAt: new Date().toISOString()
    };
  }

  it("входит в комнату, показывает задание компактно, принимает ответ, сообщает герою настроение и ведёт к следующей заявке", async () => {
    const entered = room("mail", { entered: true, enteredAt: new Date().toISOString(), currentTaskId: firstTask.id, taskShownAt: new Date().toISOString() });
    const afterAnswer = room("mail", { entered: true, answered: 1, currentTaskId: secondTask.id });
    const answerResponse: AnswerResponse = { reveal: reveal(firstTask.id), score: 100, room: afterAnswer, roomResult: null, nextTaskId: secondTask.id };
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/enter")) return json({ room: entered });
      if (url.endsWith("/answers")) return json(answerResponse);
      const current = calls.filter((call) => call.includes("/task")).length > 1;
      return json(current
        ? { room: afterAnswer, task: publicTask("mail", secondTask, "s1"), taskNumber: 2 }
        : { room: entered, task: publicTask("mail", firstTask, "s1"), taskNumber: 1 });
    });
    const onTask = vi.fn();
    const onAnswered = vi.fn();
    const onView = vi.fn();
    const onPatch = vi.fn();
    const layoutless = undefined;
    void layoutless;
    render(
      <QuestRoomFlow
        campaign={campaign}
        sessionId="s1"
        roomId="mail"
        session={session()}
        skewMs={0}
        onPatch={onPatch}
        onRefresh={async () => undefined}
        onView={onView}
        onTask={onTask}
        onAnswered={onAnswered}
        onClose={() => undefined}
        onError={(error) => {
          throw error;
        }}
      />
    );

    // Вход (идемпотентный) → задание. Сцена плоская: фон-иллюстрация комнаты не грузится.
    expect((await screen.findAllByText(/Найдите подделку/)).length).toBeGreaterThan(0);
    expect(calls[0]).toBe("POST /api/sessions/s1/rooms/mail/enter");
    expect(document.querySelector(".scene-img")).toBeNull();
    expect(onTask).toHaveBeenCalledWith(expect.objectContaining({ id: firstTask.id, heroId: "timur" }));
    // Реплика героя звучит в мире, а на карточке её нет (только механика).
    expect(document.querySelector(".bubble")).toBeNull();
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ phase: "task", line: firstTask.say, heroId: "timur" }));

    // Ответ: подделка → «в карантин»
    const fake = await screen.findByRole("button", { name: /sever-0ffice\.ru/ });
    fireEvent.click(fake);
    fireEvent.click(screen.getByRole("button", { name: /Это подделка/ }));
    expect(await screen.findByText("Разбор подделки")).toBeInTheDocument();
    expect(onAnswered).toHaveBeenCalledWith(expect.objectContaining({ reveal: expect.objectContaining({ mood: "happy" }) }), expect.objectContaining({ id: firstTask.id }));
    expect(onView).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "reveal", mood: "happy", line: "Спасибо!" }));
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(readSeen("s1", firstTask.id)).toBe("pending");
    expect(JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls.find(([url]) => String(url).endsWith("/answers"))![1]!.body))).toEqual({
      taskId: firstTask.id,
      payload: { optionId: "m2" }
    });

    // Следующая заявка — новый герой и свежее задание
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Следующая заявка" }));
    });
    await waitFor(() => expect(onTask).toHaveBeenLastCalledWith(expect.objectContaining({ id: secondTask.id })));
    expect(readSeen("s1", firstTask.id)).toBe("done");
  });

  it("закрытие карточки (×, Escape) после ответа отмечает разбор прочитанным: перезагрузка не вернёт в разбор пройденной комнаты", async () => {
    const entered = room("mail", { entered: true, enteredAt: new Date().toISOString(), currentTaskId: firstTask.id, taskShownAt: new Date().toISOString() });
    const afterAnswer = room("mail", { entered: true, answered: 1, currentTaskId: secondTask.id });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/enter")) return json({ room: entered });
      if (url.endsWith("/answers")) return json({ reveal: reveal(firstTask.id), score: 100, room: afterAnswer, roomResult: null, nextTaskId: secondTask.id });
      return json({ room: entered, task: publicTask("mail", firstTask, "s1"), taskNumber: 1 });
    });
    const view = render(
      <QuestRoomFlow campaign={campaign} sessionId="s1" roomId="mail" session={session()} skewMs={0} onPatch={() => undefined} onRefresh={async () => undefined}
        onView={() => undefined} onTask={() => undefined} onAnswered={() => undefined} onClose={() => undefined} onError={(error) => { throw error; }} />
    );
    fireEvent.click(await screen.findByRole("button", { name: /sever-0ffice\.ru/ }));
    fireEvent.click(screen.getByRole("button", { name: /Это подделка/ }));
    await screen.findByText("Разбор подделки");
    expect(readSeen("s1", firstTask.id)).toBe("pending");
    view.unmount();
    expect(readSeen("s1", firstTask.id)).toBe("done");
  });
});
