"use client";

import { useState } from "react";

import { Icon } from "@/components/game/icons";
import { useDigitKeys, useSubmitLock } from "@/components/game/hooks";
import { Hand, Scene, moodOf, type TaskViewProps } from "@/components/game/room-ui";
import type { PublicTask } from "@/types/api";

type Props = TaskViewProps<Extract<PublicTask, { type: "build" }>>;

/** Сборка сценария: карточки по очереди занимают слоты, слот снимает карточку, «Запустить» отправляет ответ. */
export function BuildTask({ task, hero, room, reveal, disabled, onSubmit, after, shake, sceneVariant }: Props) {
  const [picked, setPicked] = useState<string[]>([]);
  const { locked, lock } = useSubmitLock(disabled, reveal !== null);

  // После разбора слоты показывают ответ, принятый сервером.
  const shown = reveal && "optionIds" in reveal.payload ? reveal.payload.optionIds : picked;
  const byId = (id: string) => task.options.find((option) => option.id === id);

  function toggle(id: string) {
    if (locked) return;
    setPicked((current) => {
      if (current.includes(id)) return current.filter((candidate) => candidate !== id);
      return current.length < task.slots ? [...current, id] : current;
    });
  }

  function launch() {
    if (picked.length !== task.slots || !lock()) return;
    onSubmit({ optionIds: picked });
  }

  useDigitKeys(!locked, task.options.length, (index) => toggle(task.options[index].id));

  const missing = task.slots - picked.length;

  return (
    <>
      <Scene room={room} hero={hero} text={reveal ? reveal.line : task.say} mood={moodOf(reveal)} shake={shake} variant="compact" bright={reveal?.outcome === "perfect"} sceneVariant={sceneVariant}>
        <div className="slots-wrap">
          <div className="slots-title">Сценарий · {shown.length} из {task.slots}</div>
          <div className="slots" role="group" aria-label={`Сценарий: выбрано ${shown.length} из ${task.slots}`} style={{ gridTemplateColumns: `repeat(${task.slots}, minmax(0, 1fr))` }}>
            {Array.from({ length: task.slots }, (_, index) => {
              const card = shown[index] ? byId(shown[index]) : undefined;
              const verdict = reveal && card ? (reveal.correctIds.includes(card.id) ? " right" : " wrong") : "";
              return (
                <button
                  key={index}
                  type="button"
                  className={`slot${card ? " filled" : ""}${verdict}`}
                  disabled={locked || !card}
                  aria-label={card ? `Убрать «${card.title}» из сценария` : `Пустое место ${index + 1} из ${task.slots}`}
                  onClick={() => card && toggle(card.id)}
                >
                  {card ? (
                    <>
                      <Icon name={card.icon} size={18} color="var(--cyan)" />
                      <span>{card.title}</span>
                    </>
                  ) : (
                    <span aria-hidden="true">+</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </Scene>
      <Hand reveal={reveal} after={after}>
        <div className="hand-head">
          <span>Соберите {task.slots} карточки в сценарий</span>
          <span className="kbd-hint">Нажмите 1–{task.options.length}</span>
        </div>
        <div className="cards" role="group" aria-label="Карточки сценария">
          {task.options.map((option, index) => {
            const used = picked.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                className={used ? "card used" : "card"}
                aria-pressed={used}
                disabled={locked}
                onClick={() => toggle(option.id)}
              >
                <span className="card-ic">
                  <Icon name={option.icon} size={20} color="var(--cyan)" />
                </span>
                <span className="card-title">{option.title}</span>
                <span className="card-key" aria-hidden="true">{index + 1}</span>
              </button>
            );
          })}
        </div>
        <div className="grow" />
        <button type="button" className="btn btn-primary" disabled={locked || missing > 0} onClick={launch}>
          {missing > 0 ? `Запустить сценарий — нужно ещё: ${missing}` : "Запустить сценарий"}
        </button>
      </Hand>
    </>
  );
}
