"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { Sparks } from "@/components/game/ambient";
import { ToyBall } from "@/components/quest/sprites";
import { useWorldModel } from "@/components/play/world-context";

export type CelebrateEvent = { roomId: string; key: number };

/** Расписание праздника, мс от начала. Не зависит от обновлений сессии: таймеры живут только в этом компоненте. */
export const CELEBRATION_TIMELINE = { fly: 700, land: 2000, camera: 2300, done: 2700 } as const;

type Props = {
  event: CelebrateEvent | null;
  color: string;
  roomIndex: number;
  reduced: boolean;
  /** Камера отъезжает показать весь шар и возвращается. */
  onCamera: (ms: number) => void;
  /** Игрушка повисла на ёлке. */
  onLanded: (roomId: string) => void;
  /** Очки улетают в счётчик HUD. */
  onFlyPoints: (roomId: string) => void;
  /** Эффекты: вибрация и звук. */
  onFeedback: () => void;
  onDone: (key: number) => void;
};

/**
 * Праздник комнаты: свет вспыхивает и бежит по гирлянде к ёлке, герой отдаёт игрушку,
 * она крупно летит на ёлку, камера на пару секунд показывает весь шар, очки улетают в HUD.
 * У события свой жизненный цикл: пока оно идёт, повторные рендеры родителя таймеры не трогают.
 */
export function Celebration({ event, color, roomIndex, reduced, onCamera, onLanded, onFlyPoints, onFeedback, onDone }: Props) {
  const { spotOf, STAR_POS, treeSlot, WORLD_H, WORLD_W } = useWorldModel();
  const [stage, setStage] = useState<"idle" | "hand" | "fly" | "landed">("idle");
  const callbacks = useRef({ onCamera, onLanded, onFlyPoints, onFeedback, onDone });
  useEffect(() => {
    callbacks.current = { onCamera, onLanded, onFlyPoints, onFeedback, onDone };
  });
  const key = event?.key ?? null;
  const roomId = event?.roomId ?? null;

  useEffect(() => {
    if (key === null || roomId === null) return;
    const cb = callbacks.current;
    if (reduced) {
      // Без движения: игрушка сразу на ёлке, праздник заканчивается.
      cb.onFeedback();
      cb.onLanded(roomId);
      cb.onFlyPoints(roomId);
      const timer = window.setTimeout(() => callbacks.current.onDone(key), 0);
      return () => window.clearTimeout(timer);
    }
    const T = CELEBRATION_TIMELINE;
    const timers = [
      window.setTimeout(() => {
        setStage("hand");
        callbacks.current.onFeedback();
        callbacks.current.onCamera(T.camera);
      }, 0),
      window.setTimeout(() => setStage("fly"), T.fly),
      window.setTimeout(() => {
        setStage("landed");
        callbacks.current.onLanded(roomId);
        callbacks.current.onFlyPoints(roomId);
      }, T.land),
      window.setTimeout(() => {
        setStage("idle");
        callbacks.current.onDone(key);
      }, T.done)
    ];
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      setStage("idle");
    };
  }, [key, roomId, reduced]);

  if (key === null || roomId === null || reduced || stage === "idle") return null;
  const spot = spotOf(roomId);
  if (!spot) return null;
  const slot = treeSlot(roomIndex);
  const from = { x: spot.heroPos.x, y: spot.heroPos.y - 70 };
  return (
    <div key={key} className="qw-celebration" aria-hidden="true" data-stage={stage}>
      <span className="qw-flash" style={{ left: spot.center.x, top: spot.center.y }} />
      <div className="qw-sparks-pos" style={{ left: spot.center.x, top: spot.center.y }}>
        <Sparks centers={[[50, 50]]} per={14} radius={110} />
      </div>
      <svg className="qw-garland-run" width={WORLD_W} height={WORLD_H} viewBox={`0 0 ${WORLD_W} ${WORLD_H}`}>
        <path
          d={`M ${spot.center.x} ${spot.center.y - 20} Q ${(spot.center.x + STAR_POS.x) / 2} ${Math.min(spot.center.y, STAR_POS.y) - 140} ${STAR_POS.x} ${STAR_POS.y}`}
          pathLength={1}
        />
      </svg>
      {stage === "fly" && (
        <span
          className="qw-toy-fly"
          style={{ "--fx": `${from.x}px`, "--fy": `${from.y}px`, "--tx": `${slot.x}px`, "--ty": `${slot.y}px` } as CSSProperties}
        >
          <ToyBall color={color} size={44} />
        </span>
      )}
      {stage === "hand" && (
        <span className="qw-toy-hand" style={{ left: from.x, top: from.y }}>
          <ToyBall color={color} size={34} />
        </span>
      )}
      {stage === "landed" && <span className="qw-tree-flash" style={{ left: slot.x, top: slot.y }} />}
    </div>
  );
}
