"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, gameApi } from "@/components/game/api";
import { Snow } from "@/components/game/ambient";
import { CountUp } from "@/components/game/CountUp";
import { clock, points } from "@/components/game/format";
import { useDigitKeys, useNow } from "@/components/game/hooks";
import { Icon } from "@/components/game/icons";
import type { PublicCampaign, RushState } from "@/types/api";

export function RushIntro({ campaign, busy, onStart }: { campaign: PublicCampaign; busy: boolean; onStart: () => void }) {
  return (
    <div className="screen rush-intro has-snow rise">
      <Snow count={16} className="screen-snow" />
      <div className="rush-clock pop" aria-hidden="true">{campaign.scene.rushClock}</div>
      <h1 className="rush-h1">Финальный рывок!</h1>
      <p className="rush-lead">{campaign.rush.intro}</p>
      <button type="button" className="btn btn-gold" onClick={onStart} disabled={busy} autoFocus>
        {busy ? "Запускаем…" : "Поехали!"}
      </button>
    </div>
  );
}

/** Паузы перед повторами `finish` при сбое сети; после них переходим к итогам в любом случае. */
const FINISH_RETRY_DELAYS_MS = [400, 800, 1600];

type Feedback = { kind: "hit" | "miss"; id: number } | null;

export function RushScreen({
  campaign,
  sessionId,
  initial,
  score,
  onScore,
  onDone,
  onError
}: {
  campaign: PublicCampaign;
  sessionId: string;
  initial: RushState;
  score: number;
  onScore: (score: number) => void;
  onDone: () => void;
  onError: (error: unknown) => void;
}) {
  const [rush, setRush] = useState(initial);
  // Расхождение часов клиента и сервера: таймер строится по серверному дедлайну.
  const [offset, setOffset] = useState(() => Date.parse(initial.serverNow) - Date.now());
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [expired, setExpired] = useState(false);
  const busyRef = useRef(false);
  const doneRef = useRef(false);
  const aliveRef = useRef(true);
  const feedbackTimer = useRef<number | null>(null);

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
        // Сбой сети или 5xx: повторяем с нарастающей паузой. Сервер сам закрывает истёкший рывок
        // в `complete()`, поэтому после исчерпания попыток всё равно переходим к итогам.
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
      if (aliveRef.current) onDone();
    })();
  }, [finished, rush.status, rush.secondsLeft, sessionId, onDone]);

  async function tap(serviceId: string) {
    const current = rush.current;
    if (!current || finished || busyRef.current) return;
    busyRef.current = true;
    try {
      const result = await gameApi.answerRush(sessionId, current.itemId, serviceId);
      apply(result.rush);
      onScore(result.score);
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
          onScore(fresh.session.score);
        } catch (inner) {
          onError(inner);
        }
      } else if (error instanceof ApiError && error.status === 400) {
        // Время вышло на стороне сервера.
        setExpired(true);
      } else {
        onError(error);
      }
    } finally {
      busyRef.current = false;
    }
  }

  const services = campaign.rush.services;
  useDigitKeys(!finished, services.length, (index) => void tap(services[index].id));

  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const total = campaign.rush.durationSeconds * 1000;
  const percent = Math.max(0, Math.min(100, Math.round((remainingMs / total) * 100)));
  const hot = seconds <= 10;

  return (
    <div className={hot ? "screen rush-screen has-snow urgent" : "screen rush-screen has-snow"}>
      <Snow count={14} className="screen-snow" />
      <div className="hud rush-hud">
        <div className="pill pill-lg">
          Закрыто: <span className="green">{rush.hits}</span>
        </div>
        <div className={hot ? "pill pill-lg pill-hot pulse-fast" : "pill pill-lg"} role="timer" aria-label={`До полуночи ${seconds} с`}>
          <span aria-hidden="true">{clock(seconds)}</span>
        </div>
        <div className="pill pill-lg pill-score">
          <span className="bump-ring" key={score} aria-hidden="true" />
          <span className="sr-only">Очков: {score}</span>
          <span className="gold" aria-hidden="true"><CountUp value={score} format={points} duration={500} /></span>
        </div>
      </div>
      <div className="rush-bar" aria-hidden="true">
        <div className="rush-bar-fill" style={{ width: `${percent}%` }} />
      </div>
      {/* Живой регион постоянный: пересоздание по key не озвучивается, анимируется только внутренняя карточка. */}
      <div className="rush-stage" role="status" aria-live="polite" aria-atomic="true">
        <div
          key={rush.current?.itemId ?? "end"}
          className={`rush-card rushcard${feedback?.kind === "miss" ? " shake" : feedback?.kind === "hit" ? " flash" : ""}`}
        >
          <div className="eyebrow dark">Заявка №{(rush.current?.index ?? rush.answered) + 1}</div>
          <div className="rush-prompt">{finished ? "Время вышло" : (rush.current?.prompt ?? "Заявки закончились")}</div>
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {feedback?.kind === "hit" ? `Верно, плюс ${campaign.rush.pointsPerHit}` : feedback?.kind === "miss" ? `Ошибка, минус ${campaign.rush.penaltySeconds} секунды` : ""}
      </p>
      <div className="services" role="group" aria-label="Сервисы">
        {services.map((service, index) => (
          <button
            key={service.id}
            type="button"
            className="svc"
            disabled={finished}
            onClick={() => void tap(service.id)}
          >
            <Icon name={service.icon} size={24} color={service.color} />
            <span>{service.title}</span>
            <span className="card-key" aria-hidden="true">{index + 1}</span>
          </button>
        ))}
      </div>
      <p className="rush-hint">Ошибка отнимает {campaign.rush.penaltySeconds} с · клавиши 1–{services.length}</p>
    </div>
  );
}
