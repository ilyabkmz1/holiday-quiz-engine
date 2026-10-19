"use client";

import { useRef } from "react";

import type { RoomResume } from "@/components/game/resume";
import { RevealPanel } from "@/components/game/RevealPanel";
import { RoomResult } from "@/components/game/RoomResult";
import { Hud } from "@/components/game/room-ui";
import { TaskMechanic } from "@/components/play/TaskMechanic";
import { useRoomFlow } from "@/components/play/useRoomFlow";
import type { PublicCampaign, SessionProgress, TaskPayloadBody } from "@/types/api";

export type RoomScreenProps = {
  campaign: PublicCampaign;
  sessionId: string;
  roomId: string;
  /** Перезагрузка на разборе: показать разбор уже отвеченного задания (и итог комнаты), а не следующее задание. */
  resume?: RoomResume;
  session: SessionProgress;
  /** Оценка расхождения часов сервера и клиента, мс (только для показа таймера). */
  skewMs: number;
  onPatch: (update: (session: SessionProgress) => SessionProgress) => void;
  onRefresh: () => Promise<void>;
  onExit: () => void;
  onError: (error: unknown) => void;
};

/** Полноэкранная комната карточного режима: оболочка над общим `useRoomFlow`. */
export function RoomScreen({ campaign, sessionId, roomId, resume, session, skewMs, onPatch, onRefresh, onExit, onError }: RoomScreenProps) {
  const room = campaign.rooms.find((candidate) => candidate.id === roomId)!;
  const layoutRef = useRef<HTMLDivElement>(null);
  const flow = useRoomFlow({ layoutRef, campaign, sessionId, roomId, resume, session, skewMs, onPatch, onRefresh, onExit, onError });
  const { stage, answer, reveal } = flow;

  if (stage.kind === "loading") {
    return (
      <div className="screen center" role="status">
        <p className="muted">Входим в комнату «{room.title}»…</p>
      </div>
    );
  }

  if (stage.kind === "result") {
    return (
      <RoomResult
        campaign={campaign}
        room={room}
        summary={stage.summary}
        completedCount={session.rooms.filter((item) => item.completed).length}
        onBack={flow.finish}
      />
    );
  }

  const { task, taskNumber } = stage;
  const hero = campaign.heroes.find((candidate) => candidate.id === task.heroId) ?? campaign.heroes[0];

  return (
    <div className="screen room-screen">
      <Hud
        roomTitle={room.title}
        taskNumber={taskNumber}
        total={room.taskIds.length}
        fuses={flow.fuses}
        fusesTotal={campaign.rules.fusesPerRoom}
        combo={session.combo}
        timeLeft={flow.timeLeft}
        hotBelow={15}
        score={session.score}
      />
      {/* Постоянный живой регион: элементы под key пересоздаются и сами по себе не озвучиваются. */}
      <p className="sr-only" role="status" aria-live="polite">
        {reveal ? "" : `${hero.name}: ${task.say}`}
      </p>
      <div className="room-layout" key={task.id} ref={layoutRef}>
        <TaskMechanic
          task={task}
          hero={hero}
          room={room}
          reveal={reveal}
          disabled={flow.submitting}
          onSubmit={(payload: TaskPayloadBody) => void flow.submit(payload)}
          shake={flow.shake}
          sceneVariant="full"
          after={
            reveal ? (
              <RevealPanel
                task={task}
                reveal={reveal}
                busy={flow.advancing}
                nextLabel={answer?.nextTaskId ? "Следующая заявка" : "Включить свет в комнате"}
                onNext={() => void flow.next()}
              />
            ) : null
          }
        />
      </div>
    </div>
  );
}
