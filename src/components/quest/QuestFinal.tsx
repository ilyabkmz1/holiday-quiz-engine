"use client";

import { CountUp } from "@/components/game/CountUp";
import { ClaimForm } from "@/components/game/ClaimForm";
import { plural, points } from "@/components/game/format";
import { Icon, Ornament } from "@/components/game/icons";
import type { FinalResult, PublicCampaign } from "@/types/api";

/** Фокус на главную кнопку без прокрутки: лист итога остаётся открытым с заголовка и очков (autoFocus прокручивал его вниз). */
function focusQuietly(el: HTMLButtonElement | null) {
  el?.focus({ preventScroll: true });
}

function nextTier(campaign: PublicCampaign, final: FinalResult) {
  return campaign.rewardTiers.find((tier) => tier.minScore > final.score) ?? null;
}

/** Итог игры на карточке поверх сияющего офиса: уровень, очки, игрушки на ёлке, подарок. */
export function FinalPanel({ campaign, final, flakes, onClaim, onShare, onRestart }: {
  campaign: PublicCampaign;
  final: FinalResult;
  flakes: number;
  onClaim: () => void;
  onShare: () => void;
  onRestart: () => void;
}) {
  const next = nextTier(campaign, final);
  const rows = [
    ...campaign.rooms.map((room) => ({ key: room.id, label: room.title, value: final.rooms.find((item) => item.roomId === room.id)?.total ?? 0 })),
    { key: "rush", label: "Рывок", value: final.rushPoints }
  ];
  const max = Math.max(1, ...rows.map((row) => row.value));
  const best = Math.max(...rows.map((row) => row.value));
  return (
    <section className="final-panel qf-panel rise" aria-label="Результат">
      <div className="eyebrow gold-text">00:00 · офис запущен</div>
      <h2 className="final-title qf-title">{final.level.title}</h2>
      <div className="final-score">
        <span className="pop big-score" aria-label={`${final.score} очков`}><CountUp value={final.score} from={0} format={points} duration={1600} /></span>
        <span className="muted-small">
          {plural(final.score, "очко", "очка", "очков")} · рывок: {final.rushHits} {plural(final.rushHits, "заявка", "заявки", "заявок")}
        </span>
      </div>
      <ul className="final-ornaments" aria-label={campaign.copy.ornamentsAria}>
        {final.ornaments.map((ornament) => {
          const room = campaign.rooms.find((item) => item.id === ornament.roomId);
          return (
            <li key={ornament.roomId}>
              <Ornament color={room?.color ?? "#62E0FF"} on label={ornament.name} />
            </li>
          );
        })}
      </ul>
      {flakes > 0 && <p className="muted-small qf-flakes">Снежинок на ёлке: {flakes} — просто для красоты, на очки они не влияют.</p>}
      <ul className="bars" aria-label="Очки по комнатам">
        {rows.map((row) => (
          <li key={row.key} className="bar-row">
            <span>{row.label}</span>
            <span className="bar" aria-hidden="true"><span style={{ width: `${Math.round((row.value / max) * 100)}%` }} /></span>
            <b className={row.value === best ? "gold" : ""}>{points(row.value)}</b>
          </li>
        ))}
      </ul>
      <div className="gift shine">
        <Icon name="gift" size={36} color="var(--gold)" strokeWidth={1.6} />
        <div>
          <div className="gift-title">Подарок уровня «{final.level.title}»</div>
          <div className="gift-text">
            {final.level.giftLabel}
            {next ? ` · До «${next.title}» не хватило ${points(next.minScore - final.score)} ${plural(next.minScore - final.score, "очко", "очка", "очков")}` : ""}
          </div>
        </div>
      </div>
      <div className="btn-stack">
        <button type="button" className="btn btn-gold" onClick={onClaim} ref={focusQuietly}>Забрать подарок</button>
        <button type="button" className="btn btn-ghost" onClick={onShare}>Поделиться результатом</button>
        <button type="button" className="link" onClick={onRestart}>Сыграть ещё раз</button>
      </div>
    </section>
  );
}

/** Заявка на приз прямо в мире: та же форма и то же подтверждение по email, что и в карточном режиме. */
export function ClaimPanel({ sessionId, final, consentText, onBack }: { sessionId: string; final: FinalResult; consentText: string; onBack: () => void }) {
  return (
    <section className="claim-screen qf-claim rise" aria-label="Заявка на подарок">
      <button type="button" className="link link-back" onClick={onBack}>← К результату</button>
      <div className="claim-summary">
        <div className="eyebrow gold-text">Ваш уровень</div>
        <h2 className="claim-title">{final.level.title}</h2>
        <p className="muted">{final.level.giftLabel}</p>
        <p className="muted-small">Подарок — один на email</p>
      </div>
      <ClaimForm sessionId={sessionId} consentText={consentText} />
    </section>
  );
}
