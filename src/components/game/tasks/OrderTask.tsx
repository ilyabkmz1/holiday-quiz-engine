"use client";

import { useState } from "react";

import { Icon } from "@/components/game/icons";
import { useDigitKeys, useSubmitLock } from "@/components/game/hooks";
import { Hand, Scene, moodOf, type TaskViewProps } from "@/components/game/room-ui";
import type { PublicTask } from "@/types/api";

type Props = TaskViewProps<Extract<PublicTask, { type: "order" }>>;

/**
 * Расстановка порядка: тап по карточке ставит её на следующую позицию 1..N, повторный тап по
 * поставленной снимает её, «Сбросить» очищает ряд. Backspace снимает последнюю карточку.
 */
export function OrderTask({ task, hero, room, reveal, disabled, onSubmit, after, shake, sceneVariant }: Props) {
  const [order, setOrder] = useState<string[]>([]);
  const { locked, lock } = useSubmitLock(disabled, reveal !== null);

  const shown = reveal && "orderedIds" in reveal.payload ? reveal.payload.orderedIds : order;
  const byId = (id: string) => task.items.find((item) => item.id === id);

  function toggle(id: string) {
    if (locked) return;
    setOrder((current) => (current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]));
  }

  function submit() {
    if (order.length !== task.items.length || !lock()) return;
    onSubmit({ orderedIds: order });
  }

  useDigitKeys(!locked, task.items.length, (index) => toggle(task.items[index].id));

  const missing = task.items.length - order.length;

  return (
    <>
      <Scene room={room} hero={hero} text={reveal ? reveal.line : task.say} mood={moodOf(reveal)} shake={shake} variant="compact" bright={reveal?.outcome === "perfect"} sceneVariant={sceneVariant}>
        <div className="slots-wrap">
          <div className="slots-title">Порядок · {shown.length} из {task.items.length}</div>
          <ol
            className="slots order-slots"
            aria-label={`Выбранный порядок: ${shown.length} из ${task.items.length}`}
            style={{ gridTemplateColumns: `repeat(${task.items.length}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: task.items.length }, (_, index) => {
              const card = shown[index] ? byId(shown[index]) : undefined;
              const verdict = reveal && card ? (reveal.correctIds[index] === card.id ? " right" : " wrong") : "";
              return (
                <li key={index}>
                  <button
                    type="button"
                    className={`slot${card ? " filled" : ""}${verdict}`}
                    disabled={locked || !card}
                    aria-label={card ? `Позиция ${index + 1}: «${card.title}». Убрать` : `Позиция ${index + 1}: пусто`}
                    onClick={() => card && toggle(card.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Backspace" || event.key === "Delete") {
                        event.preventDefault();
                        if (card) toggle(card.id);
                      }
                    }}
                  >
                    <span className="slot-num" aria-hidden="true">{index + 1}</span>
                    {card ? <span>{card.title}</span> : <span aria-hidden="true">+</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </Scene>
      <Hand reveal={reveal} after={after}>
        <div className="hand-head">
          <span>Расставьте шаги по порядку</span>
          <span className="kbd-hint">Нажмите 1–{task.items.length}</span>
        </div>
        <div className="cards" role="group" aria-label="Шаги">
          {task.items.map((item, index) => {
            const position = order.indexOf(item.id);
            return (
              <button
                key={item.id}
                type="button"
                className={position >= 0 ? "card used" : "card"}
                aria-pressed={position >= 0}
                aria-label={position >= 0 ? `${item.title}, позиция ${position + 1}. Нажмите, чтобы снять` : item.title}
                disabled={locked}
                onClick={() => toggle(item.id)}
              >
                <span className="card-ic">
                  <Icon name={item.icon} size={20} color="var(--cyan)" />
                </span>
                <span className="card-title">{item.title}</span>
                {position >= 0 ? <span className="card-badge" aria-hidden="true">{position + 1}</span> : <span className="card-key" aria-hidden="true">{index + 1}</span>}
              </button>
            );
          })}
        </div>
        <div className="grow" />
        <div className="btn-row">
          <button type="button" className="btn btn-ghost btn-narrow" disabled={locked || order.length === 0} onClick={() => setOrder([])}>
            Сбросить
          </button>
          <button type="button" className="btn btn-primary" disabled={locked || missing > 0} onClick={submit}>
            {missing > 0 ? `Подтвердить — нужно ещё: ${missing}` : "Подтвердить порядок"}
          </button>
        </div>
      </Hand>
    </>
  );
}
