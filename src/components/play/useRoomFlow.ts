"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { ApiError, gameApi } from "@/components/game/api";
import { useNow, usePrefersReducedMotion } from "@/components/game/hooks";
import type { RoomResume } from "@/components/game/resume";
import { writeSeen } from "@/components/game/seen";
import type { RoomSummary } from "@/domain/scoring";
import type { AnswerResponse, PublicCampaign, PublicTask, RoomProgress, SessionProgress, TaskPayloadBody } from "@/types/api";

type Stage =
  | { kind: "loading" }
  | { kind: "task"; task: PublicTask; taskNumber: number }
  | { kind: "result"; summary: RoomSummary; taskId: string };

/** loading → task (ждём ответ) → reveal (разбор) → result (итог комнаты). */
export type RoomPhase = "loading" | "task" | "reveal" | "result";

export type RoomFlowOptions = {
  campaign: PublicCampaign;
  sessionId: string;
  roomId: string;
  /** Перезагрузка на разборе: показать разбор уже отвеченного задания (и итог комнаты), а не следующее задание. */
  resume?: RoomResume;
  session: SessionProgress;
  /** Контейнер механики задания: после выдачи новой заявки фокус переходит на её первый вариант. */
  layoutRef: RefObject<HTMLElement | null>;
  /** Оценка расхождения часов сервера и клиента, мс (только для показа таймера). */
  skewMs: number;
  onPatch: (update: (session: SessionProgress) => SessionProgress) => void;
  onRefresh: () => Promise<void>;
  /** Выход из комнаты: она пройдена в другой вкладке, итог показан или некуда продолжать. */
  onExit: () => void;
  onError: (error: unknown) => void;
  /** Показано новое задание (герой над комнатой меняется вместе с ним). */
  onTask?: (task: PublicTask) => void;
  /** Ответ принят сервером. */
  onAnswered?: (result: AnswerResponse, task: PublicTask) => void;
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Прохождение комнаты: вход, выдача заданий, ответ, разбор, итог, восстановление после перезагрузки.
 * Общий для карточного режима (`RoomScreen`) и квеста (`QuestRoomFlow`): сервер, идемпотентность
 * и порядок шагов одни и те же, различается только оболочка.
 */
export function useRoomFlow(options: RoomFlowOptions) {
  const { campaign, sessionId, roomId, resume, session, skewMs, layoutRef, onPatch, onRefresh, onExit, onError } = options;
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [progress, setProgress] = useState<RoomProgress | null>(null);
  const [answer, setAnswer] = useState<AnswerResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [shake, setShake] = useState(false);
  const submittingRef = useRef(false);
  const reduced = usePrefersReducedMotion();
  const alive = useRef(true);
  // Восстановление применяется один раз, при первой загрузке.
  const resumeRef = useRef(resume ? { resume, session } : undefined);
  const hooks = useRef({ onTask: options.onTask, onAnswered: options.onAnswered });
  useEffect(() => {
    hooks.current = { onTask: options.onTask, onAnswered: options.onAnswered };
  });

  // Последнее задание, разбор которого игрок видел: при закрытии карточки (×, Escape) оно считается прочитанным,
  // иначе перезагрузка после праздника вернула бы игрока в разбор уже пройденной комнаты.
  const lastSeenTask = useRef<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (lastSeenTask.current) writeSeen(sessionId, lastSeenTask.current, "done");
    };
  }, [sessionId]);

  /** Вход в комнату (идемпотентен) и загрузка текущего задания. */
  const load = useCallback(
    async (enter: boolean) => {
      try {
        const restoring = resumeRef.current;
        if (restoring) {
          const { resume: restore, session: snapshot } = restoring;
          const serverRoom = snapshot.rooms.find((item) => item.roomId === roomId);
          const reveal = snapshot.answers.find((item) => item.taskId === restore.taskId);
          if (serverRoom && reveal) {
            lastSeenTask.current = restore.taskId;
            if (restore.stage === "result" && serverRoom.summary) {
              setProgress(serverRoom);
              setStage({ kind: "result", summary: serverRoom.summary, taskId: restore.taskId });
              return;
            }
            const restored = await gameApi.roomTask(sessionId, roomId, restore.taskId);
            if (!alive.current) return;
            setProgress(restored.room);
            setAnswer({
              reveal,
              score: snapshot.score,
              room: restored.room,
              roomResult: restored.room.summary,
              nextTaskId: restored.room.currentTaskId
            });
            hooks.current.onTask?.(restored.task!);
            setStage({ kind: "task", task: restored.task!, taskNumber: restored.taskNumber });
            return;
          }
        }
        if (enter) await gameApi.enterRoom(sessionId, roomId);
        const loaded = await gameApi.roomTask(sessionId, roomId);
        if (!alive.current) return;
        setProgress(loaded.room);
        if (!loaded.task) {
          // Комната уже пройдена (например, в другой вкладке).
          await onRefresh();
          onExit();
          return;
        }
        setAnswer(null);
        hooks.current.onTask?.(loaded.task);
        setStage({ kind: "task", task: loaded.task, taskNumber: loaded.taskNumber });
      } catch (error) {
        if (alive.current) onError(error);
      }
    },
    [sessionId, roomId, onRefresh, onExit, onError]
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const submit = useCallback(
    async (payload: TaskPayloadBody) => {
      if (stage.kind !== "task" || submittingRef.current) return;
      resumeRef.current = undefined;
      const task = stage.task;
      submittingRef.current = true;
      setSubmitting(true);
      try {
        // Карточка pick успевает «улететь» до показа разбора.
        const [result] = await Promise.all([
          gameApi.answer(sessionId, { taskId: task.id, payload }),
          task.type === "pick" && !reduced ? sleep(450) : Promise.resolve()
        ]);
        writeSeen(sessionId, task.id, "pending");
        lastSeenTask.current = task.id;
        if (!alive.current) return;
        setAnswer(result);
        setProgress(result.room);
        hooks.current.onAnswered?.(result, task);
        onPatch((current) => ({
          ...current,
          score: result.score,
          combo: result.reveal.combo,
          rooms: current.rooms.map((item) => (item.roomId === result.room.roomId ? result.room : item))
        }));
        if (result.reveal.outcome === "miss") {
          setShake(true);
          window.setTimeout(() => alive.current && setShake(false), 500);
        }
      } catch (error) {
        if (!alive.current) return;
        if (error instanceof ApiError && error.status === 409) {
          // Порядок игры нарушен или задание уже отвечено: подтягиваем состояние сервера.
          await load(false);
          await onRefresh();
        } else {
          onError(error);
        }
      } finally {
        submittingRef.current = false;
        if (alive.current) setSubmitting(false);
      }
    },
    [stage, sessionId, reduced, onPatch, onError, onRefresh, load]
  );

  const next = useCallback(async () => {
    if (!answer || advancing) return;
    resumeRef.current = undefined;
    setAdvancing(true);
    const taskId = answer.reveal.taskId;
    try {
      if (answer.nextTaskId) {
        writeSeen(sessionId, taskId, "done");
        await load(false);
      } else {
        writeSeen(sessionId, taskId, "reveal");
        await onRefresh();
        const summary = answer.roomResult ?? answer.room.summary;
        if (summary) setStage({ kind: "result", summary, taskId });
        else onExit();
      }
    } finally {
      if (alive.current) setAdvancing(false);
    }
  }, [answer, advancing, sessionId, load, onRefresh, onExit]);

  /** Итог комнаты прочитан: отметить это и выйти. */
  const finish = useCallback(() => {
    if (stage.kind === "result") writeSeen(sessionId, stage.taskId, "done");
    onExit();
  }, [stage, sessionId, onExit]);

  const now = useNow(500, stage.kind === "task" && !answer);

  // Каждая новая заявка забирает фокус на первый вариант: кнопки прошлой заявки исчезли вместе с фокусом.
  const taskId = stage.kind === "task" ? stage.task.id : null;
  const awaitingAnswer = stage.kind === "task" && !answer;
  useEffect(() => {
    if (!taskId || !awaitingAnswer) return;
    layoutRef.current
      ?.querySelector<HTMLElement>('.hand [role="group"] button:not(:disabled), .hand [role="group"] input:not(:disabled)')
      ?.focus();
  }, [taskId, awaitingAnswer, layoutRef]);

  const revealed = answer?.reveal ?? null;
  // Время комнаты — сумма времени её заданий (от выдачи до ответа); чтение разбора не считается.
  const shownAt = progress?.taskShownAt ? Date.parse(progress.taskShownAt) : null;
  const spentMs = progress === null ? null : progress.spentMs + (revealed || shownAt === null ? 0 : Math.max(0, now + skewMs - shownAt));
  const timeLeft = spentMs === null ? null : Math.max(0, campaign.rules.speedWindowSeconds - Math.floor(spentMs / 1000));

  const phase: RoomPhase = stage.kind === "loading" ? "loading" : stage.kind === "result" ? "result" : revealed ? "reveal" : "task";

  return {
    stage,
    phase,
    progress,
    answer,
    reveal: revealed,
    submitting,
    advancing,
    shake,
    timeLeft,
    fuses: progress?.fuses ?? campaign.rules.fusesPerRoom,
    submit,
    next,
    finish
  };
}

export type RoomFlow = ReturnType<typeof useRoomFlow>;
