"use client";

import { useWorld } from "@/components/play/world-context";
import type { PublicHero } from "@/types/api";

export type Mood = "happy" | "neutral" | "sad";

const MOUTH: Record<Mood, string> = {
  neutral: "M9 15.5h6",
  happy: "M8.4 14.4q3.6 3.4 7.2 0",
  sad: "M8.4 16.6q3.6-3 7.2 0"
};

export const MOOD_TEXT: Record<Mood, string> = {
  neutral: "ожидание",
  happy: "радость",
  sad: "огорчение"
};

/** Плейсхолдер-аватар: цветной круг с лицом. Пока нет иллюстраций героев. */
export function HeroFace({ hero, mood = "neutral", size = 92 }: { hero: PublicHero; mood?: Mood; size?: number }) {
  return (
    <svg
      role="img"
      aria-label={`${hero.name}, ${hero.role}. Настроение: ${MOOD_TEXT[mood]}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`hero-face mood-${mood}`}
    >
      <circle cx="12" cy="12" r="11.5" fill={hero.color} />
      <circle className="eye" cx="8.6" cy="10.2" r="1.25" fill="#0B1836" />
      <circle className="eye" cx="15.4" cy="10.2" r="1.25" fill="#0B1836" />
      <path d={MOUTH[mood]} stroke="#0B1836" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Робот-помощник: кроп иллюстрации мира (`world.art`, `world.robotCrop`). */
export function RobotAvatar({ size = 56, label = "Робот-помощник" }: { size?: number; label?: string }) {
  const { art, robotCrop } = useWorld();
  return (
    <span
      className="robot-avatar"
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      style={{ width: size, height: size, backgroundImage: `url("${art.src}")`, backgroundSize: `${(size * robotCrop.width) / 56}px auto`, backgroundPosition: `${-size * robotCrop.x}px ${-size * robotCrop.y}px` }}
    />
  );
}
