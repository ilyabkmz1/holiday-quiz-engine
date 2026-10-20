"use client";

import { useState } from "react";

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
 * Обложка «СОБЕРИ» для заданий `build` и `order`: ёмкость (чашка со слоями и паром, коробка или стопка), слоты — слои снизу вверх
 * с легендой, варианты — чипы-ингредиенты (кнопки не ниже 44 px), счётчик «2 из 4 слоёв». Логика ответа — как у штатных механик.
 */
function LayerSkin({ mode, entries, slots, reveal, disabled, after, onSubmit }: Props) {
  const { copy, vessel } = useSkin();
  const [picked, setPicked] = useState<string[]>([]);
  const { locked, lock } = useSubmitLock(disabled, reveal !== null);

  const sent = reveal ? (mode === "build" ? ("optionIds" in reveal.payload ? reveal.payload.optionIds : picked) : "orderedIds" in reveal.payload ? reveal.payload.orderedIds : picked) : picked;
  const byId = (id: string) => entries.find((entry) => entry.id === id);

  function toggle(id: string) {
    if (locked) return;
    setPicked((current) => {
      if (current.includes(id)) return current.filter((candidate) => candidate !== id);
      return current.length < slots ? [...current, id] : current;
    });
  }

  function submit() {
    if (picked.length !== slots || !lock()) return;
    onSubmit(mode === "build" ? { optionIds: picked } : { orderedIds: picked });
  }

  useDigitKeys(!locked, entries.length, (index) => toggle(entries[index].id));

  const verdictOf = (id: string, index: number): "right" | "wrong" | null => {
    if (!reveal) return null;
    return (mode === "build" ? reveal.correctIds.includes(id) : reveal.correctIds[index] === id) ? "right" : "wrong";
  };
  const layers: VesselLayer[] = Array.from({ length: slots }, (_, index) => {
    const id = sent[index];
    return { filled: id !== undefined, verdict: id !== undefined ? verdictOf(id, index) : null };
  });
  const missing = slots - picked.length;

  return (
    <section className="adv-skin adv-skin-layers" aria-label={copy.skinBuildTitle} data-mode={mode} data-vessel={vessel}>
      <div className="adv-skin-top">
        <h3 className="adv-skin-title">{copy.skinBuildTitle}</h3>
        <p className="adv-skin-count" aria-live="polite">{fill(copy.skinBuildLayers, { k: sent.length, n: slots })}</p>
      </div>
      <div className="adv-skin-stage">
        <Vessel kind={vessel} layers={layers} />
        <div className="adv-legend">
          <p className="adv-legend-title">{copy.skinBuildLegend}</p>
          {/* Легенда читается снизу вверх: первый слой — нижний. Ряд с выбранным слоем снимает его. */}
          <ol className="adv-legend-list" aria-label={copy.skinBuildLegend}>
            {Array.from({ length: slots }, (_, index) => {
              const entry = sent[index] ? byId(sent[index]) : undefined;
              const verdict = layers[index].verdict;
              return (
                <li key={index} className="adv-legend-item" data-verdict={verdict ?? undefined}>
                  <button
                    type="button"
                    className={`adv-legend-row${entry ? " filled" : ""}`}
                    disabled={locked || !entry}
                    aria-label={entry ? `${index + 1}. ${fill(copy.skinRemove, { title: entry.title })}${verdict ? `. ${verdict === "right" ? copy.skinRight : copy.skinWrong}` : ""}` : fill(copy.skinEmptyLayer, { i: index + 1, n: slots })}
                    onClick={() => entry && toggle(entry.id)}
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
          <ul className="adv-chips" aria-label={copy.skinBuildTitle}>
            {entries.map((entry, index) => {
              const used = picked.includes(entry.id);
              return (
                <li key={entry.id}>
                  <button type="button" className="adv-chip-item" aria-pressed={used} disabled={locked} onClick={() => toggle(entry.id)}>
                    <Icon name={entry.icon} size={18} color="var(--cyan)" />
                    <span>{entry.title}</span>
                    <span className="adv-chip-key" aria-hidden="true">{index + 1}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" className="adv-btn adv-btn-primary" disabled={locked || missing > 0} onClick={submit}>
            {missing > 0 ? `${copy.skinBuildSubmit}: ${fill(copy.skinBuildMissing, { left: missing })}` : copy.skinBuildSubmit}
          </button>
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
