"use client";

import { useState } from "react";

import { Sparks } from "@/components/game/ambient";
import { ClaimForm } from "@/components/game/ClaimForm";
import { CountUp } from "@/components/game/CountUp";
import { Icon, Ornament } from "@/components/game/icons";
import { BrandMark } from "@/components/game/BrandMark";
import { OfficeGlobe, type RoomState } from "@/components/game/OfficeGlobe";
import { points, plural } from "@/components/game/format";
import type { FinalResult, PublicCampaign } from "@/types/api";

function nextTier(campaign: PublicCampaign, final: FinalResult) {
  return campaign.rewardTiers.find((tier) => tier.minScore > final.score) ?? null;
}

function doneStates(campaign: PublicCampaign, final: FinalResult): Record<string, RoomState> {
  return Object.fromEntries(
    campaign.rooms.map((room) => [room.id, final.rooms.find((item) => item.roomId === room.id)?.completed ? "done" : "locked"])
  );
}

export function FinalScreen({
  campaign,
  final,
  onClaim,
  onShare,
  onRestart
}: {
  campaign: PublicCampaign;
  final: FinalResult;
  onClaim: () => void;
  onShare: () => void;
  onRestart: () => void;
}) {
  const next = nextTier(campaign, final);
  const rows = [
    ...campaign.rooms.map((room) => ({
      key: room.id,
      label: room.title,
      value: final.rooms.find((item) => item.roomId === room.id)?.total ?? 0
    })),
    { key: "rush", label: "Рывок", value: final.rushPoints }
  ];
  const max = Math.max(1, ...rows.map((row) => row.value));
  const best = Math.max(...rows.map((row) => row.value));

  return (
    <div className="screen final-screen">
      <section className="final-pic" aria-label="Ваш цифровой офис">
        <OfficeGlobe
          rooms={campaign.rooms}
          states={doneStates(campaign, final)}
          brightness={1}
          alt={campaign.story.finaleAlt}
          variant="final"
          progress={1}
          priority
        />
        <Sparks centers={[[28, 16], [72, 12], [50, 7]]} per={12} radius={95} loop={6.5} className="fireworks" />
      </section>
      <section className="final-panel rise" aria-label="Результат">
        <div className="eyebrow gold-text">00:00 · офис запущен</div>
        <h1 className="final-title">{final.level.title}</h1>
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
        <div className="grow" />
        <div className="btn-stack">
          <button type="button" className="btn btn-gold" onClick={onClaim}>Забрать подарок</button>
          <button type="button" className="btn btn-ghost" onClick={onShare}>Поделиться результатом</button>
          <button type="button" className="link" onClick={onRestart}>Сыграть ещё раз</button>
        </div>
      </section>
    </div>
  );
}

export function ClaimScreen({ sessionId, final, consentText, onBack }: { sessionId: string; final: FinalResult; consentText: string; onBack: () => void }) {
  return (
    <div className="screen claim-screen rise">
      <button type="button" className="link link-back" onClick={onBack}>← К результату</button>
      <div className="claim-summary">
        <div className="eyebrow gold-text">Ваш уровень</div>
        <h1 className="claim-title">{final.level.title}</h1>
        <p className="muted">{final.level.giftLabel}</p>
        <p className="muted-small">Подарок — один на email</p>
      </div>
      <ClaimForm sessionId={sessionId} consentText={consentText} />
    </div>
  );
}

function bulbs(campaign: PublicCampaign, final: FinalResult): Array<"on" | "half" | "off"> {
  return campaign.rooms.flatMap((room) => {
    const summary = final.rooms.find((item) => item.roomId === room.id);
    if (!summary?.completed) return ["off", "off"] as const;
    return ["on", summary.noFailBonus > 0 ? "on" : "half"] as const;
  });
}

/** Карточка «Поделиться» в стиле Share-Card: результат, уровень и огоньки гирлянды. */
export function ShareScreen({ campaign, final, onBack, flakes }: { campaign: PublicCampaign; final: FinalResult; onBack: () => void; flakes?: number }) {
  const [message, setMessage] = useState("");
  const lights = bulbs(campaign, final);
  const lit = lights.filter((light) => light === "on").length;

  async function share() {
    const url = window.location.origin;
    const text = `${campaign.story.shareHeadline}: «${final.level.title}», ${points(final.score)} ${plural(final.score, "очко", "очка", "очков")}. ${campaign.brand.tagline}.`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: campaign.brand.tagline, text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      setMessage("Ссылка и результат скопированы.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(`Не удалось поделиться автоматически. Скопируйте ссылку: ${url}`);
    }
  }

  return (
    <div className="screen share-screen rise">
      <button type="button" className="link link-back" onClick={onBack}>← К результату</button>
      <article className="share-card" aria-label="Карточка результата">
        <div className="share-pic">
          <OfficeGlobe rooms={campaign.rooms} states={doneStates(campaign, final)} brightness={1} alt={campaign.story.shareCardAlt} variant="final" />
          <div className="share-brand"><BrandMark brand={campaign.brand} strong /></div>
        </div>
        <div className="share-copy">
          <div className="eyebrow gold-text">{campaign.story.shareHeadline}</div>
          <div className="share-title">{final.level.title}</div>
          <div className="share-line">
            <span className="share-score">{points(final.score)}</span>
            <span className="muted-small">очков · {campaign.story.shareSubline}</span>
          </div>
          <div className="bulbs" role="img" aria-label={`Огоньков: ${lit} из ${lights.length}`}>
            {lights.map((light, index) => (
              <span key={index} className={`bulb ${light === "off" ? "" : light}`} />
            ))}
          </div>
          {flakes !== undefined && flakes > 0 && (
            <div className="share-flakes muted-small">Снежинок собрано: {flakes}</div>
          )}
          <div className="share-foot">{campaign.brand.tagline}</div>
        </div>
      </article>
      <div className="btn-stack">
        <button type="button" className="btn btn-primary" onClick={() => void share()}>Поделиться</button>
        <p className="muted-small share-message" role="status">{message}</p>
      </div>
    </div>
  );
}
