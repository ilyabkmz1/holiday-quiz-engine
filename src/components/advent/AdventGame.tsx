"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AdventFinale } from "@/components/advent/AdventFinale";
import { adventApi, ApiError, type AdventApi } from "@/components/advent/api";
import { CalendarView } from "@/components/advent/CalendarView";
import { ComebackBanner } from "@/components/advent/ComebackBanner";
import { Countdown } from "@/components/advent/Countdown";
import { DaySheet } from "@/components/advent/DaySheet";
import { fill } from "@/components/advent/format";
import { SaveProgressCard, type SaveProgressInput } from "@/components/advent/SaveProgressCard";
import { StreakHud } from "@/components/advent/StreakHud";
import { BrandMark } from "@/components/game/BrandMark";
import { Snow } from "@/components/game/ambient";
import { usePrefersReducedMotion } from "@/components/game/hooks";
import { SoundButton } from "@/components/play/SoundButton";
import { useSound } from "@/components/play/sound";
import { WorldProvider } from "@/components/play/world-context";
import type { AdventState, PublicAdvent } from "@/types/advent";
import type { World } from "@/worlds/world";

type Load = { status: "loading" } | { status: "ready"; state: AdventState } | { status: "error"; message: string } | { status: "closed" };

const COMEBACK_KEY = "hqe-advent-comeback";

function readFlag(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeFlag(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Хранилище недоступно: баннер скроется до перезагрузки.
  }
}

/**
 * Главный экран адвент-арендатора: загрузка состояния (первый визит создаёт анонимного участника), отсчёт до старта,
 * календарь дверей, серия, лист дня, финал. Правильные ответы и исход удачи на клиенте появляются только из ответов сервера.
 */
export function AdventGame({ advent, world, api = adventApi }: { advent: PublicAdvent; world: World; api?: AdventApi }) {
  const { copy } = advent;
  const reduced = usePrefersReducedMotion();
  const sound = useSound();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [clock, setClock] = useState({ serverMs: 0, localMs: 0 });
  const [nowMs, setNowMs] = useState(0);
  const [openN, setOpenN] = useState<number | null>(null);
  const [busyDoor, setBusyDoor] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [comebackHidden, setComebackHidden] = useState(false);
  const hintTimer = useRef<number | null>(null);
  const bootRef = useRef<Promise<void> | null>(null);

  const showHint = useCallback((text: string) => {
    setHint(text);
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 4200);
  }, []);
  useEffect(() => () => {
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
  }, []);

  const adopt = useCallback((state: AdventState) => {
    const local = Date.now();
    setClock({ serverMs: Date.parse(state.serverTime), localMs: local });
    setNowMs(Date.parse(state.serverTime));
    setLoad({ status: "ready", state });
  }, []);

  const boot = useCallback(async () => {
    try {
      await Promise.resolve();
      // Ссылка из письма не сработала: сервер вернул на главную с `?login=error`.
      if (new URLSearchParams(window.location.search).get("login") === "error") showHint(copy.loginError);
      try {
        adopt(await api.getState());
      } catch (error) {
        // 401: на этом устройстве участника ещё нет, это первый визит.
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        try {
          adopt((await api.createParticipant()).state);
        } catch (creation) {
          // 409: адвент завершён, новых участников больше нет.
          if (creation instanceof ApiError && creation.status === 409) setLoad({ status: "closed" });
          else throw creation;
        }
      }
    } catch (error) {
      setLoad({ status: "error", message: error instanceof ApiError && error.status !== 0 ? error.message : copy.errorGeneric });
    }
  }, [adopt, api, copy.errorGeneric, copy.loginError, showHint]);

  useEffect(() => {
    // Один запуск на страницу: в dev StrictMode гоняет эффект дважды, а два параллельных первых визита создали бы двух участников.
    bootRef.current ??= boot();
  }, [boot]);

  const refresh = useCallback(async () => {
    try {
      adopt(await api.getState());
    } catch {
      // Тихо: состояние обновится при следующем действии.
    }
  }, [adopt, api]);

  // Бег часов от серверного времени: отсчёт до старта и смена дня без перезагрузки.
  const state = load.status === "ready" ? load.state : null;
  const phase = state?.phase ?? null;
  useEffect(() => {
    if (!state) return;
    const timer = window.setInterval(() => setNowMs(clock.serverMs + (Date.now() - clock.localMs)), 1000);
    return () => window.clearInterval(timer);
  }, [state, clock]);

  const firstUnlock = state?.doors[0]?.unlocksAt ?? null;
  const nextUnlock = state?.doors.find((door) => door.status === "locked")?.unlocksAt ?? null;
  const refreshAt = phase === "upcoming" ? firstUnlock : nextUnlock;
  const refreshing = useRef<string | null>(null);
  useEffect(() => {
    if (!refreshAt || nowMs === 0) return;
    // Наступил следующий день (или старт): подтянуть состояние один раз на момент.
    if (Date.parse(refreshAt) <= nowMs && refreshing.current !== refreshAt) {
      refreshing.current = refreshAt;
      void refresh();
    }
  }, [refreshAt, nowMs, refresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const onError = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        bootRef.current = null;
        bootRef.current = boot();
        return;
      }
      showHint(error instanceof ApiError ? error.message : copy.errorGeneric);
      if (error instanceof ApiError && error.status === 409) void refresh();
    },
    [boot, copy.errorGeneric, refresh, showHint]
  );

  const openDoor = useCallback(
    async (n: number) => {
      if (!state) return;
      const door = state.doors.find((candidate) => candidate.n === n);
      if (!door) return;
      sound.effect("tap");
      if (door.status === "opened") {
        setOpenN(n);
        return;
      }
      setBusyDoor(n);
      try {
        const res = await api.openDay(n);
        adopt(res.state);
        setOpenN(n);
      } catch (error) {
        onError(error);
      } finally {
        setBusyDoor(null);
      }
    },
    [adopt, api, onError, sound, state]
  );

  function closeSheet() {
    const n = openN;
    setOpenN(null);
    if (n !== null) window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-door="${n}"]`)?.focus());
  }

  async function requestLink(input: SaveProgressInput) {
    await api.requestLink(input);
  }

  const header = (
    <header className="adv-topbar">
      <div className="brand">
        <BrandMark brand={advent.brand} />
      </div>
      <div className="adv-topbar-right">
        <span className="topbar-note">{advent.brand.topNote}</span>
        <SoundButton />
      </div>
    </header>
  );

  let body;
  if (load.status === "loading") {
    body = (
      <div className="adv-skeleton" role="status" aria-live="polite">
        <span className="sr-only">{copy.loading}</span>
        <div className="adv-skeleton-grid" aria-hidden="true">
          {Array.from({ length: advent.schedule.days }, (_, index) => <i key={index} />)}
        </div>
      </div>
    );
  } else if (load.status === "closed") {
    body = (
      <section className="adv-finale" aria-labelledby="adv-closed-title">
        <h2 id="adv-closed-title" className="adv-finale-title">{copy.closedTitle}</h2>
        <p className="adv-muted">{copy.closedText}</p>
      </section>
    );
  } else if (load.status === "error") {
    body = (
      <div className="adv-errorbox" role="alert">
        <p>{load.message}</p>
        <button type="button" className="adv-btn adv-btn-primary" onClick={() => { setLoad({ status: "loading" }); bootRef.current = boot(); }}>
          {copy.retry}
        </button>
      </div>
    );
  } else {
    const current = load.state;
    const comebackGrant = current.grants.find((grant) => grant.source === "comeback") ?? null;
    const showComeback = comebackGrant !== null && !comebackHidden && readFlag(`${COMEBACK_KEY}:${advent.slug}`) !== comebackGrant.id;
    const anyDone = current.doors.some((door) => door.completed);
    const finished = current.phase === "finale" || current.phase === "closed";
    body = (
      <>
        {current.phase === "upcoming" ? (
          <Countdown advent={advent} targetIso={current.doors[0].unlocksAt} nowMs={nowMs} />
        ) : finished ? (
          <AdventFinale advent={advent} state={current} reduced={reduced} nowMs={nowMs} />
        ) : (
          <>
            {showComeback && comebackGrant && (
              <ComebackBanner
                copy={copy}
                grant={comebackGrant}
                reduced={reduced}
                onClose={() => {
                  writeFlag(`${COMEBACK_KEY}:${advent.slug}`, comebackGrant.id);
                  setComebackHidden(true);
                }}
              />
            )}
            <StreakHud state={current} copy={copy} />
          </>
        )}
        <h2 className="adv-section-title">{copy.calendarTitle}</h2>
        <CalendarView doors={current.doors} copy={copy} timezone={advent.schedule.timezone} phase={current.phase} busy={busyDoor} onOpen={(n) => void openDoor(n)} onHint={showHint} />
        {current.participant.email ? (
          <p className="adv-saved"><span className="adv-dot" aria-hidden="true" /> {fill(copy.saveDone, { email: current.participant.email })}</p>
        ) : (
          anyDone && !finished && openN === null && <SaveProgressCard copy={copy} consentText={advent.legal.consentText} reason="after-day" onSubmit={requestLink} />
        )}
      </>
    );
  }

  return (
    <WorldProvider world={world} rooms={[]}>
      <div className="adv-app" data-phase={phase ?? "loading"} data-presentation={advent.presentation}>
        <div className="adv-bg" aria-hidden="true">
          <Snow count={22} className="adv-snow" />
          <span className="adv-glow adv-glow-a" />
          <span className="adv-glow adv-glow-b" />
        </div>
        <main className="adv-main" inert={openN !== null}>
          {header}
          <section className="adv-hero">
            <div className="adv-eyebrow">{advent.subtitle}</div>
            <h1 className="adv-title">{advent.title}</h1>
            <p className="adv-intro">{advent.intro}</p>
          </section>
          {body}
          <p className="adv-hint" role="status" aria-live="polite" data-visible={hint ? "true" : "false"}>{hint ?? ""}</p>
        </main>
        {state && openN !== null && (
          <DaySheet advent={advent} state={state} n={openN} reduced={reduced} nowMs={nowMs} api={api} onClose={closeSheet} onState={adopt} onError={onError} />
        )}
      </div>
    </WorldProvider>
  );
}
