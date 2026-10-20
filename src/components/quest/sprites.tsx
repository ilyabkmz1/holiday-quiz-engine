import { createContext, useContext, useId, type ComponentType } from "react";

import { RobotAvatar } from "@/components/game/characters";
import type { PlayerPose } from "@/components/quest/sim";

import type { Mood } from "@/components/game/characters";
import { MOOD_TEXT } from "@/components/game/characters";
import type { HeroLook } from "@/config/schema";
import type { PublicHero } from "@/types/api";

/**
 * Фигурки мира: SVG в стиле мягкой иллюстрации (градиенты, блики, большая голова).
 * Размер viewBox 40×64, «ноги» стоят на нижней кромке (y = 62), тень — под ними.
 * Анимация — CSS-классами на корневом <svg> (см. quest.css), только transform.
 */

export type { PlayerPose } from "@/components/quest/sim";

/** Куда смотрит персонаж: 1 — вправо, -1 — влево. */
export type SpriteFacing = 1 | -1;
export type HeroPose = "idle" | "wave" | "run" | "cheer";
export type HeroMarker = "alert" | "lock" | null;
export type RobotPose = "hover" | "fly";

/**
 * Слой «спрайт»: механика мира знает только эти интерфейсы (поза, направление, настроение).
 * Нарисованные PNG/SVG-спрайты подставляются через `SpriteSetContext` без изменений механики.
 */
export type PlayerSpriteProps = { pose: PlayerPose; facing: SpriteFacing };
export type HeroSpriteProps = { hero: PublicHero; mood: Mood; pose: HeroPose; facing: SpriteFacing; marker: HeroMarker };
export type RobotSpriteProps = { pose: RobotPose; facing: SpriteFacing };
export type SpriteSet = {
  player: ComponentType<PlayerSpriteProps>;
  hero: ComponentType<HeroSpriteProps>;
  robot: ComponentType<RobotSpriteProps>;
};

const MOUTH: Record<Mood, string> = {
  neutral: "M17 20.6h6",
  happy: "M16.2 19.6q3.8 3.8 7.6 0",
  sad: "M16.4 22q3.6-3 7.2 0"
};

const SKIN = ["#ffd9b8", "#f1c19a", "#e0a97f", "#c98f66"] as const;

function Face({ mood, hatless }: { mood: Mood; hatless?: boolean }) {
  return (
    <g className="qs-face">
      <circle cx="20" cy="17" r="9.6" fill="var(--skin, #ffd9b8)" />
      <ellipse cx="14.2" cy="19.4" rx="1.9" ry="1.2" fill="#ff9aa2" opacity="0.5" />
      <ellipse cx="25.8" cy="19.4" rx="1.9" ry="1.2" fill="#ff9aa2" opacity="0.5" />
      <circle className="qs-eye" cx="16.6" cy="16.6" r="1.25" fill="#0b1836" />
      <circle className="qs-eye" cx="23.4" cy="16.6" r="1.25" fill="#0b1836" />
      <path d={MOUTH[mood]} stroke="#0b1836" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      {hatless && <ellipse cx="16" cy="11.2" rx="4.2" ry="2.2" fill="#fff" opacity="0.28" />}
    </g>
  );
}

/** Игрок: Санта-шапка, шарф, синяя куртка. */
function PlayerSvg({ pose, facing }: PlayerSpriteProps) {
  const mirrored = facing === -1;
  const id = useId();
  const g = (name: string) => `${id}-${name}`;
  return (
    <svg
      className={`qs qs-player qs-${pose}`}
      viewBox="0 0 40 64"
      width="40"
      height="64"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={g("coat")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4d8dff" />
          <stop offset="1" stopColor="#1a4fc4" />
        </linearGradient>
        <linearGradient id={g("hat")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff6a63" />
          <stop offset="1" stopColor="#c3262f" />
        </linearGradient>
      </defs>
      <g transform={mirrored ? "translate(40 0) scale(-1 1)" : undefined}>
      <ellipse className="qs-shadow" cx="20" cy="61.6" rx="12" ry="3" fill="#00071f" opacity="0.38" />
      <g className="qs-bob">
        <g className="qs-leg qs-legL">
          <rect x="13" y="42" width="6" height="15" rx="3" fill="#24336b" />
          <rect x="11.6" y="55" width="8.6" height="6" rx="3" fill="#4a2f2a" />
        </g>
        <g className="qs-leg qs-legR">
          <rect x="21" y="42" width="6" height="15" rx="3" fill="#2c3d7e" />
          <rect x="19.8" y="55" width="8.6" height="6" rx="3" fill="#5a3a33" />
        </g>
        <g className="qs-arm qs-armL">
          <rect x="5.4" y="28" width="5.4" height="15" rx="2.7" fill="#2b66e0" />
          <circle cx="8.1" cy="43.4" r="2.9" fill="#fff" />
        </g>
        <rect x="10" y="26" width="20" height="20" rx="8" fill={`url(#${g("coat")})`} />
        <rect x="10" y="37.5" width="20" height="3" fill="#ffcb5c" opacity="0.95" />
        <rect x="18.2" y="26.5" width="3.6" height="19" rx="1.8" fill="#fff" opacity="0.28" />
        <g className="qs-arm qs-armR">
          <rect x="29.2" y="28" width="5.4" height="15" rx="2.7" fill="#2b66e0" />
          <circle cx="31.9" cy="43.4" r="2.9" fill="#fff" />
        </g>
        <g className="qs-head">
          <path d="M11.6 25.2q8.4 3.8 16.8 0l.6 3.2q-9 3.6-18 0z" fill="#e8f4ff" />
          <path d="M24.5 27.6q3 .8 3.4 6.4l-3.2-.4z" fill="#62e0ff" />
          <Face mood="happy" />
          <path d={`M10.2 14.2Q12 -0.2 25 1.6q4.4 3.6 4.8 12.6z`} fill={`url(#${g("hat")})`} />
          <rect x="9.2" y="11.4" width="21.6" height="5" rx="2.5" fill="#fff" />
          <circle cx="28" cy="2" r="3.2" fill="#fff" />
        </g>
      </g>
      </g>
    </svg>
  );
}

type Look = { color: string; skin: number; style: HeroLook["hair"] };

/** Набор внешностей героев: без `look` в пакете герой получает одну из них по устойчивому хешу id. */
const LOOKS: Look[] = [
  { color: "#7a4a2b", skin: 0, style: "bun" },
  { color: "#2b2f4a", skin: 1, style: "long" },
  { color: "#5a3d2b", skin: 0, style: "short" },
  { color: "#b5532f", skin: 0, style: "long" },
  { color: "#22262e", skin: 2, style: "short" },
  { color: "#3a3a3a", skin: 1, style: "cap" }
];

const HAIR_COLOR: Record<NonNullable<HeroLook["hairColor"]>, string> = {
  black: "#22262e",
  brown: "#5a3d2b",
  chestnut: "#7a4a2b",
  auburn: "#b5532f",
  blond: "#d9a94e",
  gray: "#9a9ca3"
};
const SKIN_INDEX: Record<NonNullable<HeroLook["skin"]>, number> = { light: 0, fair: 1, tan: 2, deep: 3 };

/** Внешность героя: явная из пакета (`hero.look`), иначе устойчиво по id. */
export function lookOf(hero: Pick<PublicHero, "id" | "look">): Look {
  let hash = 0;
  for (const char of hero.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const fallback = LOOKS[hash % LOOKS.length];
  const look = hero.look;
  if (!look) return fallback;
  return {
    style: look.hair,
    color: look.hairColor ? HAIR_COLOR[look.hairColor] : fallback.color,
    skin: look.skin ? SKIN_INDEX[look.skin] : fallback.skin
  };
}

/** Герой задания: стоит на месте, дышит; реагирует настроением. */
function HeroSvg({ hero, mood, pose, facing, marker }: HeroSpriteProps) {
  const mirrored = facing === -1;
  const id = useId();
  const look = lookOf(hero);
  const skin = SKIN[look.skin];
  const g = (name: string) => `${id}-${name}`;
  return (
    <svg
      className={`qs qs-hero qs-${pose === "run" ? "run" : "idle"} pose-${pose} mood-${mood}`}
      viewBox="0 0 40 64"
      width="40"
      height="64"
      role="img"
      aria-label={`${hero.name}, ${hero.role}. Настроение: ${MOOD_TEXT[mood]}`}
      style={{ "--skin": skin } as React.CSSProperties}
    >
      <defs>
        <linearGradient id={g("suit")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={hero.color} />
          <stop offset="1" stopColor={hero.color} stopOpacity="0.62" />
        </linearGradient>
      </defs>
      <g transform={mirrored ? "translate(40 0) scale(-1 1)" : undefined}>
      <ellipse className="qs-shadow" cx="20" cy="61.6" rx="12" ry="3" fill="#00071f" opacity="0.38" />
      <g className="qs-bob">
        {look.style === "long" && <rect x="9.6" y="10" width="20.8" height="22" rx="9" fill={look.color} />}
        <rect x="13" y="42" width="6" height="15" rx="3" fill="#2b3558" />
        <rect x="21" y="42" width="6" height="15" rx="3" fill="#323d63" />
        <rect x="11.6" y="55" width="8.6" height="6" rx="3" fill="#161c33" />
        <rect x="19.8" y="55" width="8.6" height="6" rx="3" fill="#161c33" />
        <rect x="5.4" y="28" width="5.4" height="15" rx="2.7" fill={hero.color} />
        <rect x="29.2" y="28" width="5.4" height="15" rx="2.7" fill={hero.color} />
        <rect x="10" y="26" width="20" height="20" rx="8" fill={`url(#${g("suit")})`} />
        <path d="M16.4 26.4L20 33l3.6-6.6" fill="#fff" opacity="0.85" />
        <circle cx="8.1" cy="43.4" r="2.8" fill={skin} />
        <circle cx="31.9" cy="43.4" r="2.8" fill={skin} />
        <g className="qs-head">
          <Face mood={mood} hatless />
          {look.style === "short" && <path d="M10.4 15.4Q10.6 6 20 6.2T29.6 15.4Q27 10.6 20 10.6T10.4 15.4z" fill={look.color} />}
          {look.style === "long" && <path d="M10.2 17Q9.6 6.4 20 6.4T29.8 17Q27.4 10.8 20 10.8T10.2 17z" fill={look.color} />}
          {look.style === "bun" && (
            <>
              <circle cx="20" cy="5.2" r="3.6" fill={look.color} />
              <path d="M10.4 15.4Q10.6 6.8 20 7T29.6 15.4Q27 10.8 20 10.8T10.4 15.4z" fill={look.color} />
            </>
          )}
          {look.style === "cap" && (
            <>
              <path d="M10.2 14.6Q11 5.4 20 5.6T29.8 14.6z" fill="#2b66e0" />
              <rect x="20" y="12.6" width="12.4" height="2.6" rx="1.3" fill="#1a4fc4" />
            </>
          )}
        </g>
      </g>
      </g>
      {marker === "alert" && (
        <g className="qs-marker">
          <circle cx="20" cy="-7" r="7.4" fill="#ffcb5c" stroke="#fff" strokeWidth="1.4" />
          <rect x="18.8" y="-12.2" width="2.4" height="6.4" rx="1.2" fill="#1b1300" />
          <circle cx="20" cy="-2.6" r="1.4" fill="#1b1300" />
        </g>
      )}
      {marker === "lock" && (
        <g className="qs-marker qs-marker-lock">
          <circle cx="20" cy="-7" r="7.4" fill="#243b78" stroke="#9fb0d6" strokeWidth="1.4" />
          <rect x="15.8" y="-7.4" width="8.4" height="6.2" rx="1.4" fill="#cfe0ff" />
          <path d="M17.6 -7.6v-1.8a2.4 2.4 0 014.8 0v1.8" fill="none" stroke="#cfe0ff" strokeWidth="1.5" />
        </g>
      )}
    </svg>
  );
}

/** Ёлочная игрушка: шарик цвета комнаты с бликом. */
export function ToyBall({ color, size = 22 }: { color: string; size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="qs-toy">
      <defs>
        <radialGradient id={id} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.35" stopColor={color} />
          <stop offset="1" stopColor={color} stopOpacity="0.7" />
        </radialGradient>
      </defs>
      <rect x="9.5" y="1" width="5" height="4" rx="1.4" fill="#ffe29a" />
      <circle cx="12" cy="14" r="9" fill={`url(#${id})`} />
      <ellipse cx="8.6" cy="10.4" rx="2.6" ry="1.6" fill="#fff" opacity="0.7" transform="rotate(-30 8.6 10.4)" />
    </svg>
  );
}

/** Искорка-бонус на дорожке. */
export function FlakeBonus() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g stroke="#e8f6ff" strokeWidth="2" strokeLinecap="round" fill="none">
        <path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7" />
        <path d="M9.4 3.8L12 6.4l2.6-2.6M9.4 20.2L12 17.6l2.6 2.6" strokeWidth="1.5" />
      </g>
      <circle cx="12" cy="12" r="2.2" fill="#fff" />
    </svg>
  );
}

function RobotSvg({ pose, facing }: RobotSpriteProps) {
  return (
    <span className={`qs-robot qs-robot-${pose}`} style={facing === -1 ? { transform: "scaleX(-1)" } : undefined}>
      <RobotAvatar size={44} label="" />
    </span>
  );
}

export const SVG_SPRITES: SpriteSet = { player: PlayerSvg, hero: HeroSvg, robot: RobotSvg };

export const SpriteSetContext = createContext<SpriteSet>(SVG_SPRITES);

export function PlayerSprite(props: PlayerSpriteProps) {
  const Sprite = useContext(SpriteSetContext).player;
  return <Sprite {...props} />;
}

export function HeroSprite(props: HeroSpriteProps) {
  const Sprite = useContext(SpriteSetContext).hero;
  return <Sprite {...props} />;
}

export function RobotSprite(props: RobotSpriteProps) {
  const Sprite = useContext(SpriteSetContext).robot;
  return <Sprite {...props} />;
}
