"use client";

import { useState } from "react";

import { Icon } from "@/components/game/icons";
import { useSubmitLock } from "@/components/game/hooks";
import { Hand, Scene, moodOf, type TaskViewProps } from "@/components/game/room-ui";
import type { PublicTask } from "@/types/api";

type Props = TaskViewProps<Extract<PublicTask, { type: "access" }>>;

/** Переключатели доступа: включить нужные, не включить лишние. */
export function AccessTask({ task, hero, room, reveal, disabled, onSubmit, after, shake, sceneVariant }: Props) {
  const [enabled, setEnabled] = useState<string[]>([]);
  const { locked, lock } = useSubmitLock(disabled, reveal !== null);

  function toggle(id: string) {
    if (locked) return;
    setEnabled((current) => (current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]));
  }

  function submit() {
    if (!lock()) return;
    // Порядок как в задании, чтобы тело ответа не зависело от порядка нажатий.
    onSubmit({ enabledIds: task.switches.filter((item) => enabled.includes(item.id)).map((item) => item.id) });
  }

  return (
    <>
      <Scene room={room} hero={hero} text={reveal ? reveal.line : task.say} mood={moodOf(reveal)} shake={shake} variant="compact" bright={reveal?.outcome === "perfect"} sceneVariant={sceneVariant} />
      <Hand reveal={reveal} after={after}>
        <div className="hand-head">
          <span>Настройки доступа</span>
          <span>Включено: {enabled.length}</span>
        </div>
        <div className="switch-list" role="group" aria-label="Настройки доступа">
          {task.switches.map((item) => {
            const on = enabled.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                role="switch"
                aria-checked={on}
                className={on ? "switch-row on" : "switch-row"}
                disabled={locked}
                onClick={() => toggle(item.id)}
              >
                <span className="card-ic">
                  <Icon name={item.icon} size={18} color="var(--cyan)" strokeWidth={2} />
                </span>
                <span className="switch-title">{item.title}</span>
                <span className="sw" aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <div className="grow" />
        <button type="button" className="btn btn-primary" disabled={locked} onClick={submit}>
          Применить настройки
        </button>
      </Hand>
    </>
  );
}
