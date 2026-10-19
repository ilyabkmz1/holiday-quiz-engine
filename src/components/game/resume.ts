import type { SeenMark } from "@/components/game/seen";
import type { SessionProgress } from "@/types/api";

export type RoomResume = { roomId: string; taskId: string; stage: "reveal" | "result" };

/**
 * Что показать, если игрок ответил на задание, но не нажал «дальше» (перезагрузка на разборе):
 * тот же разбор, а после ответа, закрывшего комнату, — ещё и её итог. Данные берутся с сервера
 * (`answers`, `summary`), локальна только отметка о шаге, на котором остановился игрок в этой вкладке.
 */
export function pendingRoomResume(
  session: SessionProgress,
  readMark: (taskId: string) => SeenMark | null
): RoomResume | null {
  const last = session.answers.at(-1);
  if (!last) return null;
  const mark = readMark(last.taskId);
  // Нет отметки — игрок не видел этого разбора в текущей вкладке или уже прошёл дальше.
  if (mark === null || mark === "done") return null;
  const room = session.rooms.find((candidate) => candidate.roomId === last.roomId);
  if (!room) return null;
  // Игрок уже вошёл в другую комнату: разбор прошлой он видел.
  const open = session.rooms.find((candidate) => candidate.entered && !candidate.completed);
  if (open && open.roomId !== room.roomId) return null;
  if (room.completed) {
    if (!room.summary) return null;
    return { roomId: room.roomId, taskId: last.taskId, stage: mark === "reveal" ? "result" : "reveal" };
  }
  if (mark === "reveal") return null;
  return { roomId: room.roomId, taskId: last.taskId, stage: "reveal" };
}
