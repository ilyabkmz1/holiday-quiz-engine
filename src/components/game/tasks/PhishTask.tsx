"use client";

import { useState } from "react";

import { Icon } from "@/components/game/icons";
import { useSubmitLock } from "@/components/game/hooks";
import { Hand, Scene, moodOf, type TaskViewProps } from "@/components/game/room-ui";
import type { PublicLetter, PublicTask } from "@/types/api";

type Props = TaskViewProps<Extract<PublicTask, { type: "phish" }>>;

const AVATAR_COLORS = ["#7FB2FF", "#FF9FB0", "#FFD27A", "#9FE3B0", "#C7B6FF"];

function initials(sender: string): string {
  const letters = sender
    .split(/[\s·«»"-]+/)
    .filter((part) => /^[\p{L}]/u.test(part))
    .slice(0, 2)
    .map((part) => part[0].toUpperCase());
  return letters.join("") || "?";
}

function MarkBadge({ mark }: { mark: PublicLetter["mark"] }) {
  if (mark === "none") return null;
  return (
    <span className="ok-badge">
      <Icon name="check" size={11} strokeWidth={2.6} />
      {mark === "verified" ? "проверен" : "госструктура"}
    </span>
  );
}

/** Список писем: выбрать подделку и отправить её в карантин. */
export function PhishTask({ task, hero, room, reveal, disabled, onSubmit, after, shake, sceneVariant }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const { locked, lock } = useSubmitLock(disabled, reveal !== null);

  function submit() {
    if (!selected || !lock()) return;
    onSubmit({ optionId: selected });
  }

  return (
    <>
      <Scene room={room} hero={hero} text={reveal ? reveal.line : task.say} mood={moodOf(reveal)} shake={shake} variant="compact" bright={reveal?.outcome === "perfect"} sceneVariant={sceneVariant} />
      <Hand reveal={reveal} after={after}>
        <div className="hand-head">
          <span>Входящие · Почта</span>
          <span>Нажмите на подделку</span>
        </div>
        <div className="letters" role="group" aria-label="Входящие письма">
          {task.letters.map((letter, index) => (
            <button
              key={letter.id}
              type="button"
              className={selected === letter.id ? "letter sel" : "letter"}
              aria-pressed={selected === letter.id}
              disabled={locked}
              onClick={() => setSelected(letter.id)}
            >
              <span className="av" style={{ background: AVATAR_COLORS[index % AVATAR_COLORS.length] }} aria-hidden="true">
                {initials(letter.sender)}
              </span>
              <span className="letter-body">
                <span className="letter-sender">
                  {letter.sender} <MarkBadge mark={letter.mark} />
                </span>
                <span className="letter-address">{letter.address}</span>
                <span className="letter-subject">{letter.subject}</span>
                {letter.attachment && (
                  <span className="letter-attachment">
                    <Icon name="clip" size={12} /> {letter.attachment}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
        <div className="grow" />
        <button type="button" className="btn btn-danger" disabled={locked || !selected} onClick={submit}>
          Это подделка — в карантин
        </button>
      </Hand>
    </>
  );
}
