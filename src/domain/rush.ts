/** Правила рывка. Время считает только сервер; клиентский таймер нужен лишь для показа. */
export const RUSH = {
  durationMs: 30_000,
  penaltyMs: 2_000,
  // Допуск на сеть: ответ, пришедший не позже дедлайна + 2 с, ещё принимается.
  graceMs: 2_000
} as const;

export function initialDeadline(startedAt: Date): Date {
  return new Date(startedAt.getTime() + RUSH.durationMs);
}

/** Ошибка сдвигает дедлайн на 2 секунды раньше. */
export function penalizedDeadline(deadlineAt: Date): Date {
  return new Date(deadlineAt.getTime() - RUSH.penaltyMs);
}

/** Принимает ли рывок ответы в момент `now` (дедлайн сервера плюс допуск на сеть). */
export function rushAcceptsAnswers(run: { deadlineAt: Date; finishedAt: Date | null }, now: Date): boolean {
  return run.finishedAt === null && now.getTime() <= run.deadlineAt.getTime() + RUSH.graceMs;
}

/** Секунд до дедлайна для отображения (0 после дедлайна), с округлением вверх. */
export function secondsLeft(deadlineAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((deadlineAt.getTime() - now.getTime()) / 1000));
}

/** Перемешивание Фишера — Йетса; `random` возвращает число из [0, 1). */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}
