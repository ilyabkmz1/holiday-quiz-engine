import Image from "next/image";
import type { ReactNode } from "react";

import { HeroFace, RobotAvatar, type Mood } from "@/components/game/characters";
import { ArtOverlay, Lights, Snow } from "@/components/game/ambient";
import { CountUp } from "@/components/game/CountUp";
import { clock, points } from "@/components/game/format";
import { Icon } from "@/components/game/icons";
import { useWorld } from "@/components/play/world-context";
import type { PublicHero, PublicRoom, PublicTask, TaskPayloadBody, TaskReveal } from "@/types/api";
import { roomArt } from "@/worlds/model";

/**
 * `full` — сцена с иллюстрацией комнаты, героем и репликой (карточный режим).
 * `flat` — карточка задания в квесте: фон — сам мир, реплика героя звучит облачком в мире,
 * на карточке остаётся только механика (слоты, письма, переключатели).
 */
export type SceneVariant = "full" | "flat";

export type TaskViewProps<T extends PublicTask = PublicTask> = {
  task: T;
  hero: PublicHero;
  room: PublicRoom;
  /** Разбор после ответа; пока его нет, показываются элементы управления. */
  reveal: TaskReveal | null;
  /** Ответ отправляется. */
  disabled: boolean;
  onSubmit: (payload: TaskPayloadBody) => void;
  /** Панель разбора (кнопка «дальше», совет робота). */
  after: ReactNode;
  shake: boolean;
  sceneVariant?: SceneVariant;
};

export function moodOf(reveal: TaskReveal | null): Mood {
  return reveal ? reveal.mood : "neutral";
}

export function Hud({
  roomTitle,
  taskNumber,
  total,
  fuses,
  fusesTotal,
  combo,
  timeLeft,
  hotBelow,
  score
}: {
  roomTitle: string;
  taskNumber: number;
  total: number;
  fuses: number;
  fusesTotal: number;
  combo: number;
  /** Секунд до «полуночи» (только показ); null — таймер не нужен. */
  timeLeft: number | null;
  hotBelow: number;
  score: number;
}) {
  return (
    <div className="hud">
      <div className="hud-left">
        <div className="eyebrow">
          {roomTitle} · заявка {taskNumber} из {total}
        </div>
        <div className="fuses" role="img" aria-label={`Предохранителей осталось: ${fuses} из ${fusesTotal}`}>
          {Array.from({ length: fusesTotal }, (_, index) => (
            <span key={index} className={index < fuses ? "fuse" : "fuse out"} />
          ))}
        </div>
      </div>
      <div className="hud-right">
        {combo >= 2 && (
          <div className="pill pill-combo pop">
            <span className="sr-only">Комбо {combo}</span>
            <span aria-hidden="true">×{combo}</span>
          </div>
        )}
        {timeLeft !== null && (
          <div
            className={timeLeft <= hotBelow ? "pill pill-hot" : "pill"}
            role="timer"
            aria-label={`До полуночи ${clock(timeLeft)}`}
          >
            <Icon name="clock" size={14} strokeWidth={2.2} />
            <span aria-hidden="true">{clock(timeLeft)}</span>
          </div>
        )}
        <div className="pill pill-score">
          <span className="bump-ring" key={score} aria-hidden="true" />
          <span className="sr-only">Очков: {score}</span>
          <span className="gold" aria-hidden="true"><CountUp value={score} format={points} duration={900} /></span>
        </div>
      </div>
    </div>
  );
}

type SceneProps = {
  room: PublicRoom;
  hero: PublicHero;
  text: string;
  mood: Mood;
  shake: boolean;
  /** `stage` — крупный герой внизу сцены; `compact` — герой рядом с репликой. */
  variant: "stage" | "compact";
  bright?: boolean;
  sceneVariant?: SceneVariant;
  children?: ReactNode;
};

export function Scene({ room, hero, text, mood, shake, variant, bright = false, sceneVariant = "full", children }: SceneProps) {
  const art = roomArt(useWorld(), room);
  const flat = sceneVariant === "flat";
  if (flat) {
    // Без слотов в сцене нечего показывать: реплика героя звучит в мире.
    if (!children) return null;
    return (
      <section className={`scene scene-${variant} scene-flat${shake ? " shake" : ""}`} aria-label={`Комната «${room.title}»`}>
        <div className="scene-body">{children}</div>
      </section>
    );
  }
  return (
    <section className={`scene scene-${variant}${shake ? " shake" : ""}`} aria-label={`Комната «${room.title}»`}>
      {(
        <>
          <Image
            className={bright ? "scene-img bright" : "scene-img"}
            src={art.src}
            alt=""
            fill
            sizes="(max-width: 900px) 100vw, 60vw"
            priority
          />
          <div className="scene-shade" />
          {art.lights && (
            <ArtOverlay>
              <Lights set={art.lights} progress={bright ? 1 : 0.6} />
            </ArtOverlay>
          )}
          <Snow count={variant === "stage" ? 18 : 12} className="scene-snow" />
        </>
      )}
      <div className="scene-body">
        {variant === "stage" ? (
          <>
            <div className="bubble rise">
              {text}
            </div>
            <div className="who">
              <div className="bob">
                <HeroFace hero={hero} mood={mood} size={92} />
              </div>
              <div className="who-chip">
                <b>{hero.name}</b> · {hero.role}
              </div>
            </div>
          </>
        ) : (
          <div className="talk">
            <div className="bob talk-face">
              <HeroFace hero={hero} mood={mood} size={56} />
            </div>
            <div className="bubble bubble-side rise">
              <b>
                {hero.name}, {hero.role}:
              </b>{" "}
              {text}
            </div>
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

/** Нижняя панель с инструментами. Пока нет разбора, видны `children`; разбор приходит в `after`. */
export function Hand({
  reveal,
  after,
  children
}: {
  reveal: TaskReveal | null;
  after: ReactNode;
  children: ReactNode;
}) {
  return (
    <aside className="hand" aria-label="Ваши инструменты">
      {!reveal && children}
      <div className="hand-live" aria-live="polite">
        {reveal ? after : null}
      </div>
    </aside>
  );
}

export function RobotHint({ children, title = "Робот-помощник" }: { children: ReactNode; title?: string }) {
  return (
    <div className="robot-hint">
      <RobotAvatar size={38} label="" />
      <div>
        <div className="robot-hint-title">{title}</div>
        <div className="robot-hint-text">{children}</div>
      </div>
    </div>
  );
}
