"use client";

import { CountUp } from "@/components/game/CountUp";
import { clock, plural, points } from "@/components/game/format";
import { Icon } from "@/components/game/icons";
import { SoundButton } from "@/components/play/SoundButton";
import type { RoomView } from "@/components/quest/QuestRoomFlow";
import type { PublicCampaign, SessionProgress } from "@/types/api";

export type RushHud = { hits: number; seconds: number; hot: boolean; percent: number };

type Props = {
  campaign: PublicCampaign;
  session: SessionProgress | null;
  litCount: number;
  /** Строка «Цель: …» в мире. */
  goal: string | null;
  flakes: number;
  room: RoomView | null;
  rush: RushHud | null;
  showScore: boolean;
  /** Открыт диалог: HUD вне диалога недоступен ни мышью, ни Tab, ни скринридеру. */
  inert?: boolean;
};

/** HUD мира: цель, прогресс, очки, искорки и звук; в комнате — таймер, предохранители и комбо. */
export function QuestHud({ campaign, session, litCount, goal, flakes, room, rush, showScore, inert }: Props) {
  const total = campaign.rooms.length;
  const fusesTotal = campaign.rules.fusesPerRoom;
  const score = session?.score ?? 0;
  return (
    <header className="qw-hud qw-ui" inert={inert}>
      <div className="qw-hud-left">
        <h1 className="qw-title">{campaign.story.placeTitle}</h1>
        <p className="qw-sub">Светятся комнаты: {litCount} из {total}</p>
        {goal && <p className="qw-goal" data-testid="goal">{goal}</p>}
      </div>
      <div className="qw-hud-right">
        {rush && (
          <>
            <div className="pill pill-lg">Закрыто: <span className="green">{rush.hits}</span></div>
            <div className={rush.hot ? "pill pill-lg pill-hot pulse-fast" : "pill pill-lg"} role="timer" aria-label={`До полуночи ${rush.seconds} с`}>
              <span aria-hidden="true">{clock(rush.seconds)}</span>
            </div>
          </>
        )}
        {room && session && session.combo >= 2 && (
          <div className="pill pill-combo">
            <span className="sr-only">Комбо {session.combo}</span>
            <span aria-hidden="true">×{session.combo}</span>
          </div>
        )}
        {room && room.timeLeft !== null && room.phase === "task" && (
          <div className={room.timeLeft <= 15 ? "pill pill-hot" : "pill"} role="timer" aria-label={`Бонус за скорость: ${clock(room.timeLeft)}`}>
            <Icon name="clock" size={14} strokeWidth={2.2} />
            <span aria-hidden="true">{clock(room.timeLeft)}</span>
          </div>
        )}
        {!rush && (
        <div className="pill" role="img" aria-label={`Снежинок собрано: ${flakes}. ${plural(flakes, "Искорка", "Искорки", "Снежинок")} не влияют на очки.`}>
          <span className="qw-pill-flake" aria-hidden="true">❄</span>
          <span aria-hidden="true">{flakes}</span>
        </div>
        )}
        {showScore && (
          <div className="pill pill-score" data-hud="score">
            <span className="sr-only">Очков: {score}</span>
            <span className="gold" aria-hidden="true"><CountUp value={score} format={points} /></span>
          </div>
        )}
        <SoundButton />
      </div>
      {room && room.phase !== "loading" && (
          <div className="qw-room-hud">
            <div className="fuses" role="img" aria-label={`Предохранителей осталось: ${room.fuses} из ${fusesTotal}`}>
              {Array.from({ length: fusesTotal }, (_, index) => (
                <span key={index} className={index < room.fuses ? "fuse" : "fuse out"} />
              ))}
            </div>
            {room.phase !== "result" && (
              <span className="eyebrow qw-eyebrow">
                {campaign.rooms.find((candidate) => candidate.id === room.roomId)?.title} · заявка {room.taskNumber} из {campaign.rooms.find((candidate) => candidate.id === room.roomId)?.taskIds.length}
              </span>
            )}
          </div>
      )}
      {rush && (
        <div className="rush-bar qw-rush-bar" aria-hidden="true">
          <div className="rush-bar-fill" style={{ width: `${rush.percent}%` }} />
        </div>
      )}
    </header>
  );
}
