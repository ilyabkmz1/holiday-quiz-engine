import { SESSION_STORAGE_KEY } from "@/components/game/api";

/** Сохранённая сессия: общий ключ у обоих режимов, поэтому игру можно продолжить в другом. */
export function readStoredSession(): string | null {
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeSession(id: string | null) {
  try {
    if (id) window.localStorage.setItem(SESSION_STORAGE_KEY, id);
    else window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Хранилище недоступно (приватный режим): игра идёт, но без восстановления после перезагрузки.
  }
}
