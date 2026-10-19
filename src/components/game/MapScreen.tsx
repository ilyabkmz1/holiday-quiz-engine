import { OfficeGlobe, type RoomState } from "@/components/game/OfficeGlobe";
import { Ornament } from "@/components/game/icons";
import { CountUp } from "@/components/game/CountUp";
import { countPhrase, points } from "@/components/game/format";
import type { PublicCampaign, PublicRoom, SessionProgress } from "@/types/api";

export function roomStates(campaign: PublicCampaign, session: SessionProgress): Record<string, RoomState> {
  const result: Record<string, RoomState> = {};
  for (const room of campaign.rooms) {
    const progress = session.rooms.find((candidate) => candidate.roomId === room.id);
    result[room.id] = progress?.completed ? "done" : progress?.entered ? "progress" : "open";
  }
  return result;
}

export function MapScreen({
  campaign,
  session,
  onOpenRoom,
  onRush
}: {
  campaign: PublicCampaign;
  session: SessionProgress;
  onOpenRoom: (room: PublicRoom) => void;
  onRush: () => void;
}) {
  const states = roomStates(campaign, session);
  const done = session.rooms.filter((room) => room.completed).length;
  const total = campaign.rooms.length;
  const taskCounts = new Set(campaign.rooms.map((room) => room.taskIds.length));
  const perRoom = taskCounts.size === 1 ? countPhrase([...taskCounts][0], "заявка", "заявки", "заявок") : "несколько заявок";
  const hint = session.rushUnlocked
    ? `Все ${countPhrase(total, "комната", "комнаты", "комнат")} светятся! Остался финальный рывок: ${campaign.rush.durationSeconds} секунд до полуночи.`
    : done === 0
      ? `Выберите комнату, с которой начнёте. Порядок — любой: в каждой ${perRoom} от сотрудников.`
      : `Светятся комнаты: ${done} из ${total}. Выбирайте следующую в любом порядке.`;
  return (
    <div className="screen map-screen">
      <div className="hud">
        <h1 className="map-title">{campaign.story.placeTitle}</h1>
        <div className="pill">
          <span className="sr-only">Очков: {session.score}</span>
          <span className="gold" aria-hidden="true"><CountUp value={session.score} format={points} /></span>
          <span className="muted-inline" aria-hidden="true">очков</span>
        </div>
      </div>
      <div className="map-body">
        <OfficeGlobe
          rooms={campaign.rooms}
          states={states}
          brightness={0.45 + (0.55 * done) / total}
          progress={done / total}
          alt={`Карта: ${countPhrase(total, "комната", "комнаты", "комнат")} в снежном шаре`}
          variant="map"
          onOpen={onOpenRoom}
          priority
        />
        <div className="map-panel">
          <p className="map-hint" aria-live="polite">{hint}</p>
          <div className="ornament-row">
            <span className="muted-small">{campaign.copy.ornamentsMapLabel}: {done} из {total}</span>
            <ul className="ornaments" aria-label={campaign.copy.ornamentsMapLabel}>
              {campaign.rooms.map((room) => {
                const got = states[room.id] === "done";
                return (
                  <li key={room.id}>
                    <Ornament color={room.color} on={got} label={`${room.ornament}: ${got ? "на ёлке" : "ещё не получена"}`} />
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="grow" />
          {session.rushUnlocked && (
            <button type="button" className="btn btn-gold" onClick={onRush}>
              Финал: рывок до полуночи
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
