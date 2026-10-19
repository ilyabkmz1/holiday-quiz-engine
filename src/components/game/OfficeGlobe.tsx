import Image from "next/image";

import { Lights, Snow } from "@/components/game/ambient";
import { useWorld } from "@/components/play/world-context";
import type { PublicRoom } from "@/types/api";

export type RoomState = "locked" | "open" | "progress" | "done";

/** Название продукта комнаты из подписи «Комната 1 · Почта». */
export function productName(room: PublicRoom): string {
  return room.eyebrow.split("·").pop()?.trim() ?? room.title;
}

type Props = {
  rooms: PublicRoom[];
  states: Record<string, RoomState>;
  /** Яркость иллюстрации 0..1+ — растёт вместе с прогрессом. */
  brightness: number;
  /** Доля пройденных комнат 0..1: чем больше, тем ярче ёлка и гирлянда. */
  progress?: number;
  alt: string;
  variant: "map" | "final" | "landing";
  onOpen?: (room: PublicRoom) => void;
  priority?: boolean;
};

/** Снежный шар с пятью комнатами. На карте комнаты — кнопки, в финале — только свечение. */
export function OfficeGlobe({ rooms, states, brightness, progress = 0, alt, variant, onOpen, priority = false }: Props) {
  const world = useWorld();
  return (
    <div className={`globe globe-${variant}`}>
      <div className="globe-inner">
        <Image
          className="globe-img"
          src={world.art.src}
          alt={alt}
          width={world.art.width}
          height={world.art.height}
          sizes="(max-width: 900px) 720px, 1140px"
          priority={priority}
          style={{ filter: `brightness(${brightness}) saturate(${0.55 + Math.min(brightness, 1) * 0.5})` }}
        />
        <Lights set={world.lights} progress={progress} wave={variant === "final"} halo={world.lights.halo} />
        <div className="globe-snow" aria-hidden="true">
          <Snow count={variant === "final" ? 22 : 16} className={variant === "final" ? "dense" : ""} />
        </div>
        {variant !== "landing" &&
          rooms.map((room) => {
            const state = states[room.id] ?? "locked";
            const glow = state === "done";
            const product = productName(room);
            const label = {
              done: `${room.title} (${product}): свет включён`,
              progress: `Продолжить комнату «${room.title}» (${product})`,
              open: `Открыть комнату «${room.title}» (${product})`,
              locked: `${room.title} (${product})`
            }[state];
            return (
              <div key={room.id}>
                <span className="glow" style={{ left: `${room.map.x}%`, top: `${room.map.y}%`, opacity: glow ? 1 : 0 }} aria-hidden="true" />
                {variant === "map" ? (
                  <button
                    type="button"
                    className={`hot ${state}`}
                    style={{ left: `${room.map.x}%`, top: `${room.map.y}%` }}
                    aria-label={label}
                    onClick={() => onOpen?.(room)}
                  />
                ) : (
                  <span className={`node ${glow ? "lit" : ""}`} style={{ left: `${room.map.x}%`, top: `${room.map.y}%` }} aria-hidden="true" />
                )}
                {variant === "map" && (
                  <span
                    className="tag"
                    style={{ left: `${room.map.x}%`, top: `calc(${room.map.y}% + 34px)`, color: glow ? "#FFE29A" : state === "locked" ? "#9FB0D6" : "#62E0FF" }}
                    aria-hidden="true"
                  >
                    {room.title}
                  </span>
                )}
              </div>
            );
          })}
      </div>
      <div className="globe-fade" />
    </div>
  );
}
