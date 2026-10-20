"use client";

import { useState } from "react";

import { useSkin } from "@/components/advent/storefront/skins/context";
import { Icon } from "@/components/game/icons";
import { useDigitKeys, useSubmitLock } from "@/components/game/hooks";
import type { TaskViewProps } from "@/components/game/room-ui";
import type { PublicTask } from "@/types/api";

/** Силуэты предметов на прилавке: каждый вариант получает свой, поэтому ряд не читается как одинаковые карточки. */
export const PICK_SHAPES = ["jar", "bottle", "box", "bag", "plate"] as const;
export type PickShape = (typeof PICK_SHAPES)[number];

/** Силуэт по номеру варианта в показанном порядке: соседние варианты никогда не совпадают по форме. */
export function pickShape(index: number): PickShape {
  return PICK_SHAPES[index % PICK_SHAPES.length];
}

/**
 * Обложка «pick»: варианты — предметы на прилавке разной формы, а не одинаковые карточки. Нажатие выбирает предмет и отправляет ответ.
 * Порядок предметов — тот, что отдал сервер (перемешан по зерну), ответ от формы не зависит.
 */
export function StorefrontPick({ task, reveal, disabled, onSubmit, after }: TaskViewProps<Extract<PublicTask, { type: "pick" }>>) {
  const { copy } = useSkin();
  const [chosen, setChosen] = useState<string | null>(null);
  const { locked, lock } = useSubmitLock(disabled, reveal !== null);

  function pick(id: string) {
    if (!lock()) return;
    setChosen(id);
    onSubmit({ optionId: id });
  }

  useDigitKeys(!locked, task.options.length, (index) => pick(task.options[index].id));

  const answered = reveal && "optionId" in reveal.payload ? reveal.payload.optionId : chosen;

  return (
    <section className="adv-skin adv-skin-pick" aria-label={copy.skinPickTitle}>
      <div className="adv-skin-top">
        <h3 className="adv-skin-title">{copy.skinPickTitle}</h3>
        {!reveal && <p className="adv-skin-count">{copy.skinPickHint}</p>}
      </div>
      <ul className="adv-counter" aria-label={copy.skinPickTitle}>
        {task.options.map((option, index) => {
          const verdict = reveal && answered === option.id ? (reveal.correctIds.includes(option.id) ? "right" : "wrong") : reveal && reveal.correctIds.includes(option.id) ? "right" : null;
          return (
            <li key={option.id} className="adv-prop-slot" data-shape={pickShape(index)}>
              <button
                type="button"
                className="adv-prop"
                data-shape={pickShape(index)}
                data-chosen={answered === option.id || undefined}
                data-verdict={verdict ?? undefined}
                disabled={locked}
                aria-label={option.title}
                onClick={() => pick(option.id)}
              >
                <span className="adv-prop-lid" aria-hidden="true" />
                <span className="adv-prop-emblem" aria-hidden="true"><Icon name={option.icon} size={22} color="currentColor" /></span>
                <span className="adv-prop-title">{option.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="adv-shelf" aria-hidden="true" />
      <div className="adv-skin-after" aria-live="polite">{reveal ? after : null}</div>
    </section>
  );
}
