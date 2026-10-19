import { describe, expect, it } from "vitest";

import { pendingRoomResume } from "@/components/game/resume";
import type { RoomProgress, SessionProgress, TaskReveal } from "@/types/api";

const reveal = (taskId: string, roomId: string): TaskReveal =>
  ({ taskId, roomId, type: "pick", payload: { optionId: "a" }, base: 100 }) as TaskReveal;

function room(roomId: string, patch: Partial<RoomProgress> = {}): RoomProgress {
  return { roomId, entered: false, enteredAt: null, spentMs: 0, taskShownAt: null, answered: 0, completed: false, currentTaskId: null, next: null, fuses: 3, summary: null, ...patch };
}

const summary = { roomId: "mail", total: 1 } as unknown as NonNullable<RoomProgress["summary"]>;

function session(rooms: RoomProgress[], answers: TaskReveal[]): SessionProgress {
  return { id: "s", status: "playing", score: 0, combo: 0, rooms, roomsCompleted: 0, rushUnlocked: false, rush: null, answers, completedAt: null, final: null };
}

const none = () => null;

describe("pendingRoomResume", () => {
  it("ничего не требует, пока ответов нет", () => {
    expect(pendingRoomResume(session([room("mail", { entered: true })], []), none)).toBeNull();
  });

  it("возвращает разбор последнего ответа в открытой комнате, если игрок не нажал «дальше»", () => {
    const state = session([room("mail", { entered: true, answered: 1 })], [reveal("t1", "mail")]);
    expect(pendingRoomResume(state, () => "pending")).toEqual({ roomId: "mail", taskId: "t1", stage: "reveal" });
  });

  it("не навязывает разбор без отметки: ответ дан в другой вкладке или по API", () => {
    const state = session([room("mail", { entered: true, answered: 1 })], [reveal("t1", "mail")]);
    expect(pendingRoomResume(state, none)).toBeNull();
    const finished = session([room("mail", { entered: true, answered: 3, completed: true, summary })], [reveal("t3", "mail")]);
    expect(pendingRoomResume(finished, none)).toBeNull();
  });

  it("не возвращает разбор, если он уже просмотрен", () => {
    const state = session([room("mail", { entered: true, answered: 1 })], [reveal("t1", "mail")]);
    expect(pendingRoomResume(state, () => "done")).toBeNull();
  });

  it("после ответа, закрывшего комнату, сначала разбор, затем итог комнаты, затем карта", () => {
    const state = session([room("mail", { entered: true, answered: 3, completed: true, summary })], [reveal("t3", "mail")]);
    expect(pendingRoomResume(state, () => "pending")).toEqual({ roomId: "mail", taskId: "t3", stage: "reveal" });
    expect(pendingRoomResume(state, () => "reveal")).toEqual({ roomId: "mail", taskId: "t3", stage: "result" });
    expect(pendingRoomResume(state, () => "done")).toBeNull();
  });

  it("игнорирует разбор прошлой комнаты, если игрок уже вошёл в другую", () => {
    const state = session(
      [room("mail", { entered: true, answered: 3, completed: true, summary }), room("files", { entered: true })],
      [reveal("t1", "mail")]
    );
    expect(pendingRoomResume(state, () => "pending")).toBeNull();
  });
});
