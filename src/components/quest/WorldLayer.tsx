"use client";

import Image from "next/image";
import { memo, useEffect, useState, type CSSProperties } from "react";

import { Lights, Snow } from "@/components/game/ambient";
import type { Mood } from "@/components/game/characters";
import { useWorld, useWorldModel } from "@/components/play/world-context";
import type { Point } from "@/components/quest/pathfinding";
import type { PlayerPose } from "@/components/quest/sim";
import { FlakeBonus, HeroSprite, PlayerSprite, RobotSprite, ToyBall, type HeroMarker, type RobotPose, type SpriteFacing } from "@/components/quest/sprites";
import type { PublicHero } from "@/types/api";
import type { Spot } from "@/worlds/model";

export type WorldHeroView = { roomId: string; hero: PublicHero; mood: Mood; marker: HeroMarker };

export type WorldLayerProps = {
  rooms: ReadonlyArray<{ id: string; color: string }>;
  heroes: ReadonlyArray<WorldHeroView>;
  lit: ReadonlySet<string>;
  /** Комната, которая светится ярче: герой рядом или идёт праздник. */
  active: string | null;
  /** Игрушки на ёлке: комната → цвет. */
  landed: ReadonlyMap<string, string>;
  collected: ReadonlySet<string>;
  /** Искорки на пути к цели: подсвечены и ведут игрока. */
  lead: ReadonlySet<string>;
  progress: number;
  trail: ReadonlyArray<Point> | null;
  target: Point | null;
  door: Point | null;
  /** Рывок: герои сбежались к ёлке. */
  gather: boolean;
  /** Нарисованный на иллюстрации робот закрыт: он улетел и стал компаньоном. */
  robotGone: boolean;
  playerVisible: boolean;
  pose: PlayerPose;
  facing: SpriteFacing;
  robotPose: RobotPose;
  /** Герой пролога у входа. */
  prologueHero: PublicHero | null;
  /** Искорки на ёлке (финал). */
  treeFlakes: number;
  /** Ключ «встряхивания шара»: меняется при каждом трюке. */
  snowBurst: number;
  /** Комната → ключ последней ошибки: свет мигает, предохранитель искрит. */
  faults: Readonly<Record<string, number>>;
  /** Свет горит везде (финал). */
  allLit: boolean;
  /** Ссылки на элементы игрока и робота: цикл мира двигает их напрямую, без перерисовки React. */
  onPlayerEl: (el: HTMLDivElement | null) => void;
  onRobotEl: (el: HTMLDivElement | null) => void;
};

const GATHER_RUN_MS = 1500;

function HeroActor({ view, spot, gather, fault }: { view: WorldHeroView; spot: Spot; gather: boolean; fault: number | undefined }) {
  const [running, setRunning] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- герой бежит к ёлке на время перехода
    setRunning(true);
    const timer = window.setTimeout(() => setRunning(false), GATHER_RUN_MS);
    return () => window.clearTimeout(timer);
  }, [gather]);
  const at = gather ? spot.rushPos : spot.heroPos;
  const dx = at.x - spot.heroPos.x;
  const dy = at.y - spot.heroPos.y;
  const facing: SpriteFacing = gather ? (dx === 0 ? 1 : spot.heroPos.x > at.x ? -1 : 1) : spot.hero.face === "left" ? -1 : 1;
  return (
    <div
      className="qw-hero"
      data-room={spot.roomId}
      data-gather={gather ? "true" : "false"}
      data-fault={fault ?? ""}
      style={{ left: spot.heroPos.x, top: spot.heroPos.y, zIndex: Math.round(at.y), "--gx": `${dx}px`, "--gy": `${dy}px` } as CSSProperties}
    >
      <div className="qw-hero-move">
        <div className="qw-sprite">
          <HeroSprite hero={view.hero} mood={view.mood} pose={running && (dx !== 0 || dy !== 0) ? "run" : "idle"} facing={facing} marker={gather ? null : view.marker} />
        </div>
      </div>
    </div>
  );
}

/** Мир: иллюстрация шара, комнаты, герои, искорки, ёлка. Перерисовывается только при смене состояния игры, не каждый кадр. */
export const WorldLayer = memo(function WorldLayer(props: WorldLayerProps) {
  const {
    rooms, heroes, lit, active, landed, collected, lead, progress, trail, target, door, gather, robotGone, playerVisible, pose, facing, robotPose,
    treeFlakes, snowBurst, faults, allLit, prologueHero, onPlayerEl, onRobotEl
  } = props;
  const world = useWorld();
  const { BONUSES, ROBOT_HOME_POS, SPOTS, STAR_POS, START_POS, TREE_POS, WORLD_H, WORLD_W, treeSlot } = useWorldModel();
  const trailPoints = trail?.map((p) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(" ");
  return (
    <>
      <Image className="qw-img" src={world.art.src} alt="" width={WORLD_W} height={WORLD_H} sizes={`${WORLD_W}px`} priority draggable={false} />
      <div
        className="qw-robot-patch"
        data-on={robotGone ? "true" : "false"}
        style={{ left: ROBOT_HOME_POS.x - 105, top: ROBOT_HOME_POS.y - 90, width: 210, height: 190 }}
        aria-hidden="true"
      />
      <div className="qw-dim" style={{ opacity: allLit ? 0 : 0.22 * (1 - progress) }} aria-hidden="true" />
      {SPOTS.map((spot) => {
        const room = rooms.find((candidate) => candidate.id === spot.roomId);
        const isLit = lit.has(spot.roomId) || allLit;
        return (
          <div
            key={spot.roomId}
            className={`qw-room${isLit ? " is-lit" : ""}${active === spot.roomId ? " is-active" : ""}${faults[spot.roomId] ? " is-fault" : ""}`}
            data-room={spot.roomId}
            data-lit={isLit ? "true" : "false"}
            data-fault={faults[spot.roomId] ?? ""}
            style={{ left: `${spot.box.x}%`, top: `${spot.box.y}%`, width: `${spot.box.w}%`, height: `${spot.box.h}%`, "--rc": room?.color ?? "var(--gold-soft)" } as CSSProperties}
            aria-hidden="true"
          />
        );
      })}
      <Lights set={world.lights} progress={allLit ? 1 : Math.max(0.15, progress)} wave={allLit} halo={world.lights.halo} />
      <div className="globe-snow" aria-hidden="true">
        <Snow count={56} className="dense" />
      </div>
      {snowBurst > 0 && (
        <div key={snowBurst} className="globe-snow qw-snow-burst" aria-hidden="true">
          <Snow count={90} className="dense" />
        </div>
      )}
      {trailPoints && (
        <svg className="qw-trail" width={WORLD_W} height={WORLD_H} viewBox={`0 0 ${WORLD_W} ${WORLD_H}`} aria-hidden="true">
          <polyline points={trailPoints} />
        </svg>
      )}
      {door && trail && <span className="qw-door" style={{ left: door.x, top: door.y }} aria-hidden="true" />}
      {BONUSES.map((bonus) => (
        <span
          key={bonus.id}
          className={`qw-bonus${collected.has(bonus.id) ? " got" : ""}${lead.has(bonus.id) && !collected.has(bonus.id) ? " lead" : ""}`}
          style={{ left: bonus.x, top: bonus.y }}
          aria-hidden="true"
        >
          <FlakeBonus />
        </span>
      ))}
      {target && <span className="qw-target" style={{ left: target.x, top: target.y }} aria-hidden="true" />}
      {heroes.map((view) => {
        const spot = SPOTS.find((candidate) => candidate.roomId === view.roomId)!;
        return <HeroActor key={view.roomId} view={view} spot={spot} gather={gather} fault={faults[view.roomId]} />;
      })}
      {[...landed].map(([roomId, color]) => {
        const index = rooms.findIndex((room) => room.id === roomId);
        const at = treeSlot(index);
        return (
          <span key={`toy-${roomId}`} className="qw-toy" data-toy={roomId} style={{ left: at.x, top: at.y }}>
            <ToyBall color={color} />
          </span>
        );
      })}
      {Array.from({ length: treeFlakes }, (_, index) => {
        // Искорки, собранные в пути, садятся на ёлку по спирали.
        const turn = index * 2.4;
        const radius = 18 + (index % 5) * 9;
        return (
          <span
            key={`tf-${index}`}
            className="qw-tree-flake"
            style={{ left: STAR_POS.x + Math.sin(turn) * radius, top: TREE_POS.y - 150 + ((index * 17) % 120) + Math.cos(turn) * 6 }}
            aria-hidden="true"
          >
            <FlakeBonus />
          </span>
        );
      })}
      {prologueHero && (
        <div className="qw-hero qw-hero-prologue" style={{ left: START_POS.x + 84, top: START_POS.y + 4, zIndex: Math.round(START_POS.y) + 1 }}>
          <div className="qw-sprite">
            <HeroSprite hero={prologueHero} mood="happy" pose="wave" facing={-1} marker={null} />
          </div>
        </div>
      )}
      <div className="qw-player" ref={onPlayerEl} hidden={!playerVisible}>
        <div className="qw-sprite">
          <PlayerSprite pose={pose} facing={facing} />
        </div>
      </div>
      <div className="qw-robot" ref={onRobotEl}>
        <div className="qw-robot-bob">
          <RobotSprite pose={robotPose} facing={1} />
        </div>
      </div>
      <div className="qw-vignette" aria-hidden="true" />
    </>
  );
});
