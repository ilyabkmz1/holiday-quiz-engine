import Image from "next/image";

import { ArtOverlay, Lights, Snow, Sparks } from "@/components/game/ambient";
import { Ornament } from "@/components/game/icons";
import { useWorld } from "@/components/play/world-context";
import { RoomSummaryTable } from "@/components/play/RoomSummaryTable";
import type { RoomSummary } from "@/domain/scoring";
import type { PublicCampaign, PublicRoom } from "@/types/api";
import { roomArt } from "@/worlds/model";

export function RoomResult({
  campaign,
  room,
  summary,
  completedCount,
  onBack
}: {
  campaign: PublicCampaign;
  room: PublicRoom;
  summary: RoomSummary;
  completedCount: number;
  onBack: () => void;
}) {
  const lastRoom = completedCount >= campaign.rooms.length;
  const art = roomArt(useWorld(), room);
  return (
    <div className="screen result-screen rise">
      <div className="result-pic">
        <Image src={art.src} alt={`Комната «${room.title}» светится`} fill sizes="(max-width: 900px) 100vw, 560px" className="result-img" />
        {art.lights && (
          <ArtOverlay>
            <Lights set={art.lights} progress={1} />
          </ArtOverlay>
        )}
        <Snow count={16} className="scene-snow" />
        <div className="result-badge">Свет включён</div>
        <Sparks centers={[[80, 70], [50, 40], [20, 55]]} per={8} radius={60} className="confetti" />
        <div className="result-ornament orn-drop">
          <Ornament color={room.color} on width={76} label={`${campaign.copy.newOrnament}: ${room.ornament}`} />
        </div>
      </div>
      <div className="result-head">
        <div className="eyebrow">
          Комната {completedCount} из {campaign.rooms.length} · {campaign.copy.newOrnament.toLowerCase()}
        </div>
        <h2 className="result-title">{room.title}: свет включён</h2>
        <p className="muted">{campaign.copy.ornamentName} {room.ornament}</p>
      </div>
      <RoomSummaryTable campaign={campaign} summary={summary} />
      <div className="grow" />
      <button type="button" className="btn btn-primary" onClick={onBack} autoFocus>
        {lastRoom ? "К карте: открыт финальный рывок" : "Вернуться в офис"}
      </button>
    </div>
  );
}
