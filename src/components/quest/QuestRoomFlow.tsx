"use client";

import { useEffect, useMemo, useRef } from "react";

import type { Mood } from "@/components/game/characters";
import { Ornament } from "@/components/game/icons";
import type { RoomResume } from "@/components/game/resume";
import { RevealPanel } from "@/components/game/RevealPanel";
import { TaskMechanic } from "@/components/play/TaskMechanic";
import { RoomSummaryTable } from "@/components/play/RoomSummaryTable";
import { useRoomFlow, type RoomPhase } from "@/components/play/useRoomFlow";
import type { AnswerResponse, PublicCampaign, PublicTask, SessionProgress, TaskOutcome, TaskPayloadBody } from "@/types/api";

/** Что карточка сообщает миру: реплика над героем, таймер, предохранители, комбо живут в HUD мира. */
export type RoomView = {
  roomId: string;
  phase: RoomPhase;
  taskNumber: number;
  heroId: string | null;
  mood: Mood;
  /** Реплика героя: заявка, а после ответа — благодарность или «ой». */
  line: string;
  outcome: TaskOutcome | null;
  timeLeft: number | null;
  fuses: number;
};

export type QuestRoomFlowProps = {
  campaign: PublicCampaign;
  sessionId: string;
  roomId: string;
  resume?: RoomResume;
  session: SessionProgress;
  skewMs: number;
  onPatch: (update: (session: SessionProgress) => SessionProgress) => void;
  onRefresh: () => Promise<void>;
  onView: (view: RoomView | null) => void;
  /** Ответ принят: настроение героя и вспышка ошибки в мире. */
  onAnswered: (result: AnswerResponse, task: PublicTask) => void;
  onTask: (task: PublicTask) => void;
  onClose: () => void;
  onError: (error: unknown) => void;
};

/**
 * Карточка задания поверх мира: оболочка над общим `useRoomFlow`. Реплика героя звучит
 * в мире, на карточке остаётся только механика, разбор и итог комнаты.
 */
export function QuestRoomFlow({ campaign, sessionId, roomId, resume, session, skewMs, onPatch, onRefresh, onView, onAnswered, onTask, onClose, onError }: QuestRoomFlowProps) {
  const room = campaign.rooms.find((candidate) => candidate.id === roomId)!;
  const layoutRef = useRef<HTMLDivElement>(null);
  const flow = useRoomFlow({ layoutRef, campaign, sessionId, roomId, resume, session, skewMs, onPatch, onRefresh, onExit: onClose, onError, onTask, onAnswered });
  const { stage, reveal, answer } = flow;
  const task = stage.kind === "task" ? stage.task : null;
  const taskNumber = stage.kind === "task" ? stage.taskNumber : room.taskIds.length;

  const view = useMemo<RoomView>(
    () => ({
      roomId,
      phase: flow.phase,
      taskNumber,
      heroId: task?.heroId ?? null,
      mood: reveal ? reveal.mood : "neutral",
      line: !task ? "" : reveal ? reveal.line : task.say,
      outcome: reveal?.outcome ?? null,
      timeLeft: flow.timeLeft,
      fuses: flow.fuses
    }),
    [roomId, flow.phase, taskNumber, task, reveal, flow.timeLeft, flow.fuses]
  );
  const viewRef = useRef(onView);
  useEffect(() => {
    viewRef.current = onView;
  });
  useEffect(() => {
    viewRef.current(view);
  }, [view]);
  useEffect(() => () => viewRef.current(null), []);

  // Разбор и новая заявка показываются с начала карточки, а не с прежней прокрутки.
  const answeredId = answer?.reveal.taskId ?? null;
  const taskId = task?.id ?? null;
  useEffect(() => {
    layoutRef.current?.closest(".qw-sheet-body")?.scrollTo({ top: 0 });
  }, [answeredId, taskId]);

  if (stage.kind === "loading") {
    return (
      <p className="muted qs-loading" role="status">
        Подходим к герою…
      </p>
    );
  }

  if (stage.kind === "result") {
    return (
      <div className="qs-result rise">
        <div className="eyebrow">{campaign.copy.newOrnament}</div>
        <h2 className="qs-result-title">{room.title}: свет включён</h2>
        <p className="muted qs-ornament">
          <Ornament color={room.color} on width={28} label="" /> {campaign.copy.ornamentName} {room.ornament}
        </p>
        <RoomSummaryTable campaign={campaign} summary={stage.summary} />
        <button type="button" className="btn btn-gold" onClick={flow.finish} autoFocus>
          {campaign.copy.hangOrnament}
        </button>
      </div>
    );
  }

  const hero = campaign.heroes.find((candidate) => candidate.id === stage.task.heroId) ?? campaign.heroes[0];
  return (
    <>
      {/* Постоянный живой регион: элементы под key пересоздаются и сами по себе не озвучиваются. */}
      <p className="sr-only" role="status" aria-live="polite">
        {reveal ? "" : `${hero.name}: ${stage.task.say}`}
      </p>
      <div className="room-layout" key={stage.task.id} ref={layoutRef}>
        <TaskMechanic
          task={stage.task}
          hero={hero}
          room={room}
          reveal={reveal}
          disabled={flow.submitting}
          onSubmit={(payload: TaskPayloadBody) => void flow.submit(payload)}
          shake={flow.shake}
          sceneVariant="flat"
          after={
            reveal ? (
              <RevealPanel
                task={stage.task}
                reveal={reveal}
                busy={flow.advancing}
                nextLabel={answer?.nextTaskId ? "Следующая заявка" : "Включить свет в комнате"}
                onNext={() => void flow.next()}
              />
            ) : null
          }
        />
      </div>
    </>
  );
}
