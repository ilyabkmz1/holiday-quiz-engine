"use client";

import { useEffect, useRef, useState } from "react";

import { AdventIcon } from "@/components/advent/icons";
import { fill } from "@/components/advent/format";
import { useSkin } from "@/components/advent/storefront/skins/context";
import { LAYER_COLORS, Vessel, type VesselLayer } from "@/components/advent/storefront/skins/Vessel";
import { Icon } from "@/components/game/icons";
import { useDigitKeys, useSubmitLock } from "@/components/game/hooks";
import type { TaskViewProps } from "@/components/game/room-ui";
import type { PublicTask, TaskReveal } from "@/types/api";

type Entry = { id: string; title: string; icon: string };

type Props = {
  /** `build` отправляет `{ optionIds }`, `order` — `{ orderedIds }`; верные слои определяют по-разному. */
  mode: "build" | "order";
  entries: Entry[];
  slots: number;
  reveal: TaskReveal | null;
  disabled: boolean;
  after: TaskViewProps["after"];
  onSubmit: TaskViewProps["onSubmit"];
};

/**
 * Обложка «СОБЕРИ» для заданий `build` и `order`. Вид `vessel`: ёмкость (чашка со слоями и паром, коробка или стопка), слоты —
 * слои снизу вверх с легендой. Вид `list` (по умолчанию у `order`): список мест сверху вниз без рисунка — для абстрактных шагов.
 * Варианты — чипы (кнопки не ниже 44 px); выбранный чип уходит из списка в слот и возвращается по нажатию на слот.
 * Кнопка «Готово» закреплена внизу листа. Логика ответа — как у штатных механик.
 */
function LayerSkin({ mode, entries, slots, reveal, disabled, after, onSubmit }: Props) {
  const { copy, vessel, cover } = useSkin();
  const list = (cover ?? (mode === "order" ? "list" : "vessel")) === "list";
  const [picked, setPicked] = useState<string[]>([]);
  const { locked, lock } = useSubmitLock(disabled, reveal !== null);
  const chipsRef = useRef<HTMLUListElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  /** Куда вернуть фокус после того, как чип ушёл в слот или вернулся из него: место в списке чипов или id чипа. */
  const focusNext = useRef<{ index: number } | { id: string } | null>(null);

  const sent = reveal ? (mode === "build" ? ("optionIds" in reveal.payload ? reveal.payload.optionIds : picked) : "orderedIds" in reveal.payload ? reveal.payload.orderedIds : picked) : picked;
  const byId = (id: string) => entries.find((entry) => entry.id === id);
  const free = entries.filter((entry) => !picked.includes(entry.id));

  function toggle(id: string, from: "chip" | "slot" | "key") {
    if (locked) return;
    const index = free.findIndex((entry) => entry.id === id);
    if (picked.includes(id)) {
      focusNext.current = from === "slot" ? { id } : null;
      setPicked((current) => current.filter((candidate) => candidate !== id));
    } else if (picked.length < slots) {
      focusNext.current = from === "chip" ? { index } : null;
      setPicked((current) => (current.includes(id) || current.length >= slots ? current : [...current, id]));
    }
  }

  // Фокус не теряется, когда нажатая кнопка исчезает: следующий чип на том же месте, а когда все места заняты — «Готово».
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    const chips = Array.from(chipsRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    if ("id" in target) chips.find((chip) => chip.dataset.id === target.id)?.focus();
    else if (picked.length >= slots) submitRef.current?.focus();
    else (chips[Math.min(target.index, chips.length - 1)] ?? submitRef.current)?.focus();
  }, [picked, slots]);

  function submit() {
    if (picked.length !== slots || !lock()) return;
    onSubmit(mode === "build" ? { optionIds: picked } : { orderedIds: picked });
  }

  useDigitKeys(!locked, free.length, (index) => toggle(free[index].id, "key"));

  const verdictOf = (id: string, index: number): "right" | "wrong" | null => {
    if (!reveal) return null;
    return (mode === "build" ? reveal.correctIds.includes(id) : reveal.correctIds[index] === id) ? "right" : "wrong";
  };
  const layers: VesselLayer[] = Array.from({ length: slots }, (_, index) => {
    const id = sent[index];
    return { filled: id !== undefined, verdict: id !== undefined ? verdictOf(id, index) : null };
  });
  const missing = slots - picked.length;
  const count = list ? (mode === "order" ? copy.skinListSteps : copy.skinListPicked) : copy.skinBuildLayers;
  const legend = list ? (mode === "order" ? copy.skinListLegendSteps : copy.skinListLegendPicked) : copy.skinBuildLegend;
  const title = mode === "order" && list ? copy.skinOrderTitle : copy.skinBuildTitle;
  const empty = list ? copy.skinEmptySlot : copy.skinEmptyLayer;

  return (
    <section className="adv-skin adv-skin-layers" aria-label={title} data-mode={mode} data-vessel={list ? undefined : vessel} data-cover={list ? "list" : "vessel"}>
      <div className="adv-skin-top">
        <h3 className="adv-skin-title">{title}</h3>
        <p className="adv-skin-count" aria-live="polite">{fill(count, { k: sent.length, n: slots })}</p>
      </div>
      <div className="adv-skin-stage">
        {!list && <Vessel kind={vessel} layers={layers} />}
        <div className="adv-legend">
          <p className="adv-legend-title">{legend}</p>
          {/* У ёмкости легенда читается снизу вверх (первый слой — нижний), у списка — сверху вниз. Ряд с выбором снимает его. */}
          <ol className="adv-legend-list" aria-label={legend}>
            {Array.from({ length: slots }, (_, index) => {
              const entry = sent[index] ? byId(sent[index]) : undefined;
              const verdict = layers[index].verdict;
              return (
                <li key={index} className="adv-legend-item" data-verdict={verdict ?? undefined}>
                  <button
                    type="button"
                    className={`adv-legend-row${entry ? " filled" : ""}`}
                    disabled={locked || !entry}
                    aria-label={entry ? `${index + 1}. ${fill(copy.skinRemove, { title: entry.title })}${verdict ? `. ${verdict === "right" ? copy.skinRight : copy.skinWrong}` : ""}` : fill(empty, { i: index + 1, n: slots })}
                    onClick={() => entry && toggle(entry.id, "slot")}
                  >
                    <span className="adv-legend-dot" style={entry ? { background: LAYER_COLORS[index % LAYER_COLORS.length] } : undefined} aria-hidden="true">{index + 1}</span>
                    <span className="adv-legend-text">{entry ? entry.title : "—"}</span>
                    {verdict && <AdventIcon name={verdict === "right" ? "check" : "cross"} size={18} className="adv-legend-mark" />}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      {!reveal && (
        <>
          {free.length > 0 && (
            <ul className="adv-chips" aria-label={copy.skinBuildTitle} ref={chipsRef}>
              {free.map((entry, index) => (
                <li key={entry.id}>
                  <button type="button" className="adv-chip-item" data-id={entry.id} disabled={locked || missing === 0} onClick={() => toggle(entry.id, "chip")}>
                    <Icon name={entry.icon} size={18} color="var(--cyan)" />
                    <span>{entry.title}</span>
                    <span className="adv-chip-key" aria-hidden="true">{index + 1}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="adv-skin-submit">
            <button type="button" ref={submitRef} className="adv-btn adv-btn-primary" disabled={locked || missing > 0} onClick={submit}>
              {missing > 0 ? `${copy.skinBuildSubmit}: ${fill(list ? copy.skinListMissing : copy.skinBuildMissing, { left: missing })}` : copy.skinBuildSubmit}
            </button>
          </div>
        </>
      )}
      <div className="adv-skin-after" aria-live="polite">{reveal ? after : null}</div>
    </section>
  );
}

export function StorefrontBuild({ task, reveal, disabled, onSubmit, after }: TaskViewProps<Extract<PublicTask, { type: "build" }>>) {
  return <LayerSkin mode="build" entries={task.options} slots={task.slots} reveal={reveal} disabled={disabled} onSubmit={onSubmit} after={after} />;
}

export function StorefrontOrder({ task, reveal, disabled, onSubmit, after }: TaskViewProps<Extract<PublicTask, { type: "order" }>>) {
  return <LayerSkin mode="order" entries={task.items} slots={task.items.length} reveal={reveal} disabled={disabled} onSubmit={onSubmit} after={after} />;
}
