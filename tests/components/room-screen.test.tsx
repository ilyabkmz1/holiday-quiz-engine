// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderInWorld as render } from "./world-render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RoomScreen } from "@/components/game/RoomScreen";
import { readSeen } from "@/components/game/seen";
import { campaign as config } from "@tenants/demo-office/campaign";
import { publicCampaign, publicTask } from "@/server/presentation";
import type { RoomProgress, SessionProgress, TaskReveal } from "@/types/api";

const campaign = publicCampaign(config);
const roomConfig = config.rooms[0];
const [first, second] = roomConfig.tasks;
const publicRoom = campaign.rooms.find((item) => item.id === roomConfig.id)!;

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function reveal(taskId: string): TaskReveal {
  return {
    taskId, roomId: roomConfig.id, type: "pick", payload: { optionId: "x" }, base: 100, comboBonus: 0, combo: 1,
    outcome: "perfect", correctIds: ["x"], explanation: "Разбор прошлой заявки", tip: "Совет", mood: "happy",
    line: "Спасибо!", fuses: 3, answeredAt: new Date().toISOString()
  };
}

function progress(patch: Partial<RoomProgress>): RoomProgress {
  return {
    roomId: roomConfig.id, entered: true, enteredAt: new Date().toISOString(), spentMs: 1000, taskShownAt: null,
    answered: 1, completed: false, currentTaskId: second.id, next: null, fuses: 3, summary: null, ...patch
  };
}

function session(rooms: RoomProgress[], answers: TaskReveal[]): SessionProgress {
  return { id: "s1", status: "playing", score: 100, combo: 1, rooms, roomsCompleted: 0, rushUnlocked: false, rush: null, answers, completedAt: null, final: null };
}

function mount(state: SessionProgress, resume?: Parameters<typeof RoomScreen>[0]["resume"]) {
  const onExit = vi.fn();
  render(
    <RoomScreen
      campaign={campaign}
      sessionId="s1"
      roomId={roomConfig.id}
      resume={resume}
      session={state}
      skewMs={0}
      onPatch={() => undefined}
      onRefresh={async () => undefined}
      onExit={onExit}
      onError={() => undefined}
    />
  );
  return onExit;
}

describe("RoomScreen: восстановление на разборе", () => {
  it("после перезагрузки показывает разбор отвеченного задания, фокус на «дальше», затем следующее задание", async () => {
    const state = session([progress({})], [reveal(first.id)]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes(`taskId=${first.id}`)) {
        return json({ room: progress({}), task: publicTask(roomConfig.id, first, "s1"), taskNumber: 1 });
      }
      return json({ room: progress({ taskShownAt: new Date().toISOString() }), task: publicTask(roomConfig.id, second, "s1"), taskNumber: 2 });
    });
    mount(state, { roomId: roomConfig.id, taskId: first.id, stage: "reveal" });

    expect(await screen.findByText("Разбор прошлой заявки")).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "Следующая заявка" });
    expect(next).toHaveFocus();
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/task?taskId=${first.id}`);
    // Вход в комнату при восстановлении не нужен.
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/enter"))).toBe(false);

    fireEvent.click(next);
    await waitFor(() => expect(screen.queryByText("Разбор прошлой заявки")).not.toBeInTheDocument());
    expect(readSeen("s1", first.id)).toBe("done");
    // Новая заявка забирает фокус на первый вариант.
    await waitFor(() => expect(document.activeElement?.closest('[role="group"]')).not.toBeNull());
    expect(document.activeElement?.tagName).toBe("BUTTON");
  });

  it("после ответа, закрывшего комнату: разбор, затем итог комнаты из summary, затем выход", async () => {
    const last = roomConfig.tasks[2];
    const summary = { roomId: roomConfig.id, answered: 3, completed: true, base: 300, comboBonus: 20, speedBonus: 30, noFailBonus: 100, total: 450, fuses: 3, elapsedSeconds: 40 };
    const done = progress({ answered: 3, completed: true, currentTaskId: null, summary: summary as RoomProgress["summary"] });
    const state = session([done], [reveal(last.id)]);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ room: done, task: publicTask(roomConfig.id, last, "s1"), taskNumber: 3 }));
    const onExit = mount(state, { roomId: roomConfig.id, taskId: last.id, stage: "reveal" });

    fireEvent.click(await screen.findByRole("button", { name: "Включить свет в комнате" }));
    expect(await screen.findByRole("heading", { level: 2, name: `${publicRoom.title}: свет включён` })).toBeInTheDocument();
    expect(readSeen("s1", last.id)).toBe("reveal");

    fireEvent.click(screen.getByRole("button", { name: /Вернуться в офис|К карте/ }));
    expect(readSeen("s1", last.id)).toBe("done");
    expect(onExit).toHaveBeenCalled();
  });

  it("перезагрузка на итоге комнаты возвращает сразу итог", async () => {
    const last = roomConfig.tasks[2];
    const summary = { roomId: roomConfig.id, answered: 3, completed: true, base: 300, comboBonus: 20, speedBonus: 30, noFailBonus: 100, total: 450, fuses: 3, elapsedSeconds: 40 };
    const done = progress({ answered: 3, completed: true, currentTaskId: null, summary: summary as RoomProgress["summary"] });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("сеть не нужна"));
    mount(session([done], [reveal(last.id)]), { roomId: roomConfig.id, taskId: last.id, stage: "result" });
    expect(await screen.findByRole("heading", { level: 2, name: `${publicRoom.title}: свет включён` })).toBeInTheDocument();
  });
});

describe("RoomScreen: доступность", () => {
  it("держит постоянный живой регион с репликой героя вне пересоздаваемого блока задания", async () => {
    const state = session([progress({ answered: 0, currentTaskId: first.id })], []);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).endsWith("/enter")
        ? json({ room: progress({ answered: 0 }) })
        : json({ room: progress({ answered: 0, currentTaskId: first.id }), task: publicTask(roomConfig.id, first, "s1"), taskNumber: 1 })
    );
    mount(state);
    await screen.findAllByText((text) => text.includes(first.say));
    const region = screen.getAllByRole("status").find((element) => element.textContent?.includes(first.say));
    expect(region).toBeDefined();
    expect(region!.closest(".room-layout")).toBeNull();
  });
});
