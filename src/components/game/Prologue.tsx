"use client";

import { useState } from "react";

import { Snow } from "@/components/game/ambient";
import { HeroFace, RobotAvatar } from "@/components/game/characters";
import { OfficeGlobe } from "@/components/game/OfficeGlobe";
import type { PublicCampaign } from "@/types/api";

export function Landing({ campaign, onStart }: { campaign: PublicCampaign; onStart: () => void }) {
  const totalTasks = campaign.rooms.reduce((sum, room) => sum + room.taskIds.length, 0);
  return (
    <div className="screen landing">
      <div className="landing-stage">
        <OfficeGlobe rooms={campaign.rooms} states={{}} brightness={0.4} alt={campaign.story.landingAlt} variant="landing" priority />
        <div className="date-chip">{campaign.scene.dateLabel}</div>
      </div>
      <div className="landing-copy rise">
        <h1 className="landing-title">{campaign.title}</h1>
        <div className="talk">
          <div className="bob">
            <RobotAvatar size={56} label="Робот-помощник" />
          </div>
          <p className="bubble bubble-side">{campaign.intro}</p>
        </div>
        <ul className="facts">
          <li><b className="gold">{totalTasks}</b><span>заявок</span></li>
          <li><b className="cyan">{campaign.rooms.length}</b><span>комнат</span></li>
          <li><b className="coral">{campaign.rush.durationSeconds} с</b><span>рывок</span></li>
        </ul>
        <div className="grow" />
        <button type="button" className="btn btn-primary" onClick={onStart}>
          Помочь роботу
        </button>
      </div>
    </div>
  );
}

/** Пролог без очков: герой пролога объясняет правила, игрок делает обучающий тап по MFA. */
export function Prologue({ campaign, busy, onDone }: { campaign: PublicCampaign; busy: boolean; onDone: () => void }) {
  const hero = campaign.heroes.find((candidate) => candidate.id === campaign.prologue.heroId) ?? campaign.heroes[0];
  const { lines, mfa } = campaign.prologue;
  const [shown, setShown] = useState(1);
  const [mfaOn, setMfaOn] = useState(false);
  const allShown = shown >= lines.length;

  return (
    <div className="screen prologue has-snow">
      <Snow count={14} className="screen-snow" />
      <div className="prologue-hero">
        <div className="bob">
          <HeroFace hero={hero} mood={mfaOn ? "happy" : "neutral"} size={96} />
        </div>
        <div className="who-chip"><b>{hero.name}</b> · {hero.role}</div>
      </div>
      <div className="prologue-chat" aria-live="polite">
        {lines.slice(0, shown).map((line, index) => (
          <p key={index} className="bubble bubble-flat rise">{line}</p>
        ))}
        {allShown && <p className="bubble bubble-flat rise">{mfa.prompt}</p>}
      </div>
      {allShown && (
        <div className="mfa rise">
          <button
            type="button"
            role="switch"
            aria-checked={mfaOn}
            className={mfaOn ? "switch-row on" : "switch-row"}
            onClick={() => setMfaOn(true)}
          >
            <span className="switch-title">{mfa.switchLabel}</span>
            <span className="sw" aria-hidden="true" />
          </button>
          {mfaOn && <p className="mfa-done rise" role="status">{mfa.done}</p>}
        </div>
      )}
      <div className="grow" />
      {!allShown ? (
        <button type="button" className="btn btn-primary" onClick={() => setShown((count) => count + 1)}>
          Дальше
        </button>
      ) : (
        <button type="button" className="btn btn-primary" disabled={!mfaOn || busy} onClick={onDone}>
          {busy ? "Открываем офис…" : "К карте офиса"}
        </button>
      )}
    </div>
  );
}
