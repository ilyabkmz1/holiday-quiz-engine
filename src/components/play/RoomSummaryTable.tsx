import { points, signed } from "@/components/game/format";
import type { RoomSummary } from "@/domain/scoring";
import type { PublicCampaign } from "@/types/api";

/** Разбор очков за комнату: общий для экрана итога карточного режима и листа квеста. */
export function RoomSummaryTable({ campaign, summary }: { campaign: PublicCampaign; summary: RoomSummary }) {
  const noFail = summary.noFailBonus > 0;
  const failures = campaign.rules.fusesPerRoom - summary.fuses;
  return (
    <dl className="breakdown">
      <div><dt>Заявки ({summary.answered} из {campaign.rooms.find((room) => room.id === summary.roomId)?.taskIds.length ?? summary.answered})</dt><dd>{signed(summary.base)}</dd></div>
      <div><dt>Комбо</dt><dd>{signed(summary.comboBonus)}</dd></div>
      <div>
        <dt>Скорость{summary.elapsedSeconds !== null ? `: ${summary.elapsedSeconds} с` : ""}</dt>
        <dd>{signed(summary.speedBonus)}</dd>
      </div>
      <div><dt>{noFail ? "Ни одного сбоя" : `Сбоев: ${failures}`}</dt><dd>{signed(summary.noFailBonus)}</dd></div>
      <div className="breakdown-total">
        <dt>Итого за комнату</dt>
        <dd className="gold">{points(summary.total)}</dd>
      </div>
    </dl>
  );
}
