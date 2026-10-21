"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { AdventIcon } from "@/components/advent/icons";
import { Burst } from "@/components/advent/Burst";
import { PromoCard } from "@/components/advent/PromoCard";
import { fill } from "@/components/advent/format";
import { usePlatformBridge } from "@/components/advent/platform-context";
import { miniAppLink, telegramShareLink } from "@/platform/telegram-links";
import { CountUp } from "@/components/game/CountUp";
import type { AdventState, PublicAdvent } from "@/types/advent";

/**
 * Финал и закрытие: итоги (открытые двери, лучшая серия), цели с наградами, главный приз по самой дальней цели и «поделиться».
 * «Поделиться» открывает системное окно (Web Share), а без него копирует ссылку на адвент.
 */
export function AdventFinale({ advent, state, reduced, nowMs, extra = null }: { advent: PublicAdvent; state: AdventState; reduced: boolean; nowMs: number; extra?: ReactNode }) {
  const { copy } = advent;
  const platform = usePlatformBridge();
  const closed = state.phase === "closed";
  const opened = state.doors.filter((door) => door.status === "opened").length;
  const goals = [...state.goals].sort((a, b) => a.opened - b.opened);
  const main = goals.length > 0 ? goals[goals.length - 1] : null;
  const mainGrant = main ? state.grants.find((grant) => grant.source === "goal" && grant.rewardId === main.rewardId) : undefined;
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  async function share() {
    // В Telegram ссылка ведёт на мини-приложение (метка источника `share`), а не на сайт: окно «Переслать» открывает сам Telegram.
    const app = advent.platforms.telegram;
    if (platform.kind === "telegram" && app) {
      const text = fill(copy.telegramFinaleShareText, { title: advent.title, k: opened, n: state.totalDays });
      if (platform.openTelegramLink(telegramShareLink(miniAppLink(app, { source: "share" }), text))) return;
    }
    const url = window.location.origin;
    const text = fill(copy.finaleShareText, { title: advent.title, k: opened, n: state.totalDays });
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: advent.title, text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setMessage(copy.finaleShareCopied);
    } catch {
      // Игрок закрыл окно «Поделиться» или буфер недоступен: сообщать нечего.
    }
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 2600);
  }

  return (
    <section className="adv-finale" aria-labelledby="adv-finale-title">
      {!reduced && !closed && <Burst count={36} spread={190} />}
      <div className="adv-eyebrow">{copy.finaleEyebrow}</div>
      <h2 id="adv-finale-title" className="adv-finale-title">{closed ? copy.closedTitle : copy.finaleTitle}</h2>
      {closed && <p className="adv-muted">{copy.closedText}</p>}

      <dl className="adv-finale-stats">
        <div>
          <dt>{copy.finaleOpened}</dt>
          <dd><span className="sr-only">{opened} / {state.totalDays}</span><span aria-hidden="true"><CountUp value={opened} duration={1200} /> / {state.totalDays}</span></dd>
        </div>
        <div>
          <dt>{copy.finaleBest}</dt>
          <dd><span className="sr-only">{state.streak.best}</span><span aria-hidden="true"><CountUp value={state.streak.best} duration={1200} /></span></dd>
        </div>
      </dl>

      {goals.length > 0 && (
        <div className="adv-finale-goals">
          <h3>{copy.finaleGoals}</h3>
          <ul>
            {goals.map((goal) => (
              <li key={goal.opened} className={goal.reached ? "reached" : ""}>
                <AdventIcon name={goal.reached ? "check" : "lock"} size={16} strokeWidth={2.4} />
                <span>{goal.label}</span>
                <small>{goal.opened}</small>
              </li>
            ))}
          </ul>
        </div>
      )}

      {main && (
        <div className="adv-finale-main">
          <h3><AdventIcon name="trophy" size={18} /> {copy.finaleMainPrize}</h3>
          {main.reached ? (
            mainGrant ? (
              <PromoCard grant={mainGrant} copy={copy} timezone={advent.schedule.timezone} nowMs={nowMs} fresh />
            ) : (
              <p className="adv-finale-prize">{main.label}</p>
            )
          ) : (
            <p className="adv-muted">{copy.finaleNoPrize}</p>
          )}
        </div>
      )}

      {extra}

      <button type="button" className="adv-btn adv-btn-primary" onClick={() => void share()}>
        <AdventIcon name="share" size={16} /> {platform.kind === "telegram" ? copy.telegramShare : copy.finaleShare}
      </button>
      <span className="sr-only" role="status" aria-live="polite">{message ?? ""}</span>
      {message && <p className="adv-toast-inline" aria-hidden="true">{message}</p>}
    </section>
  );
}
