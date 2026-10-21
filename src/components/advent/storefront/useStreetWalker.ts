"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import type { HeroPose, SpriteFacing } from "@/components/quest/sprites";
import { facingAfter, introTarget, redirectWalk, standPoints, targetFor, walkFrame, type FacadeLayout, type Walk } from "@/domain/advent";

/** Пауза перед выходом из двери: фасад успевает отрисоваться, и выход виден. */
const INTRO_DELAY_MS = 450;
/** Сколько хозяин показывает на окно после прихода. */
const GESTURE_MS = 1500;
/** Сколько окно «отвечает» стуку. */
const KNOCK_MS = 900;
/** Запас таймера-страховки: если кадры не идут (фоновая вкладка), приход всё равно случится. */
const ARRIVE_SLACK_MS = 60;

export type StreetLook = { pose: HeroPose; facing: SpriteFacing };

export type StreetWalker = {
  /** Дорожка героя: её `transform` двигает хук напрямую, без перерисовок React. */
  trackRef: RefObject<HTMLSpanElement | null>;
  look: StreetLook;
  /**
   * Дойти до окна дня `n` и выполнить `act` (прежнее действие окна). Новый вызов во время ходьбы перенаправляет героя,
   * прежнее действие отбрасывается: выполнится ровно одно. `immediate` и `reduced` — действие сразу, герой лишь перемещается.
   */
  walk: (n: number, act: () => void, immediate?: boolean) => void;
};

type Options = {
  layout: FacadeLayout;
  /** Сегодняшнее окно: к нему хозяин выходит при первом показе. `null` — до старта и после финала. */
  today: number | null;
  /** Ходьба включена в пакете; выключенная — хозяин стоит в двери, действия выполняются сразу. */
  enabled: boolean;
  reduced: boolean;
};

/**
 * Хозяин на улице: положение в долях ширины стены (`street-walk.ts`), анимация — requestAnimationFrame и `transform` дорожки.
 * При первом показе в фазе running выходит из двери к сегодняшнему окну и стучит; без движения (`reduced`) сразу стоит под ним.
 */
export function useStreetWalker({ layout, today, enabled, reduced }: Options): StreetWalker {
  const points = useMemo(() => standPoints(layout), [layout]);
  const pointsRef = useRef(points);
  const trackRef = useRef<HTMLSpanElement>(null);
  const restRef = useRef(points.door);
  const walkRef = useRef<Walk | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);
  const facingRef = useRef<SpriteFacing>(1);
  const rafRef = useRef(0);
  const arriveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const introRef = useRef(false);
  const knockRef = useRef<number | null>(null);
  const reducedRef = useRef(reduced);
  const [look, setLook] = useState<StreetLook>({ pose: "wave", facing: 1 });

  useEffect(() => {
    pointsRef.current = points;
    reducedRef.current = reduced;
  }, [points, reduced]);

  const place = useCallback((x: number) => {
    const track = trackRef.current;
    if (track) track.style.transform = `translate3d(${x * 100}%, 0, 0)`;
  }, []);

  const stopFrames = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (arriveTimer.current) clearTimeout(arriveTimer.current);
    arriveTimer.current = null;
  }, []);

  const gesture = useCallback((facing: SpriteFacing) => {
    if (gestureTimer.current) clearTimeout(gestureTimer.current);
    setLook({ pose: "wave", facing });
    gestureTimer.current = setTimeout(() => setLook({ pose: "idle", facing }), GESTURE_MS);
  }, []);

  // Приход: ровно один раз на путь (кадр и таймер-страховка могут сойтись), затем отложенное действие окна.
  const arrive = useCallback(() => {
    const finished = walkRef.current;
    if (!finished) return;
    walkRef.current = null;
    stopFrames();
    restRef.current = finished.to;
    place(finished.to);
    facingRef.current = facingAfter(finished, facingRef.current);
    const act = pendingRef.current;
    pendingRef.current = null;
    if (knockRef.current !== null) {
      const window = trackRef.current?.closest(".adv-facade")?.querySelector(`[data-door="${knockRef.current}"]`);
      knockRef.current = null;
      if (window) {
        window.setAttribute("data-knock", "true");
        if (knockTimer.current) clearTimeout(knockTimer.current);
        knockTimer.current = setTimeout(() => window.removeAttribute("data-knock"), KNOCK_MS);
      }
    }
    gesture(facingRef.current);
    act?.();
  }, [gesture, place, stopFrames]);

  const go = useCallback(
    (to: number) => {
      const now = performance.now();
      const next = redirectWalk(walkRef.current, restRef.current, to, now);
      stopFrames();
      if (gestureTimer.current) clearTimeout(gestureTimer.current);
      walkRef.current = next;
      if (next.duration <= 0) {
        arrive();
        return;
      }
      facingRef.current = next.to > next.from ? 1 : -1;
      setLook({ pose: "run", facing: facingRef.current });
      const frame = () => {
        const current = walkRef.current;
        if (!current) return;
        const state = walkFrame(current, performance.now());
        place(state.x);
        if (state.done) arrive();
        else rafRef.current = requestAnimationFrame(frame);
      };
      rafRef.current = requestAnimationFrame(frame);
      arriveTimer.current = setTimeout(arrive, next.duration + ARRIVE_SLACK_MS);
    },
    [arrive, place, stopFrames]
  );

  const walk = useCallback(
    (n: number, act: () => void, immediate = false) => {
      if (!enabled) {
        act();
        return;
      }
      const to = targetFor(pointsRef.current, n);
      if (reducedRef.current) {
        stopFrames();
        walkRef.current = null;
        pendingRef.current = null;
        restRef.current = to;
        place(to);
        act();
        return;
      }
      if (immediate) {
        pendingRef.current = null;
        go(to);
        act();
        return;
      }
      pendingRef.current = act;
      go(to);
    },
    [enabled, go, place, stopFrames]
  );

  // Первый показ в фазе running: выход к сегодняшнему окну (раз за жизнь витрины).
  useEffect(() => {
    if (!enabled || introRef.current) return;
    const target = introTarget(pointsRef.current, today);
    if (target === null) return;
    if (reduced) {
      introRef.current = true;
      restRef.current = target;
      place(target);
      return;
    }
    const timer = setTimeout(() => {
      introRef.current = true;
      knockRef.current = today;
      go(target);
    }, INTRO_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled, reduced, today, go, place]);

  // Движение выключили на ходу: герой сразу на месте, отложенное действие не теряется.
  useEffect(() => {
    if (!reduced) return;
    const current = walkRef.current;
    if (!current) return;
    stopFrames();
    walkRef.current = null;
    restRef.current = current.to;
    place(current.to);
    const act = pendingRef.current;
    pendingRef.current = null;
    act?.();
  }, [reduced, place, stopFrames]);

  // Положение сохраняется при перерисовке: дорожку ставим на место при появлении.
  useEffect(() => {
    place(restRef.current);
  }, [place]);

  useEffect(
    () => () => {
      stopFrames();
      pendingRef.current = null;
      for (const timer of [gestureTimer, knockTimer]) if (timer.current) clearTimeout(timer.current);
    },
    [stopFrames]
  );

  return { trackRef, look: reduced ? { pose: "idle", facing: look.facing } : look, walk };
}
