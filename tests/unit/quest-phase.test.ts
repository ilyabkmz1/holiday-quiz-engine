import { describe, expect, it } from "vitest";

import { litRooms, phaseFromSession, questReducer, type QuestPhase } from "@/components/quest/phase";
import { campaign } from "@tenants/demo-office/campaign";
import type { RoomProgress, SessionProgress } from "@/types/api";

const room = (roomId: string, patch: Partial<RoomProgress> = {}): RoomProgress => ({
  roomId, entered: false, enteredAt: null, spentMs: 0, taskShownAt: null, answered: 0, completed: false, currentTaskId: null, next: null, fuses: 3, summary: null, ...patch
});
const session = (rooms: Partial<RoomProgress>[] = [], patch: Partial<SessionProgress> = {}): SessionProgress => ({
  id: "s1", status: "playing", score: 0, combo: 0,
  rooms: campaign.rooms.map((item, index) => room(item.id, rooms[index] ?? {})),
  roomsCompleted: 0, rushUnlocked: false, rush: null, answers: [], completedAt: null, final: null, ...patch
});
const none = () => null;
const done = { entered: true, completed: true, answered: 3 };

describe("фазы квеста по данным сервера", () => {
  it("новая игра — исследование мира", () => {
    expect(phaseFromSession(session(), none)).toEqual({ kind: "explore" });
  });

  it("открытая, но не пройденная комната возвращает в комнату", () => {
    expect(phaseFromSession(session([{ entered: true, answered: 1 }]), none)).toEqual({ kind: "room", roomId: campaign.rooms[0].id });
  });

  it("все пять комнат пройдены, рывка нет — вступление в рывок", () => {
    expect(phaseFromSession(session(Array(5).fill(done)), none)).toEqual({ kind: "rushIntro" });
  });

  it("идущий рывок — rush, завершённый — finishing, итог — final", () => {
    const rush = { status: "running", startedAt: "", deadlineAt: "", serverNow: "", secondsLeft: 20, answered: 0, hits: 0, misses: 0, points: 0, total: 16, current: null } as const;
    expect(phaseFromSession(session(Array(5).fill(done), { rush }), none)).toEqual({ kind: "rush" });
    expect(phaseFromSession(session(Array(5).fill(done), { rush: { ...rush, status: "finished" } }), none)).toEqual({ kind: "finishing" });
    const final = { score: 1, level: campaign.rewardTiers[0], rooms: [], rushHits: 0, rushPoints: 0, ornaments: [] };
    expect(phaseFromSession(session(Array(5).fill(done), { status: "completed", final }), none)).toEqual({ kind: "final" });
  });
});

describe("редьюсер фаз", () => {
  const explore: QuestPhase = { kind: "explore" };

  it("пролог → мир → комната → праздник → мир", () => {
    let phase = questReducer({ kind: "prologue" }, { type: "prologueDone" });
    expect(phase).toEqual(explore);
    phase = questReducer(phase, { type: "openRoom", roomId: "mail" });
    expect(phase).toEqual({ kind: "room", roomId: "mail" });
    phase = questReducer(phase, { type: "closeRoom", session: session([{ ...done }]) });
    expect(phase).toEqual({ kind: "celebrate", roomId: "mail" });
    phase = questReducer(phase, { type: "celebrated", session: session([{ ...done }]) });
    expect(phase).toEqual(explore);
  });

  it("закрытие карточки без завершённой комнаты возвращает в мир без праздника", () => {
    expect(questReducer({ kind: "room", roomId: "mail" }, { type: "closeRoom", session: session([{ entered: true, answered: 1 }]) })).toEqual(explore);
  });

  it("праздник последней комнаты ведёт во вступление в рывок; тупика нет", () => {
    const all = session(Array(5).fill(done));
    expect(questReducer({ kind: "celebrate", roomId: "projects" }, { type: "celebrated", session: all })).toEqual({ kind: "rushIntro" });
    expect(questReducer({ kind: "rushIntro" }, { type: "startRush" })).toEqual({ kind: "rush" });
    expect(questReducer({ kind: "rush" }, { type: "rushOver" })).toEqual({ kind: "finishing" });
    expect(questReducer({ kind: "finishing" }, { type: "finalReady" })).toEqual({ kind: "final" });
    expect(questReducer({ kind: "final" }, { type: "claim" })).toEqual({ kind: "claim" });
    expect(questReducer({ kind: "claim" }, { type: "back" })).toEqual({ kind: "final" });
  });

  it("лишние действия в чужой фазе игнорируются", () => {
    expect(questReducer(explore, { type: "startRush" })).toBe(explore);
    expect(questReducer(explore, { type: "closeRoom", session: null })).toBe(explore);
    expect(questReducer({ kind: "rush" }, { type: "openRoom", roomId: "mail" })).toEqual({ kind: "rush" });
  });

  it("забытая сессия возвращает в пролог, resume — туда, где остановились", () => {
    expect(questReducer({ kind: "final" }, { type: "forget" })).toEqual({ kind: "prologue" });
    expect(questReducer({ kind: "prologue" }, { type: "resume", session: session([{ entered: true }]), readMark: none })).toEqual({ kind: "room", roomId: campaign.rooms[0].id });
  });
});

describe("свет в комнатах", () => {
  it("комната, которую проходят или празднуют, ещё тёмная", () => {
    const s = session([done, done]);
    expect([...litRooms(s, { kind: "explore" })].sort()).toEqual([campaign.rooms[0].id, campaign.rooms[1].id].sort());
    expect(litRooms(s, { kind: "room", roomId: campaign.rooms[1].id }).has(campaign.rooms[1].id)).toBe(false);
    expect(litRooms(s, { kind: "celebrate", roomId: campaign.rooms[0].id }).has(campaign.rooms[0].id)).toBe(false);
  });
});
