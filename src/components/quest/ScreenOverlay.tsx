"use client";

import { memo, useCallback, useEffect, type ReactNode } from "react";

import type { OverlayLayer } from "@/components/quest/overlay";
import type { Point } from "@/components/quest/pathfinding";

export type BubbleSpec = {
  id: string;
  /** К кому привязано облачко: герой комнаты, игрок, робот. */
  anchor: { kind: "hero"; roomId: string } | { kind: "player" } | { kind: "robot" } | { kind: "point"; at: Point };
  title?: string;
  text: string;
  tone?: "hero" | "robot" | "player";
  /** Закрепить облачко под HUD (рывок: заявка не закрывает комнаты на шаре). */
  pin?: "top";
};

/** Облачко реплики. Положение ставит цикл мира через `OverlayLayer` (без чтения размеров в кадре). */
const Bubble = memo(function Bubble({ layer, spec }: { layer: OverlayLayer; spec: BubbleSpec }) {
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      layer.register(spec.id, el);
    },
    [layer, spec.id]
  );
  return (
    <div
      className={`qw-bubble${spec.tone === "robot" ? " qw-bubble-robot" : spec.tone === "player" ? " qw-bubble-player" : ""}${spec.pin ? " qw-bubble-pinned" : ""}`}
      data-bubble={spec.id}
      ref={ref}
      aria-hidden="true"
    >
      {spec.title && <b>{spec.title}</b>}
      {spec.text}
    </div>
  );
});

/** Маяк «!» над целью; за кадром превращается в стрелку у края экрана. */
const GoalPointer = memo(function GoalPointer({ layer, label }: { layer: OverlayLayer; label: string }) {
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      layer.register("pointer", el);
    },
    [layer]
  );
  return (
    <div
      className="qw-pointer"
      data-pointer="goal"
      data-edge="false"
      ref={ref}
      aria-hidden="true"
      title={label}
    >
      <span className="qw-pointer-beacon">!</span>
      <span className="qw-pointer-arrow" />
    </div>
  );
});

type Props = { layer: OverlayLayer; bubbles: ReadonlyArray<BubbleSpec>; pointerLabel: string | null; children?: ReactNode };

export const ScreenOverlay = memo(function ScreenOverlay({ layer, bubbles, pointerLabel, children }: Props) {
  useEffect(() => () => layer.dispose(), [layer]);
  return (
    <>
      {bubbles.map((spec) => (
        <Bubble key={spec.id} layer={layer} spec={spec} />
      ))}
      {pointerLabel && <GoalPointer layer={layer} label={pointerLabel} />}
      {children}
    </>
  );
});
