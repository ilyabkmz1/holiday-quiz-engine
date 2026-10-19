"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { ApiError, gameApi } from "@/components/game/api";
import type { Mood } from "@/components/game/characters";
import { ShareScreen } from "@/components/game/FinalScreen";
import { usePrefersReducedMotion } from "@/components/game/hooks";
import { readSeen } from "@/components/game/seen";
import { getSound, useSoundTheme, type SoundTheme } from "@/components/play/sound";
import { useSessionBoot } from "@/components/play/useSessionBoot";
import { litRooms, questReducer, type QuestPhase } from "@/components/quest/phase";
import { QuestHud, type RushHud } from "@/components/quest/QuestHud";
import { ClaimPanel, FinalPanel } from "@/components/quest/QuestFinal";
import { ProloguePanel, usePrologue } from "@/components/quest/QuestPrologue";
import { QuestRoomFlow, type RoomView } from "@/components/quest/QuestRoomFlow";
import { QuestSheet, type SheetSize } from "@/components/quest/QuestSheet";
import { resolveRoomHero, type HeroView } from "@/components/quest/hero-view";
import { QuestWorld, type ServiceMarker, type WorldStage } from "@/components/quest/QuestWorld";
import type { BubbleSpec } from "@/components/quest/ScreenOverlay";
import { useRush } from "@/components/quest/useRush";
import { useWorldModel, WorldProvider } from "@/components/play/world-context";
import type { World } from "@/worlds/world";
import type { AnswerResponse, PublicCampaign, PublicTask, RushState, SessionProgress } from "@/types/api";

const STAGE_OF: Record<QuestPhase["kind"], WorldStage> = {
  prologue: "prologue",
  explore: "explore",
  room: "room",
  celebrate: "celebrate",
  rushIntro: "rush",
  rush: "rush",
  finishing: "rush",
  final: "finale",
  claim: "finale"
};

const THEME_OF: Record<QuestPhase["kind"], SoundTheme> = {
  prologue: "world",
  explore: "world",
  room: "world",
  celebrate: "world",
  rushIntro: "rush",
  rush: "rush",
  finishing: "rush",
  final: "finale",
  claim: "finale"
};

const EMPTY_SESSION: SessionProgress = {
  id: "none", status: "playing", score: 0, combo: 0, rooms: [], roomsCompleted: 0, rushUnlocked: false, rush: null, answers: [], completedAt: null, final: null
};

type RushView = RushHud & { prompt: string | null; index: number; finished: boolean; tap: (serviceId: string) => Promise<void> };

/** Контроллер рывка: ведёт раунд и сообщает состояние миру. Своего интерфейса не имеет. */
function RushController({ campaign, sessionId, initial, onScore, onDone, onError, onView }: {
  campaign: PublicCampaign;
  sessionId: string;
  initial: RushState;
  onScore: (score: number) => void;
  onDone: () => void;
  onError: (error: unknown) => void;
  onView: (view: RushView | null) => void;
}) {
  const state = useRush({
    campaign, sessionId, initial, onScore, onDone, onError,
    onFeedback: (kind) => getSound().effect(kind === "hit" ? "correct" : "miss")
  });
  const { rush, finished, seconds, percent, hot, tap, feedback } = state;
  const prompt = finished ? null : (rush.current?.prompt ?? null);
  const index = rush.current?.index ?? rush.answered;
  const view = useMemo<RushView>(
    () => ({ hits: rush.hits, seconds, hot, percent, prompt, index, finished, tap }),
    [rush.hits, seconds, hot, percent, prompt, index, finished, tap]
  );
  const viewRef = useRef(onView);
  useEffect(() => {
    viewRef.current = onView;
  });
  useEffect(() => {
    viewRef.current(view);
  }, [view]);
  useEffect(() => () => viewRef.current(null), []);
  return (
    <p className="sr-only" role="status" aria-live="polite">
      {feedback?.kind === "hit" ? `Верно, плюс ${campaign.rush.pointsPerHit}` : feedback?.kind === "miss" ? `Ошибка, минус ${campaign.rush.penaltySeconds} секунды` : ""}
    </p>
  );
}

/**
 * Квест: мир-иллюстрация, по которому бегает персонаж. Сессия, комнаты, задания, рывок и заявка на приз —
 * тот же API, что у карточного режима; фазы выводятся из `SessionProgress` редьюсером `questReducer`.
 */
export function QuestGame({ campaign, world }: { campaign: PublicCampaign; world: World }) {
  // «Сыграть ещё раз» перемонтирует игру: пролог, симуляция мира, герои и полёты начинаются с нуля.
  const [run, setRun] = useState(0);
  return (
    <WorldProvider world={world} rooms={campaign.rooms}>
      <QuestRun key={run} campaign={campaign} onRestart={() => setRun((count) => count + 1)} />
    </WorldProvider>
  );
}

function QuestRun({ campaign: initialCampaign, onRestart }: { campaign: PublicCampaign; onRestart: () => void }) {
  const { SPOTS } = useWorldModel();
  const reduced = usePrefersReducedMotion();
  const [phase, dispatch] = useReducer(questReducer, { kind: "prologue" } as QuestPhase);
  const [heroes, setHeroes] = useState<Record<string, HeroView>>({});
  const [roomView, setRoomView] = useState<RoomView | null>(null);
  const [rushView, setRushView] = useState<RushView | null>(null);
  const [fault, setFault] = useState<{ roomId: string; key: number } | null>(null);
  const [sheet, setSheet] = useState<SheetSize>({ bottom: 0, right: 0 });
  const [flakes, setFlakes] = useState(0);
  const [showShare, setShowShare] = useState(false);
  const [busy, setBusy] = useState(false);

  const boot = useSessionBoot({
    campaign: initialCampaign,
    onResume: (loaded) => dispatch({ type: "resume", session: loaded, readMark: (taskId) => readSeen(loaded.id, taskId) }),
    onForget: () => dispatch({ type: "forget" })
  });
  const { campaign, session, skewMs, notice, setNotice, onError, patch, refresh, reload } = boot;
  const sessionRef = useRef<SessionProgress | null>(session);
  useEffect(() => {
    sessionRef.current = session;
  });

  const prologue = usePrologue(campaign, phase.kind === "prologue", reduced);
  useSoundTheme(THEME_OF[phase.kind]);

  const lit = useMemo(() => litRooms(session, phase), [session, phase]);
  const finale = phase.kind === "final" || phase.kind === "claim";

  // Герой комнаты: при открытой карточке и у пройденной комнаты — герой последнего задания, иначе — герой следующей заявки.
  const openRoomId = phase.kind === "room" ? phase.roomId : null;
  const heroIdOf = useCallback(
    (roomId: string) => {
      return resolveRoomHero({
        view: heroes[roomId],
        progress: session?.rooms.find((room) => room.roomId === roomId),
        playing: openRoomId === roomId,
        host: campaign.rooms.find((room) => room.id === roomId)?.hostId ?? campaign.heroes[0].id
      }).heroId;
    },
    [heroes, session, openRoomId, campaign.heroes, campaign.rooms]
  );
  const heroNameOf = useCallback((roomId: string) => campaign.heroes.find((hero) => hero.id === heroIdOf(roomId))?.name ?? "", [campaign.heroes, heroIdOf]);

  // Цель: комната в процессе, иначе первая ещё тёмная.
  const goalRoom = useMemo(() => {
    if (!session || phase.kind !== "explore") return null;
    const open = session.rooms.find((room) => room.entered && !room.completed);
    if (open) return open.roomId;
    return campaign.rooms.find((room) => !session.rooms.find((item) => item.roomId === room.id)?.completed)?.id ?? null;
  }, [session, phase.kind, campaign.rooms]);
  const goalText = useMemo(() => {
    if (phase.kind === "rushIntro") return "Цель: рывок у ёлки";
    if (!goalRoom) return null;
    const room = campaign.rooms.find((candidate) => candidate.id === goalRoom);
    return room ? `Цель: ${room.title} — ${heroNameOf(goalRoom)}` : null;
  }, [phase.kind, goalRoom, campaign.rooms, heroNameOf]);

  const onTask = useCallback((task: PublicTask) => {
    setHeroes((current) => ({ ...current, [task.roomId]: { heroId: task.heroId, mood: "neutral" } }));
  }, []);
  const onAnswered = useCallback((result: AnswerResponse, task: PublicTask) => {
    const mood: Mood = result.reveal.mood;
    setHeroes((current) => ({ ...current, [task.roomId]: { heroId: task.heroId, mood } }));
    getSound().effect(result.reveal.outcome === "miss" ? "miss" : "correct");
    if (result.reveal.outcome === "miss") setFault({ roomId: task.roomId, key: Date.now() });
  }, []);

  const closeRoom = useCallback(() => {
    const current = sessionRef.current;
    dispatch({ type: "closeRoom", session: current });
    // Незавершённая комната: герой снова определяется следующей заявкой, а не последним разбором.
    setHeroes((views) => Object.fromEntries(Object.entries(views).filter(([roomId]) => current?.rooms.find((room) => room.roomId === roomId)?.completed)));
    // Фокус возвращается в мир: на кнопку «Помочь» (если герой рядом) или «Список комнат».
    window.setTimeout(() => document.querySelector<HTMLElement>(".qw-help, .qw-list-btn")?.focus(), 80);
  }, []);

  useEffect(() => {
    if (phase.kind !== "room") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRoom();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase.kind, closeRoom]);

  async function finishPrologue() {
    setBusy(true);
    try {
      const created = await boot.create();
      if (created) dispatch({ type: "prologueDone" });
    } finally {
      setBusy(false);
    }
  }

  async function startRush() {
    const id = session?.id;
    if (!id) return;
    setBusy(true);
    try {
      const started = await gameApi.startRush(id);
      boot.applyServerTime(started.serverDate);
      patch((current) => ({ ...current, rush: started.rush, score: started.score }));
      dispatch({ type: "startRush" });
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  const onScore = useCallback((score: number) => patch((current) => ({ ...current, score })), [patch]);
  const onRushDone = useCallback(() => dispatch({ type: "rushOver" }), []);

  // Завершение игры: complete повторяется, пока сервер считает рывок идущим.
  const sessionId = session?.id ?? null;
  const { setFatal } = boot;
  useEffect(() => {
    if (phase.kind !== "finishing" || !sessionId) return;
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; attempt < 8 && !cancelled; attempt += 1) {
        try {
          await gameApi.complete(sessionId);
          if (cancelled) return;
          const fresh = await reload(false);
          if (!cancelled && fresh?.final) dispatch({ type: "finalReady" });
          return;
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            // 409 — «рывок ещё идёт»: сервер ещё не закрыл рывок (окно допуска), ждём секунду. Но если рывка на сервере
            // уже нет (состояние разошлось), это не ожидание: разбор ошибки вернёт игрока туда, где его застал сервер.
            const fresh = await reload(false).catch(() => null);
            if (cancelled) return;
            if (fresh && !fresh.rush) {
              onError(error);
              return;
            }
            await new Promise((resolve) => window.setTimeout(resolve, 1000));
            continue;
          }
          // Всё остальное, включая 400 (неверный запрос), — настоящая ошибка, а не «подождите».
          if (!cancelled) onError(error);
          return;
        }
      }
      if (!cancelled) setFatal("Не удалось завершить игру. Проверьте соединение и повторите.");
    })();
    return () => {
      cancelled = true;
    };
  }, [phase.kind, sessionId, reload, onError, setFatal]);

  // Пока идёт рывок, мир показывает сервисы-комнаты; реплики заявок — над героями у ёлки.
  // Мир зависит только от этих полей рывка: секунды и проценты таймера (меняются постоянно) — дело HUD.
  const rushLive = phase.kind === "rush" && !!rushView && !rushView.finished;
  const rushPrompt = phase.kind === "rush" ? (rushView?.prompt ?? null) : null;
  const rushIndex = rushView?.index ?? 0;
  const rushTap = rushView?.tap;
  const services = useMemo<ServiceMarker[] | null>(() => {
    if (!rushLive) return null;
    return campaign.rush.services.map((service) => ({ id: service.id, roomId: service.id, title: service.title, icon: service.icon, color: service.color }));
  }, [rushLive, campaign.rush.services]);
  const tapRef = useRef(rushTap);
  useEffect(() => {
    tapRef.current = rushTap;
  });
  const onService = useCallback((serviceId: string) => void tapRef.current?.(serviceId), []);
  const onHelp = useCallback((roomId: string) => dispatch({ type: "openRoom", roomId }), []);
  const onCelebrated = useCallback(() => dispatch({ type: "celebrated", session: sessionRef.current }), []);

  // Реплика героя в карточке: таймер и предохранители меняются каждую секунду, а облачко — только со словами героя.
  const dialogRoom = roomView?.roomId ?? null;
  const dialogHero = roomView?.heroId ?? null;
  const dialogLine = roomView?.line ?? "";
  const dialogShown = !!roomView && roomView.phase !== "result" && roomView.phase !== "loading";
  const dialog = useMemo(
    () => (dialogShown && dialogRoom && dialogHero && dialogLine ? { roomId: dialogRoom, heroId: dialogHero, line: dialogLine } : null),
    [dialogShown, dialogRoom, dialogHero, dialogLine]
  );
  const bubbles = useMemo<BubbleSpec[]>(() => {
    if (phase.kind === "prologue") return prologue.bubbles;
    if (phase.kind === "room" && dialog) {
      const hero = campaign.heroes.find((candidate) => candidate.id === dialog.heroId);
      return [{ id: "dialog", anchor: { kind: "hero", roomId: dialog.roomId }, title: hero ? `${hero.name}, ${hero.role}` : undefined, text: dialog.line }];
    }
    if (phase.kind === "rush" && rushPrompt) {
      const speaker = SPOTS[rushIndex % SPOTS.length];
      return [{ id: "rush-prompt", anchor: { kind: "hero", roomId: speaker.roomId }, title: `${heroNameOf(speaker.roomId)} · заявка №${rushIndex + 1}`, text: rushPrompt, pin: "top" }];
    }
    return [];
  }, [phase.kind, prologue.bubbles, dialog, rushPrompt, rushIndex, campaign.heroes, heroNameOf, SPOTS]);

  if (boot.fatal) {
    return (
      <main className="quest quest-center">
        <h1 className="rush-h1">Не получилось</h1>
        <p className="muted" role="alert">{boot.fatal}</p>
        <button type="button" className="btn btn-primary quest-btn" onClick={() => window.location.reload()}>Повторить</button>
      </main>
    );
  }
  if (!boot.booted) {
    return (
      <main className="quest quest-center" role="status">
        <p className="muted">Загружаем офис в шаре…</p>
      </main>
    );
  }

  // Диалог открыт (карточка комнаты, итог, заявка, «Поделиться»): всё вне него недоступно, включая HUD.
  const sheetOpen = phase.kind === "room" || phase.kind === "final" || phase.kind === "claim";
  const modal = sheetOpen || showShare;
  const roomOpen = phase.kind === "room" && session ? campaign.rooms.find((candidate) => candidate.id === phase.roomId) : undefined;
  const stage = STAGE_OF[phase.kind];
  const rushHud: RushHud | null = phase.kind === "rush" && rushView ? { hits: rushView.hits, seconds: rushView.seconds, hot: rushView.hot, percent: rushView.percent } : null;

  return (
    <main className={`quest${phase.kind === "room" ? " quest-sheet-open" : ""}`} data-phase={phase.kind}>
      <div className="qw-layer" inert={modal}>
        <QuestWorld
          campaign={campaign}
          session={session ?? EMPTY_SESSION}
          heroes={heroes}
          stage={stage}
          lit={lit}
          focusRoom={roomOpen?.id ?? null}
          sheet={sheet}
          goalRoom={goalRoom}
          bubbles={bubbles}
          celebrate={phase.kind === "celebrate" ? { roomId: phase.roomId, key: campaign.rooms.findIndex((room) => room.id === phase.roomId) + 1 } : null}
          onCelebrated={onCelebrated}
          fault={fault}
          prologueStep={phase.kind === "prologue" ? prologue.step : 3}
          prologueHero={phase.kind === "prologue" && prologue.step >= 2 ? prologue.hero : null}
          services={services}
          onService={onService}
          onHelp={onHelp}
          onFlakes={setFlakes}
          finale={finale}
          treeFlakes={finale ? Math.min(flakes, 30) : 0}
        />
      </div>

      <QuestHud
        campaign={campaign}
        session={session}
        litCount={finale ? campaign.rooms.length : lit.size}
        goal={goalText}
        flakes={flakes}
        room={phase.kind === "room" ? roomView : null}
        rush={rushHud}
        showScore={phase.kind !== "prologue"}
        inert={modal}
      />

      {notice && (
        <div className="notice" role="alert">
          <span>{notice}</span>
          <button type="button" className="notice-close" aria-label="Закрыть сообщение" onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      {phase.kind === "prologue" && <ProloguePanel campaign={campaign} state={prologue} busy={busy} onDone={() => void finishPrologue()} />}

      {phase.kind === "room" && roomOpen && session && (
        <QuestSheet label={`Заявка в комнате «${roomOpen.title}»`} onClose={closeRoom} onSize={setSheet}>
          <QuestRoomFlow
            key={roomOpen.id}
            campaign={campaign}
            sessionId={session.id}
            roomId={roomOpen.id}
            resume={phase.resume}
            session={session}
            skewMs={skewMs}
            onPatch={patch}
            onRefresh={refresh}
            onView={setRoomView}
            onAnswered={onAnswered}
            onTask={onTask}
            onClose={closeRoom}
            onError={onError}
          />
        </QuestSheet>
      )}

      {phase.kind === "rushIntro" && (
        <section className="qw-panel qw-ui" aria-label="Финальный рывок">
          <div className="rush-clock pop" aria-hidden="true">{campaign.scene.rushClock}</div>
          <h2 className="qw-panel-title">Финальный рывок!</h2>
          <p className="muted">{campaign.rush.intro}</p>
          <button type="button" className="btn btn-gold" onClick={() => void startRush()} disabled={busy} autoFocus>
            {busy ? "Запускаем…" : "Поехали!"}
          </button>
        </section>
      )}

      {phase.kind === "rush" && session?.rush && (
        <RushController campaign={campaign} sessionId={session.id} initial={session.rush} onScore={onScore} onDone={onRushDone} onError={onError} onView={setRushView} />
      )}
      {phase.kind === "rush" && (
        <p className="qw-hint qw-ui">Ошибка отнимает {campaign.rush.penaltySeconds} с · тапните по сервису на шаре или нажмите 1–{campaign.rush.services.length}</p>
      )}

      {phase.kind === "finishing" && (
        <section className="qw-panel qw-ui" role="status" aria-label="Время вышло">
          <h2 className="qw-panel-title">Время вышло!</h2>
          <p className="muted">Считаем результат…</p>
        </section>
      )}

      {phase.kind === "final" && session?.final && (
        <QuestSheet label="Результат игры" tall onSize={setSheet} inert={showShare}>
          <FinalPanel campaign={campaign} final={session.final} flakes={flakes} onClaim={() => dispatch({ type: "claim" })} onShare={() => setShowShare(true)} onRestart={() => {
            boot.restart();
            onRestart();
          }} />
        </QuestSheet>
      )}
      {phase.kind === "claim" && session?.final && (
        <QuestSheet label="Заявка на подарок" tall onClose={() => dispatch({ type: "back" })} closeLabel="Закрыть заявку" onSize={setSheet} inert={showShare}>
          <ClaimPanel sessionId={session.id} final={session.final} consentText={campaign.legal.consentText} onBack={() => dispatch({ type: "back" })} />
        </QuestSheet>
      )}

      {showShare && session?.final && (
        <div className="qw-overlay" role="dialog" aria-modal="true" aria-label="Карточка результата">
          <ShareScreen campaign={campaign} final={session.final} flakes={flakes} onBack={() => setShowShare(false)} />
        </div>
      )}
    </main>
  );
}
