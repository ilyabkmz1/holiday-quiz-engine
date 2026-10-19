"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, gameApi } from "@/components/game/api";
import { useDigitKeys, useNow } from "@/components/game/hooks";
import type { PublicCampaign, RushState } from "@/types/api";

/** Паузы перед повторами `finish` при сбое сети; после них переходим к итогам в любом случае. */
const FINISH_RETRY_DELAYS_MS = [400, 800, 1600];

export type RushFeedback = { kind: "hit" | "miss"; id: number } | null;

type Options = {
  campaign: PublicCampaign;
  sessionId: string;
  initial: RushState;
  onScore: (score: number) => void;
  onDone: () => void;
  onError: (error: unknown) => void;
  /** Звук/эффект ответа. */
  onFeedback?: (kind: "hit" | "miss") => void;
};

/**
 * Рывок в мире: заявки приходят от героев у ёлки, ответ — тап по сервису-комнате.
 * Таймер только отображает дедлайн сервера (`deadlineAt`/`serverNow`), решения принимает сервер.
 */
export function useRush({ campaign, sessionId, initial, onScore, onDone, onError, onFeedback }: Options) {
  const [rush, setRush] = useState(initial);
  // Расхождение часов клиента и сервера: таймер строится по серверному дедлайну.
  const [offset, setOffset] = useState(() => Date.parse(initial.serverNow) - Date.now());
  const [feedback, setFeedback] = useState<RushFeedback>(null);
  const [expired, setExpired] = useState(false);
  const busyRef = useRef(false);
  const doneRef = useRef(false);
  const aliveRef = useRef(true);
  const feedbackTimer = useRef<number | null>(null);
  const cb = useRef({ onScore, onDone, onError, onFeedback });
  useEffect(() => {
    cb.current = { onScore, onDone, onError, onFeedback };
  });

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    };
  }, []);

  const apply = useCallback((next: RushState) => {
    setOffset(Date.parse(next.serverNow) - Date.now());
    setRush(next);
  }, []);

  const now = useNow(100, rush.status === "running");
  const remainingMs = Date.parse(rush.deadlineAt) - (now + offset);
  const timeUp = remainingMs <= 0;
  // Окно допуска сервера (+2 с) отдаёт status "running" при secondsLeft 0: для игрока раунд уже закончен.
  const finished = rush.status === "finished" || rush.secondsLeft <= 0 || timeUp || expired;

  // Время вышло или заявки закончились: фиксируем завершение на сервере и переходим к итогам.
  useEffect(() => {
    if (!finished || doneRef.current) return;
    doneRef.current = true;
    void (async () => {
      if (rush.status === "running" || rush.secondsLeft <= 0) {
        for (let attempt = 0; attempt < FINISH_RETRY_DELAYS_MS.length + 1; attempt += 1) {
          try {
            await gameApi.finishRush(sessionId);
            break;
          } catch (error) {
            // Рывок уже закрыт сервером — это не ошибка для игрока.
            if (error instanceof ApiError && (error.status === 400 || error.status === 409)) break;
            const delay = FINISH_RETRY_DELAYS_MS[attempt];
            if (delay === undefined) break;
            await new Promise((resolve) => window.setTimeout(resolve, delay));
            if (!aliveRef.current) return;
          }
        }
      }
      if (aliveRef.current) cb.current.onDone();
    })();
  }, [finished, rush.status, rush.secondsLeft, sessionId]);

  const item = rush.current;
  const tap = useCallback(
    async (serviceId: string) => {
      const current = item;
      if (!current || finished || busyRef.current) return;
      busyRef.current = true;
      try {
        const result = await gameApi.answerRush(sessionId, current.itemId, serviceId);
        apply(result.rush);
        cb.current.onScore(result.score);
        cb.current.onFeedback?.(result.correct ? "hit" : "miss");
        const id = Date.now();
        setFeedback({ kind: result.correct ? "hit" : "miss", id });
        if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
        feedbackTimer.current = window.setTimeout(() => setFeedback((value) => (value?.id === id ? null : value)), 450);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          // Заявка уже закрыта (другая вкладка, повтор): берём состояние сервера.
          try {
            const fresh = await gameApi.getSession(sessionId);
            if (fresh.session.rush) apply(fresh.session.rush);
            cb.current.onScore(fresh.session.score);
          } catch (inner) {
            cb.current.onError(inner);
          }
        } else if (error instanceof ApiError && error.status === 400) {
          // Время вышло на стороне сервера.
          setExpired(true);
        } else {
          cb.current.onError(error);
        }
      } finally {
        busyRef.current = false;
      }
    },
    [item, finished, sessionId, apply]
  );

  const services = campaign.rush.services;
  useDigitKeys(!finished, services.length, (index) => void tap(services[index].id));

  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const percent = Math.max(0, Math.min(100, Math.round((remainingMs / (campaign.rush.durationSeconds * 1000)) * 100)));
  return { rush, finished, seconds, percent, hot: seconds <= 10, feedback, tap };
}
