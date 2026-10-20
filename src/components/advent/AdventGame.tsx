"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AdventFinale } from "@/components/advent/AdventFinale";
import { adventApi, ApiError, type AdventApi } from "@/components/advent/api";
import { CalendarView } from "@/components/advent/CalendarView";
import { ComebackBanner } from "@/components/advent/ComebackBanner";
import { Countdown } from "@/components/advent/Countdown";
import { DaySheet } from "@/components/advent/DaySheet";
import { fill } from "@/components/advent/format";
import { RemindersToggle } from "@/components/advent/RemindersToggle";
import { SaveProgressCard, type SaveProgressInput } from "@/components/advent/SaveProgressCard";
import { AdventSheet } from "@/components/advent/AdventSheet";
import { StreakHud } from "@/components/advent/StreakHud";
import { TeamBoard } from "@/components/advent/TeamBoard";
import { Storefront, StoreHeader, storeSubtitle } from "@/components/advent/storefront/Storefront";
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
  const [streakOpen, setStreakOpen] = useState(false);
  const [lit, setLit] = useState<number | null>(null);
  const preStatus = useRef<string | null>(null);
  const litTimer = useRef<number | null>(null);
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
    if (litTimer.current !== null) window.clearTimeout(litTimer.current);
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
  // После последней двери следующий момент — финал, затем закрытие: иначе фаза сменится только при возврате на вкладку.
  const refreshAt =
    phase === "upcoming"
      ? firstUnlock
      : phase === "running"
        ? (nextUnlock ?? advent.schedule.finaleAt)
        : phase === "finale"
          ? advent.schedule.claimEndsAt
          : null;
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
      preStatus.current = door.status;
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

  // Кнопка письма-напоминания ведёт на `/?day=N`: после загрузки открываем этот день (один раз) и убираем параметр из адреса.
  const emailDay = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (!state || emailDay.current !== undefined) return;
    const raw = new URLSearchParams(window.location.search).get("day");
    emailDay.current = raw && /^\d{1,2}$/.test(raw) ? Number(raw) : null;
    if (raw === null) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("day");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch {
      // Адресная строка не обязательна.
    }
    const door = emailDay.current === null ? undefined : state.doors.find((candidate) => candidate.n === emailDay.current);
    if (door && (door.status === "today" || door.status === "catchup" || door.status === "opened")) void openDoor(door.n);
  }, [state, openDoor]);
  function closeSheet() {
    const n = openN;
    setOpenN(null);
    if (n !== null) window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-door="${n}"]`)?.focus());
    // «Витрина»: окно, которое открыли за время листа, загорается при возврате к фасаду, на гирлянде вспыхивает огонёк.
    const nowOpened = state?.doors.find((door) => door.n === n)?.status === "opened";
    if (n !== null && advent.presentation === "storefront" && nowOpened && preStatus.current !== "opened") {
      setLit(n);
      if (litTimer.current !== null) window.clearTimeout(litTimer.current);
      litTimer.current = window.setTimeout(() => setLit(null), 2400);
    }
    preStatus.current = null;
  }

  function closeStreak() {
    setStreakOpen(false);
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".adv-garland-btn")?.focus());
  }

  async function requestLink(input: SaveProgressInput) {
    await api.requestLink(input);
  }

  async function changeReminders(enabled: boolean): Promise<AdventState> {
    // Включение всегда несёт согласие на рассылку: переключатель показывает его текст до запроса (`RemindersToggle`).
    return (await api.setReminders({ enabled, marketingConsent: enabled })).state;
  }

  const storefront = advent.presentation === "storefront" && advent.facade !== null;
  const header = storefront ? (
    <StoreHeader advent={advent} subtitle={storeSubtitle(advent, state, nowMs)} />
  ) : (
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
    const comeback =
      showComeback && comebackGrant ? (
        <ComebackBanner
          copy={copy}
          grant={comebackGrant}
          reduced={reduced}
          onClose={() => {
            writeFlag(`${COMEBACK_KEY}:${advent.slug}`, comebackGrant.id);
            setComebackHidden(true);
          }}
        />
      ) : null;
    const lead =
      current.phase === "upcoming" ? (
        <Countdown advent={advent} targetIso={current.doors[0].unlocksAt} nowMs={nowMs} />
      ) : finished ? (
        <AdventFinale advent={advent} state={current} reduced={reduced} nowMs={nowMs} extra={current.team ? <TeamBoard copy={copy} state={current} api={api} onState={adopt} /> : null} />
      ) : (
        comeback
      );
    body = storefront ? (
      <>
        {lead}
        <Storefront advent={advent} state={current} busy={busyDoor} lit={lit} reduced={reduced} onOpen={(n) => void openDoor(n)} onHint={showHint} onStreak={() => setStreakOpen(true)} />
      </>
    ) : (
      <>
        {current.phase === "running" ? (
          <>
            {comeback}
            <StreakHud state={current} copy={copy} />
            {current.team && <TeamBoard copy={copy} state={current} api={api} onState={adopt} />}
          </>
        ) : (
          lead
        )}
        <h2 className="adv-section-title">{copy.calendarTitle}</h2>
        <CalendarView doors={current.doors} copy={copy} timezone={advent.schedule.timezone} phase={current.phase} busy={busyDoor} onOpen={(n) => void openDoor(n)} onHint={showHint} />
        {current.participant.email ? (
          <>
            <p className="adv-saved"><span className="adv-dot" aria-hidden="true" /> {fill(copy.saveDone, { email: current.participant.email })}</p>
            <RemindersToggle copy={copy} marketingText={advent.legal.marketingConsentText} state={current} onChange={changeReminders} onState={adopt} />
          </>
        ) : (
          anyDone && !finished && openN === null && <SaveProgressCard copy={copy} consentText={advent.legal.consentText} marketingText={advent.legal.marketingConsentText} reason="after-day" onSubmit={requestLink} />
        )}
      </>
    );
  }

  const anyDoorDone = state?.doors.some((door) => door.completed) ?? false;
  const sheetOpen = openN !== null || streakOpen;
  return (
    <WorldProvider world={world} rooms={[]}>
      <div className="adv-app" data-phase={phase ?? "loading"} data-presentation={advent.presentation} data-sheet={sheetOpen ? "true" : "false"}>
        <div className="adv-bg" aria-hidden="true">
          <Snow count={22} className="adv-snow" />
          <span className="adv-glow adv-glow-a" />
          <span className="adv-glow adv-glow-b" />
        </div>
        <main className={`adv-main${storefront ? " adv-main-store" : ""}`} inert={sheetOpen}>
          {header}
          {!storefront && (
            <section className="adv-hero">
              <div className="adv-eyebrow">{advent.subtitle}</div>
              <h1 className="adv-title">{advent.title}</h1>
              <p className="adv-intro">{advent.intro}</p>
            </section>
          )}
          {body}
        </main>
        {state && openN !== null && (
          <DaySheet advent={advent} state={state} n={openN} reduced={reduced} nowMs={nowMs} api={api} onClose={closeSheet} onState={adopt} onError={onError} />
        )}
        {state && streakOpen && (
          <AdventSheet label={copy.garlandSheetTitle} closeLabel={copy.garlandSheetClose} onClose={closeStreak}>
            <div>
              <header className="adv-sheet-head">
                <h2 className="adv-sheet-title">{copy.garlandSheetTitle}</h2>
              </header>
              <StreakHud state={state} copy={copy} />
              {state.team && <TeamBoard copy={copy} state={state} api={api} onState={adopt} />}
              {state.participant.email ? (
                <>
                  <p className="adv-saved"><span className="adv-dot" aria-hidden="true" /> {fill(copy.saveDone, { email: state.participant.email })}</p>
                  <RemindersToggle copy={copy} marketingText={advent.legal.marketingConsentText} state={state} onChange={changeReminders} onState={adopt} />
                </>
              ) : (
                anyDoorDone && <SaveProgressCard copy={copy} consentText={advent.legal.consentText} marketingText={advent.legal.marketingConsentText} reason="after-day" onSubmit={requestLink} />
              )}
            </div>
          </AdventSheet>
        )}
        {/* Вне inert-фона и поверх листа: ошибки ответа на блок дня должны быть видны и озвучены при открытом листе. */}
        <p className="adv-hint" role="status" aria-live="polite" data-visible={hint ? "true" : "false"}>{hint ?? ""}</p>
      </div>
    </WorldProvider>
  );
}
