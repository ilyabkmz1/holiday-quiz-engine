/**
 * Собранные искорки: чисто игровая косметика, на очки не влияют. Список хранится в sessionStorage
 * по сессии, чтобы переживать перезагрузку и попадать на карточку «Поделиться». Любая ошибка хранилища
 * просто обнуляет счёт.
 */
const key = (sessionId: string) => `hqe-quest-flakes:${sessionId}`;

export function readFlakes(sessionId: string): string[] {
  try {
    const raw = window.sessionStorage.getItem(key(sessionId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function writeFlakes(sessionId: string, ids: Iterable<string>): void {
  try {
    window.sessionStorage.setItem(key(sessionId), JSON.stringify([...ids]));
  } catch {
    // Хранилище недоступно: счёт живёт до перезагрузки.
  }
}

/** Каждые столько снежинок робот делает трюк и «встряхивает» шар. */
export const FLAKE_PERK_EVERY = 8;
