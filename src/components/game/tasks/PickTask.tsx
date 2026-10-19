"use client";

import { useState } from "react";

import { Icon } from "@/components/game/icons";
import { useDigitKeys, useSubmitLock } from "@/components/game/hooks";
import { Hand, Scene, moodOf, type TaskViewProps } from "@/components/game/room-ui";
import type { PublicTask } from "@/types/api";

type Props = TaskViewProps<Extract<PublicTask, { type: "pick" }>>;

/** Тап по одной карточке: карточка «улетает», ответ уходит на сервер. */
export function PickTask({ task, hero, room, reveal, disabled, onSubmit, after, shake, sceneVariant }: Props) {
  const [chosen, setChosen] = useState<string | null>(null);
  const { locked, lock } = useSubmitLock(disabled, reveal !== null);

  function pick(id: string) {
    if (!lock()) return;
    setChosen(id);
    onSubmit({ optionId: id });
  }

  useDigitKeys(!locked, task.options.length, (index) => pick(task.options[index].id));

  return (
    <>
      <Scene room={room} hero={hero} text={reveal ? reveal.line : task.say} mood={moodOf(reveal)} shake={shake} variant="stage" bright={reveal?.outcome === "perfect"} sceneVariant={sceneVariant} />
      <Hand reveal={reveal} after={after}>
        <div className="hand-head">
          <span>Отдайте нужную карточку</span>
          <span className="kbd-hint">Нажмите 1–{task.options.length}</span>
        </div>
        <div className="cards" role="group" aria-label="Варианты ответа">
          {task.options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              className={chosen === option.id ? "card fly" : "card"}
              disabled={locked}
              onClick={() => pick(option.id)}
            >
              <span className="card-ic">
                <Icon name={option.icon} size={20} color="var(--cyan)" />
              </span>
              <span className="card-title">{option.title}</span>
              <span className="card-key" aria-hidden="true">{index + 1}</span>
            </button>
          ))}
        </div>
      </Hand>
    </>
  );
}
