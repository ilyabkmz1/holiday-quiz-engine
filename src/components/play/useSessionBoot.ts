"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, gameApi } from "@/components/game/api";
import { readStoredSession, storeSession } from "@/components/play/storage";
import { shouldForgetSession } from "@/domain/session-recovery";
import type { PublicCampaign, SessionProgress } from "@/types/api";

export type SessionBootOptions = {
  campaign: PublicCampaign;
  /** Сессия загружена с сервера (после перезагрузки страницы или при конфликте 409): решить, куда вернуть игрока. */
  onResume: (session: SessionProgress) => void;
  /** Сохранённой игры нет или она устарела: начать с начала. */
  onForget: () => void;
};

/**
 * Загрузка и жизнь сессии, общие для обоих режимов: восстановление по сохранённому id,
 * создание новой, обновление с сервера, локальные правки после ответа и единый разбор ошибок API.
 * Состояние всегда берётся с сервера; локально хранится только id сессии.
 */
export function useSessionBoot({ campaign: initialCampaign, onResume, onForget }: SessionBootOptions) {
  const [campaign, setCampaign] = useState<PublicCampaign>(initialCampaign);
  const [session, setSession] = useState<SessionProgress | null>(null);
  const [skewMs, setSkewMs] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);
  const idRef = useRef<string | null>(null);
  const callbacks = useRef({ onResume, onForget });
  useEffect(() => {
    callbacks.current = { onResume, onForget };
  });

  const applyServerTime = useCallback((serverDate: number | null) => {
    // Заголовок Date точен до секунды, поэтому добавляем середину интервала.
    if (serverDate !== null) setSkewMs(serverDate + 500 - Date.now());
  }, []);

  const forget = useCallback((message: string | null) => {
    storeSession(null);
    idRef.current = null;
    setSession(null);
    if (message) setNotice(message);
    callbacks.current.onForget();
  }, []);

  const load = useCallback(
    async (id: string, resume: boolean, isCancelled: () => boolean = () => false) => {
      const loaded = await gameApi.getSession(id);
      applyServerTime(loaded.serverDate);
      idRef.current = loaded.session.id;
      setCampaign(loaded.campaign);
      setSession(loaded.session);
      // Загрузка отменена (размонтирование; в dev StrictMode запускает эффект дважды): решать, куда вернуть игрока, должен
      // только последний запуск. Иначе первый ответ откроет разбор и отметит его «прочитанным», а второй по этой отметке отправит на карту.
      if (resume && !isCancelled()) callbacks.current.onResume(loaded.session);
      return loaded.session;
    },
    [applyServerTime]
  );

  const handleError = useCallback(
    (error: unknown) => {
      const status = error instanceof ApiError ? error.status : undefined;
      if (shouldForgetSession(status)) {
        forget("Игра не найдена или устарела. Начнём заново.");
        return;
      }
      if (status === 429) {
        setNotice("Слишком много запросов. Подождите минуту и повторите.");
        return;
      }
      if (status === 409) {
        setNotice("Состояние игры обновилось. Продолжаем с того места, где остановились.");
        const id = readStoredSession();
        if (id) void load(id, true).catch(() => undefined);
        return;
      }
      setNotice(error instanceof Error ? error.message : "Что-то пошло не так. Повторите.");
    },
    [forget, load]
  );
  const errorRef = useRef(handleError);
  useEffect(() => {
    errorRef.current = handleError;
  });
  /** Стабильная ссылка: можно класть в зависимости эффектов без их перезапуска. */
  const onError = useCallback((error: unknown) => errorRef.current(error), []);

  // Восстановление после перезагрузки: сессия берётся с сервера.
  useEffect(() => {
    const id = readStoredSession();
    if (!id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- чтение localStorage доступно только в браузере
      setBooted(true);
      callbacks.current.onForget();
      return;
    }
    let cancelled = false;
    load(id, true, () => cancelled)
      .then(() => {
        if (!cancelled) setBooted(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setBooted(true);
        const status = error instanceof ApiError ? error.status : undefined;
        if (shouldForgetSession(status)) forget("Предыдущая игра не найдена. Начнём заново.");
        else setFatal(error instanceof Error ? error.message : "Не удалось загрузить игру.");
      });
    return () => {
      cancelled = true;
    };
  }, [load, forget]);

  /** Обновить сессию с сервера, не трогая экран. */
  const refresh = useCallback(async () => {
    const id = idRef.current ?? readStoredSession();
    if (!id) return;
    try {
      await load(id, false);
    } catch (error) {
      errorRef.current(error);
    }
  }, [load]);

  /** Перечитать сессию и вернуть игрока туда, где его застал сервер (`onResume`). */
  const reload = useCallback(
    async (resume: boolean) => {
      const id = idRef.current ?? readStoredSession();
      if (!id) return null;
      return load(id, resume);
    },
    [load]
  );

  /** Новая игра. Возвращает созданную сессию; ошибка уходит в `onError`. */
  const create = useCallback(async (): Promise<SessionProgress | null> => {
    try {
      const created = await gameApi.createSession();
      applyServerTime(created.serverDate);
      storeSession(created.sessionId);
      idRef.current = created.sessionId;
      setCampaign(created.campaign);
      setSession(created.session);
      setNotice(null);
      return created.session;
    } catch (error) {
      errorRef.current(error);
      return null;
    }
  }, [applyServerTime]);

  const patch = useCallback((update: (current: SessionProgress) => SessionProgress) => {
    setSession((current) => {
      if (!current) return current;
      const next = update(current);
      const completed = next.rooms.filter((room) => room.completed).length;
      return { ...next, roomsCompleted: completed, rushUnlocked: completed === next.rooms.length };
    });
  }, []);

  /** «Сыграть ещё раз»: забыть сохранённую игру. */
  const restart = useCallback(() => {
    storeSession(null);
    idRef.current = null;
    setSession(null);
    setNotice(null);
    callbacks.current.onForget();
  }, []);

  return { campaign, session, skewMs, notice, setNotice, fatal, setFatal, booted, applyServerTime, create, refresh, reload, patch, onError, restart };
}

export type SessionBoot = ReturnType<typeof useSessionBoot>;
