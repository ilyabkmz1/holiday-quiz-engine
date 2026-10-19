/**
 * Отметки о разборе задания в sessionStorage (по сессии и заданию). Нужны только для
 * восстановления после перезагрузки: если игрок ответил в этой вкладке, но не нажал «дальше»,
 * ему снова показывается тот же разбор, а после ответа, закрывшего комнату, — ещё и итог комнаты.
 * Без отметки (ответы из другой вкладки или устройства) разбор не навязывается.
 * - `pending`: ответ получен, разбор на экране, «дальше» ещё не нажато;
 * - `reveal`: разбор пройден, на экране итог комнаты;
 * - `done`: игрок прошёл дальше, показывать нечего.
 */
export type SeenMark = "pending" | "reveal" | "done";

const key = (sessionId: string, taskId: string) => `hqe-quiz-seen:${sessionId}:${taskId}`;

export function readSeen(sessionId: string, taskId: string): SeenMark | null {
  try {
    const value = window.sessionStorage.getItem(key(sessionId, taskId));
    return value === "pending" || value === "reveal" || value === "done" ? value : null;
  } catch {
    return null;
  }
}

export function writeSeen(sessionId: string, taskId: string, mark: SeenMark): void {
  try {
    window.sessionStorage.setItem(key(sessionId, taskId), mark);
  } catch {
    // Хранилище недоступно: после перезагрузки игрок просто продолжит со следующего шага.
  }
}
