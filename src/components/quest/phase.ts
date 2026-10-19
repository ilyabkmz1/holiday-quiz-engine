import { pendingRoomResume, type RoomResume } from "@/components/game/resume";
import type { SeenMark } from "@/components/game/seen";
import type { SessionProgress } from "@/types/api";

/**
 * Фазы квеста. Карточка комнаты внутри `room` живёт собственным потоком (`useRoomFlow`):
 * реплика героя → задание → разбор → итог. Остальные фазы — это мир и его сцены.
 *
 * prologue → explore ⇄ room → celebrate → (explore | rushIntro) → rush → finishing → final ⇄ claim
 */
export type QuestPhase =
  | { kind: "prologue" }
  | { kind: "explore" }
  | { kind: "room"; roomId: string; resume?: RoomResume }
  | { kind: "celebrate"; roomId: string }
  | { kind: "rushIntro" }
  | { kind: "rush" }
  | { kind: "finishing" }
  | { kind: "final" }
  | { kind: "claim" };

export type PhaseKind = QuestPhase["kind"];

export type QuestAction =
  /** Сессия загружена с сервера: вернуть игрока туда, где он остановился. */
  | { type: "resume"; session: SessionProgress; readMark: (taskId: string) => SeenMark | null }
  /** Сохранённой игры нет или она устарела. */
  | { type: "forget" }
  /** Пролог пройден, сессия создана. */
  | { type: "prologueDone" }
  | { type: "openRoom"; roomId: string }
  /** Карточка закрыта; `session` — свежие данные, по ним видно, закрыла ли комната. */
  | { type: "closeRoom"; session: SessionProgress | null }
  /** Праздник закончился. */
  | { type: "celebrated"; session: SessionProgress | null }
  | { type: "startRush" }
  | { type: "rushOver" }
  | { type: "finalReady" }
  | { type: "claim" }
  | { type: "back" };

export function allRoomsDone(session: SessionProgress | null): boolean {
  return !!session && session.rooms.length > 0 && session.rooms.every((room) => room.completed);
}

/** Куда вернуть игрока по данным сервера. Локальным догадкам не доверяем. */
export function phaseFromSession(session: SessionProgress, readMark: (taskId: string) => SeenMark | null): QuestPhase {
  if (session.status === "completed" && session.final) return { kind: "final" };
  if (session.rush) return session.rush.status === "running" ? { kind: "rush" } : { kind: "finishing" };
  const pending = pendingRoomResume(session, readMark);
  if (pending) return { kind: "room", roomId: pending.roomId, resume: pending };
  const open = session.rooms.find((room) => room.entered && !room.completed);
  if (open) return { kind: "room", roomId: open.roomId };
  if (allRoomsDone(session)) return { kind: "rushIntro" };
  return { kind: "explore" };
}

export function questReducer(state: QuestPhase, action: QuestAction): QuestPhase {
  switch (action.type) {
    case "resume":
      return phaseFromSession(action.session, action.readMark);
    case "forget":
      return { kind: "prologue" };
    case "prologueDone":
      return state.kind === "prologue" ? { kind: "explore" } : state;
    case "openRoom":
      return state.kind === "explore" ? { kind: "room", roomId: action.roomId } : state;
    case "closeRoom": {
      if (state.kind !== "room") return state;
      const done = action.session?.rooms.find((room) => room.roomId === state.roomId)?.completed;
      return done ? { kind: "celebrate", roomId: state.roomId } : { kind: "explore" };
    }
    case "celebrated":
      if (state.kind !== "celebrate") return state;
      return allRoomsDone(action.session) ? { kind: "rushIntro" } : { kind: "explore" };
    case "startRush":
      return state.kind === "rushIntro" ? { kind: "rush" } : state;
    case "rushOver":
      return state.kind === "rush" ? { kind: "finishing" } : state;
    case "finalReady":
      return state.kind === "finishing" ? { kind: "final" } : state;
    case "claim":
      return state.kind === "final" ? { kind: "claim" } : state;
    case "back":
      return state.kind === "claim" ? { kind: "final" } : state;
  }
}

/** Комнаты, где уже горит свет. Комната, которую игрок сейчас проходит или чей праздник идёт, ещё тёмная. */
export function litRooms(session: SessionProgress | null, phase: QuestPhase): ReadonlySet<string> {
  const lit = new Set((session?.rooms ?? []).filter((room) => room.completed).map((room) => room.roomId));
  if (phase.kind === "room") lit.delete(phase.roomId);
  if (phase.kind === "celebrate") lit.delete(phase.roomId);
  return lit;
}
