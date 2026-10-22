"use client";

import { useMemo, useRef } from "react";

import { dayLabel, fill } from "@/components/advent/format";
import { AdventIcon } from "@/components/advent/icons";
import { Facade } from "@/components/advent/storefront/Facade";
import { Garland } from "@/components/advent/storefront/Garland";
import { StreetHost } from "@/components/advent/storefront/StreetHost";
import { useStreetWalker } from "@/components/advent/storefront/useStreetWalker";
import { storeAction } from "@/components/advent/storefront/windows";
import { SoundButton } from "@/components/play/SoundButton";
import { facadeLayout } from "@/domain/advent";
import type { AdventState, PublicAdvent } from "@/types/advent";

/** Подпись шапки: «25 декабря · окно 6 из 12» (до старта и после финала — число окон). */
export function storeSubtitle(advent: PublicAdvent, state: AdventState | null, nowMs: number): string {
  const { copy } = advent;
  if (!state || state.phase !== "running" || state.today === null) return fill(copy.storeSubtitleBefore, { total: advent.schedule.days });
  return fill(copy.storeSubtitle, { date: dayLabel(new Date(nowMs || Date.parse(state.serverTime)), advent.schedule.timezone), n: state.today, total: state.totalDays });
}

/** Компактная шапка в одну строку: знак бренда, название адвента с подписью, звук. */
export function StoreHeader({ advent, subtitle }: { advent: PublicAdvent; subtitle: string }) {
  const { brand } = advent;
  return (
    <header className="adv-storebar">
      <div className="adv-storebar-brand">
        {brand.logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- логотип арендатора: локальный файл из public/, оптимизатор отключён
          <img className="brand-logo" src={brand.logo} alt={brand.name} height={32} />
        ) : (
          <span className="brand-mark" title={brand.name}>{brand.mark}</span>
        )}
      </div>
      <div className="adv-storebar-title">
        <h1>{advent.title}</h1>
        <p>{subtitle}</p>
      </div>
      <SoundButton />
    </header>
  );
}

type Props = {
  advent: PublicAdvent;
  state: AdventState;
  busy: number | null;
  /** Окно, которое только что загорелось (возврат с экрана дня). */
  lit: number | null;
  reduced: boolean;
  onOpen: (n: number) => void;
  onHint: (text: string) => void;
  onStreak: () => void;
};

/** «Витрина»: гирлянда-шкала, фасад с окнами и нижняя плашка с репликой хозяина и одной большой кнопкой. */
export function Storefront({ advent, state, busy, lit, reduced, onOpen, onHint, onStreak }: Props) {
  const { copy, facade } = advent;
  const running = state.phase === "running";
  const today = running ? state.today : null;
  // Раскладка нужна и хозяину на улице: его точки — под окнами этой же раскладки (хуки — до раннего возврата).
  const layout = useMemo(() => facadeLayout(state.doors.length, today, facade?.template ?? { layout: { attic: false } }), [state.doors.length, today, facade?.template]);
  const walker = useStreetWalker({ layout, today, enabled: !!facade && facade.hostWalks, reduced });
  // Enter и пробел на кнопке плашки: действие сразу, без ожидания ходьбы.
  const viaKeyRef = useRef(false);
  if (!facade) return null;
  const host = advent.heroes.find((hero) => hero.id === facade.hostHeroId) ?? advent.heroes[0];
  const action = running ? storeAction(state, copy) : null;

  function press() {
    const immediate = viaKeyRef.current;
    viaKeyRef.current = false;
    if (!action) return;
    if (action.n !== null) {
      const n = action.n;
      walker.walk(n, () => onOpen(n), immediate);
    } else {
      const next = state.doors.find((door) => door.status === "locked");
      onHint(next ? fill(copy.storeTomorrowHint, { date: dayLabel(next.unlocksAt, advent.schedule.timezone) }) : copy.doorFinaleHint);
    }
  }

  return (
    <>
      {running && <Garland state={state} copy={copy} flash={lit !== null} onOpen={onStreak} />}
      <Facade
        template={facade.template}
        signText={facade.signText}
        host={host}
        doors={state.doors}
        grants={state.grants}
        today={running ? state.today : null}
        copy={copy}
        timezone={advent.schedule.timezone}
        phase={state.phase}
        busy={busy}
        lit={lit}
        reduced={reduced}
        onOpen={onOpen}
        onHint={onHint}
        street={facade.hostWalks ? <StreetHost host={host} walker={walker} /> : undefined}
        walk={facade.hostWalks ? walker.walk : undefined}
      />
      {action && (
        <section className="adv-bar" aria-label={host.name} data-action={action.kind}>
          <p className="adv-bar-line">
            <b>{host.name}:</b> {action.line}
          </p>
          <button type="button" className="adv-btn adv-btn-primary adv-bar-btn" aria-disabled={action.kind === "tomorrow" || undefined} data-action={action.kind} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") viaKeyRef.current = true; }} onPointerDown={() => { viaKeyRef.current = false; }} onClick={press}>
            {action.label}
            {action.kind !== "tomorrow" && <AdventIcon name="next" size={20} strokeWidth={2.4} />}
          </button>
        </section>
      )}
    </>
  );
}
