"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, gameApi } from "@/components/game/api";
import { BrandMark } from "@/components/game/BrandMark";
import { ClaimScreen, FinalScreen, ShareScreen } from "@/components/game/FinalScreen";
import { MapScreen } from "@/components/game/MapScreen";
import { Landing, Prologue } from "@/components/game/Prologue";
import { pendingRoomResume, type RoomResume } from "@/components/game/resume";
import { RoomScreen } from "@/components/game/RoomScreen";
import { RushIntro, RushScreen } from "@/components/game/RushScreen";
import { readSeen } from "@/components/game/seen";
import { useSessionBoot } from "@/components/play/useSessionBoot";
import { WorldProvider } from "@/components/play/world-context";
import type { PublicCampaign, PublicRoom, SessionProgress } from "@/types/api";
import type { World } from "@/worlds/world";

type View =
  | { name: "boot" }
  | { name: "landing" }
  | { name: "prologue" }
  | { name: "map" }
  | { name: "room"; roomId: string; resume?: RoomResume }
  | { name: "rushIntro" }
  | { name: "rush" }
  | { name: "finishing" }
  | { name: "final" }
  | { name: "claim" }
  | { name: "share" }
  | { name: "fatal"; message: string };

/** Куда вернуть игрока по данным сервера. Локальным догадкам не доверяем. */
export function viewFor(session: SessionProgress): View {
  if (session.status === "completed" && session.final) return { name: "final" };
  if (session.rush) return session.rush.status === "running" ? { name: "rush" } : { name: "finishing" };
  const pending = pendingRoomResume(session, (taskId) => readSeen(session.id, taskId));
  if (pending) return { name: "room", roomId: pending.roomId, resume: pending };
  const open = session.rooms.find((room) => room.entered && !room.completed);
  if (open) return { name: "room", roomId: open.roomId };
  return { name: "map" };
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function QuizGame({ campaign, world }: { campaign: PublicCampaign; world: World }) {
  return (
    <WorldProvider world={world} rooms={campaign.rooms}>
      <QuizRun campaign={campaign} />
    </WorldProvider>
  );
}

function QuizRun({ campaign: initialCampaign }: { campaign: PublicCampaign }) {
  const [view, setView] = useState<View>({ name: "boot" });
  const [busy, setBusy] = useState(false);
  const noticeTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    },
    []
  );

  const boot = useSessionBoot({
    campaign: initialCampaign,
    onResume: (loaded) => setView(viewFor(loaded)),
    onForget: () => setView({ name: "landing" })
  });
  const { campaign, session, skewMs, notice, setNotice, applyServerTime, refresh, reload, onError, patch: patchSession } = boot;
  const sessionId = session?.id ?? null;

  async function begin() {
    setBusy(true);
    try {
      const created = await boot.create();
      if (created) setView({ name: "map" });
    } finally {
      setBusy(false);
    }
  }

  async function startRush() {
    if (!sessionId) return;
    setBusy(true);
    try {
      const started = await gameApi.startRush(sessionId);
      applyServerTime(started.serverDate);
      patchSession((current) => ({ ...current, rush: started.rush, score: started.score }));
      setView({ name: "rush" });
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  // Завершение игры: complete повторяется, пока сервер считает рывок идущим.
  useEffect(() => {
    if (view.name !== "finishing" || !sessionId) return;
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; attempt < 8 && !cancelled; attempt += 1) {
        try {
          await gameApi.complete(sessionId);
          if (cancelled) return;
          const fresh = await reload(false);
          if (!cancelled && fresh) setView(viewFor(fresh));
          return;
        } catch (error) {
          if (error instanceof ApiError && (error.status === 409 || error.status === 400)) {
            // «Рывок ещё идёт»: сервер ещё не закрыл рывок, ждём секунду.
            await wait(1000);
            continue;
          }
          if (!cancelled) onError(error);
          return;
        }
      }
      if (!cancelled) setView({ name: "fatal", message: "Не удалось завершить игру. Проверьте соединение и повторите." });
    })();
    return () => {
      cancelled = true;
    };
  }, [view.name, sessionId, reload, onError]);

  function openRoom(room: PublicRoom) {
    const progress = session?.rooms.find((item) => item.roomId === room.id);
    if (progress?.completed) {
      setNotice(`Комната «${room.title}» уже светится. Выберите другую.`);
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setNotice(null), 3000);
      return;
    }
    setNotice(null);
    setView({ name: "room", roomId: room.id });
  }

  const toMap = useCallback(() => setView({ name: "map" }), []);
  const toRushFinish = useCallback(() => setView({ name: "finishing" }), []);
  const onScore = useCallback((score: number) => patchSession((current) => ({ ...current, score })), [patchSession]);

  const showBrand = ["landing", "prologue", "final", "claim", "share"].includes(view.name);

  if (boot.fatal && view.name !== "fatal") {
    return (
      <main className="app app-fatal">
        <div className="screen center">
          <h1 className="rush-h1">Не получилось</h1>
          <p className="muted" role="alert">{boot.fatal}</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Повторить</button>
        </div>
      </main>
    );
  }

  return (
    <main className={`app app-${view.name}`}>
      {showBrand && (
        <header className="topbar">
          <div className="brand"><BrandMark brand={campaign.brand} /></div>
          <div className="topbar-note">{campaign.brand.topNote}</div>
        </header>
      )}
      {notice && (
        <div className="notice" role="alert">
          <span>{notice}</span>
          <button type="button" className="notice-close" aria-label="Закрыть сообщение" onClick={() => setNotice(null)}>×</button>
        </div>
      )}
      {view.name === "boot" && (
        <div className="screen center" role="status">
          <p className="muted">Загружаем игру…</p>
        </div>
      )}
      {view.name === "fatal" && (
        <div className="screen center">
          <h1 className="rush-h1">Не получилось</h1>
          <p className="muted" role="alert">{view.message}</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Повторить</button>
        </div>
      )}
      {view.name === "landing" && <Landing campaign={campaign} onStart={() => setView({ name: "prologue" })} />}
      {view.name === "prologue" && <Prologue campaign={campaign} busy={busy} onDone={() => void begin()} />}
      {session && view.name === "map" && (
        <MapScreen campaign={campaign} session={session} onOpenRoom={openRoom} onRush={() => setView({ name: "rushIntro" })} />
      )}
      {session && view.name === "room" && (
        <RoomScreen
          key={view.roomId}
          campaign={campaign}
          sessionId={session.id}
          roomId={view.roomId}
          resume={view.resume}
          session={session}
          skewMs={skewMs}
          onPatch={patchSession}
          onRefresh={refresh}
          onExit={toMap}
          onError={onError}
        />
      )}
      {session && view.name === "rushIntro" && <RushIntro campaign={campaign} busy={busy} onStart={() => void startRush()} />}
      {session && view.name === "rush" && session.rush && (
        <RushScreen
          campaign={campaign}
          sessionId={session.id}
          initial={session.rush}
          score={session.score}
          onScore={onScore}
          onDone={toRushFinish}
          onError={onError}
        />
      )}
      {view.name === "finishing" && (
        <div className="screen center" role="status">
          <h1 className="rush-h1">Время вышло!</h1>
          <p className="muted">Считаем результат…</p>
        </div>
      )}
      {session?.final && view.name === "final" && (
        <FinalScreen campaign={campaign} final={session.final} onClaim={() => setView({ name: "claim" })} onShare={() => setView({ name: "share" })} onRestart={boot.restart} />
      )}
      {session?.final && view.name === "claim" && (
        <ClaimScreen sessionId={session.id} final={session.final} consentText={campaign.legal.consentText} onBack={() => setView({ name: "final" })} />
      )}
      {session?.final && view.name === "share" && (
        <ShareScreen campaign={campaign} final={session.final} onBack={() => setView({ name: "final" })} />
      )}
    </main>
  );
}
