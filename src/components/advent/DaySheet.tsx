"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AdventIcon } from "@/components/advent/icons";
import { AdventSheet } from "@/components/advent/AdventSheet";
import { Burst } from "@/components/advent/Burst";
import { LuckReveal, type LuckPhase } from "@/components/advent/LuckReveal";
import { PromoCard } from "@/components/advent/PromoCard";
import { SaveProgressCard, type SaveProgressInput } from "@/components/advent/SaveProgressCard";
import { fill } from "@/components/advent/format";
import type { AdventApi } from "@/components/advent/api";
import { HeroFace } from "@/components/game/characters";
import { correctTitles } from "@/components/game/RevealPanel";
import { RobotHint } from "@/components/game/room-ui";
import { TaskMechanic } from "@/components/play/TaskMechanic";
import { useSound } from "@/components/play/sound";
import type { AdventBlockState, AdventGrantView, AdventState, AdventTaskOutcome, PublicAdvent } from "@/types/advent";
import type { PublicHero, PublicRoom, PublicTask, TaskPayloadBody, TaskReveal } from "@/types/api";

type Props = {
  advent: PublicAdvent;
  state: AdventState;
  n: number;
  reduced: boolean;
  /** Серверное «сейчас», мс. */
  nowMs: number;
  api: AdventApi;
  onClose: () => void;
  /** Принять состояние, пришедшее с сервера. */
  onState: (state: AdventState) => void;
  onError: (error: unknown) => void;
};

/** Разбор задания адвента в форму, которую понимают механики заданий (очков и комбо в адвенте нет). */
export function outcomeToReveal(outcome: AdventTaskOutcome): TaskReveal {
  return {
    taskId: outcome.taskId,
    roomId: "advent",
    type: outcome.type,
    payload: outcome.payload,
    base: outcome.base,
    comboBonus: 0,
    combo: 0,
    outcome: outcome.outcome,
    correctIds: outcome.correctIds,
    explanation: outcome.explanation,
    tip: outcome.tip,
    mood: outcome.mood,
    line: outcome.line,
    fuses: 0,
    answeredAt: ""
  };
}

/** Фокус на главную кнопку шага без прокрутки: лист остаётся показанным с начала (`autoFocus` прокрутил бы к кнопке). */
const focusFirst = (element: HTMLElement | null) => element?.focus({ preventScroll: true });

function luckReveal(state: AdventState, n: number, index: number): AdventGrantView | null {
  const block = state.days.find((candidate) => candidate.n === n)?.blocks.find((candidate) => candidate.index === index);
  return block?.type === "luck" ? block.reveal : null;
}

type LuckRun = { phase: LuckPhase; chosen: number | null; result: AdventGrantView | null };

/**
 * Лист дня: глава истории → блоки по очереди (история, задание, удача, подарок) → итог дня.
 * Правильных ответов в листе нет, пока сервер не принял ответ: разбор приходит в `block.outcome` после записи.
 * Блок, который только что выполнили, остаётся на экране (закреплён), пока игрок не нажмёт «Дальше»: иначе
 * разбор или раскрытие награды исчезли бы в тот же момент, когда сервер отметил блок выполненным.
 */
export function DaySheet({ advent, state, n, reduced, nowMs, api, onClose, onState, onError }: Props) {
  const { copy } = advent;
  const sound = useSound();
  const day = state.days.find((candidate) => candidate.n === n);
  const door = state.doors.find((candidate) => candidate.n === n);
  const [chapterSeen, setChapterSeen] = useState(() => (day?.blocks.some((block) => block.done) ?? false) || (door?.completed ?? false));
  const [pinned, setPinned] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [acted, setActed] = useState(false);
  const [luck, setLuck] = useState<LuckRun | null>(null);
  const [promo, setPromo] = useState<AdventGrantView | null>(null);
  const [needIdentity, setNeedIdentity] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const blocks = day?.blocks;
  const nextIndex = blocks ? blocks.findIndex((block) => !block.done) : -1;
  const currentIndex = pinned ?? nextIndex;
  const current: AdventBlockState | null = blocks && currentIndex >= 0 ? (blocks[currentIndex] ?? null) : null;
  const hero: PublicHero = advent.heroes.find((candidate) => candidate.id === day?.heroId) ?? advent.heroes[0];

  // Каждый шаг показывается с начала листа.
  useEffect(() => {
    bodyRef.current?.closest(".adv-sheet-body")?.scrollTo?.({ top: 0 });
  }, [currentIndex, chapterSeen, needIdentity]);

  const room = useMemo<PublicRoom>(
    () => ({ id: `day-${n}`, title: door?.title ?? "", eyebrow: "", description: "", icon: "star", ornament: "", color: hero.color, map: { x: 0, y: 0 }, hostId: hero.id, spotId: "", taskIds: [] }),
    [n, door?.title, hero]
  );

  if (!day || !door || !blocks) {
    return (
      <AdventSheet label={copy.sheetOpening} closeLabel={copy.sheetClose} onClose={onClose}>
        <p className="adv-muted" role="status">{copy.sheetOpening}</p>
      </AdventSheet>
    );
  }

  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    try {
      return await action();
    } catch (error) {
      onError(error);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function confirmStory(index: number) {
    const res = await run(() => api.submitBlock(n, index));
    if (res) {
      setActed(true);
      sound.effect("tap");
      onState(res.state);
    }
  }

  async function submitTask(index: number, payload: TaskPayloadBody) {
    const res = await run(() => api.submitBlock(n, index, payload as Record<string, unknown>));
    if (!res) return;
    setActed(true);
    setPinned(index);
    sound.effect(res.block.outcome?.outcome === "perfect" ? "correct" : "miss");
    onState(res.state);
  }

  async function chooseLuck(index: number, choice: number) {
    setLuck({ phase: "pending", chosen: choice, result: null });
    const res = await run(() => api.submitBlock(n, index, { choice }));
    if (!res) {
      setLuck(null);
      return;
    }
    if (res.status === "identity_required") {
      setLuck(null);
      setNeedIdentity(true);
      onState(res.state);
      return;
    }
    // Исход берётся из ответа; запасной путь — раскрытие блока в состоянии (оба пришли после фиксации на сервере).
    const result = res.block.reward ?? luckReveal(res.state, n, index);
    if (!result) {
      setLuck(null);
      onState(res.state);
      return;
    }
    setActed(true);
    setPinned(index);
    setLuck({ phase: "reveal", chosen: choice, result });
    sound.effect("lit");
    onState(res.state);
  }

  async function openPromo(index: number) {
    const res = await run(() => api.submitBlock(n, index));
    if (!res) return;
    if (res.status === "identity_required") {
      setNeedIdentity(true);
      onState(res.state);
      return;
    }
    setActed(true);
    // Догнанный день при rewardOnlyOnDay: блок отмечен, но подарка нет — сразу итог дня, а не снова «Открыть подарок».
    setPinned(res.block.reward ? index : null);
    setPromo(res.block.reward);
    if (res.block.reward) sound.effect("lit");
    onState(res.state);
  }

  async function requestLink(input: SaveProgressInput) {
    await api.requestLink(input);
  }

  function advance() {
    setPinned(null);
    setLuck(null);
    setPromo(null);
  }

  const saveCard = (reason: "after-day" | "identity") => (
    <SaveProgressCard copy={copy} consentText={advent.legal.consentText} reason={reason} onSubmit={requestLink} />
  );
  const done = current === null;
  const dayGrants = state.grants.filter((grant) => grant.day === n && (grant.source === "day" || grant.source === "luck"));
  const anonymous = state.participant.email === null;
  const nextButton = (label: string) => (
    <button type="button" className="adv-btn adv-btn-primary adv-next" onClick={advance} ref={focusFirst}>
      {label} <AdventIcon name="check" size={16} />
    </button>
  );

  let content;
  if (!chapterSeen && !done) {
    content = (
      <section className="adv-chapter">
        <div className="adv-hero-row">
          <HeroFace hero={hero} mood="happy" size={56} />
          <div className="adv-hero-meta"><b>{hero.name}</b><span>{hero.role}</span></div>
        </div>
        <div className="adv-bubbles">
          {day.chapter.map((line, index) => (
            <p key={index} className="adv-bubble" style={{ animationDelay: reduced ? "0s" : `${index * 220}ms` }}>{line}</p>
          ))}
        </div>
        <button type="button" className="adv-btn adv-btn-primary" onClick={() => setChapterSeen(true)} ref={focusFirst}>
          {copy.chapterNext}
        </button>
      </section>
    );
  } else if (needIdentity) {
    content = saveCard("identity");
  } else if (current?.type === "story") {
    content = (
      <section className="adv-chapter">
        <div className="adv-hero-row">
          <HeroFace hero={hero} mood="neutral" size={48} />
          <div className="adv-hero-meta"><b>{hero.name}</b><span>{hero.role}</span></div>
        </div>
        <div className="adv-bubbles">
          {current.lines.map((line, index) => (
            <p key={index} className="adv-bubble" style={{ animationDelay: reduced ? "0s" : `${index * 220}ms` }}>{line}</p>
          ))}
        </div>
        <button type="button" className="adv-btn adv-btn-primary" disabled={busy} onClick={() => void confirmStory(current.index)} ref={focusFirst}>
          {copy.storyNext}
        </button>
      </section>
    );
  } else if (current?.type === "task") {
    const task: PublicTask = current.task;
    const taskHero = advent.heroes.find((candidate) => candidate.id === task.heroId) ?? hero;
    const reveal = current.outcome ? outcomeToReveal(current.outcome) : null;
    content = (
      <div className="room-layout" key={task.id}>
        <div className="adv-hero-row adv-task-say" role="status" aria-live="polite">
          <HeroFace hero={taskHero} mood={reveal ? reveal.mood : "neutral"} size={44} />
          <p className="adv-bubble"><b>{taskHero.name}:</b> {reveal ? reveal.line : task.say}</p>
        </div>
        <TaskMechanic
          task={task}
          hero={taskHero}
          room={room}
          reveal={reveal}
          disabled={busy}
          onSubmit={(payload) => void submitTask(current.index, payload)}
          shake={false}
          sceneVariant="flat"
          after={
            reveal && (
              <div className="adv-outcome rise" data-outcome={reveal.outcome}>
                <h3 className="adv-outcome-title">
                  {reveal.outcome === "perfect" ? copy.outcomePerfect : reveal.outcome === "partial" ? copy.outcomePartial : copy.outcomeMiss}
                </h3>
                {reveal.outcome !== "perfect" && (
                  <p className="adv-outcome-correct"><b>{copy.outcomeCorrect}:</b> {correctTitles(task, reveal)}</p>
                )}
                <p className="adv-outcome-text">{reveal.explanation}</p>
                {reveal.tip && <RobotHint>{reveal.tip}</RobotHint>}
                {nextButton(copy.outcomeNext)}
              </div>
            )
          }
        />
      </div>
    );
  } else if (current?.type === "luck") {
    const run: LuckRun = luck ?? { phase: "choose", chosen: null, result: null };
    content = (
      <LuckReveal
        skin={advent.luckSkin ?? "boxes"}
        choices={current.choices}
        copy={copy}
        phase={run.phase}
        chosen={run.chosen}
        result={run.result}
        reduced={reduced}
        disabled={busy || !current.ready}
        onChoose={(choice) => void chooseLuck(current.index, choice)}
      >
        {run.result && <PromoCard grant={run.result} copy={copy} timezone={advent.schedule.timezone} nowMs={nowMs} fresh onNeedIdentity={() => setNeedIdentity(true)} />}
        {nextButton(copy.outcomeNext)}
      </LuckReveal>
    );
  } else if (current?.type === "promo") {
    content = promo ? (
      <section className="adv-promo-reveal">
        {!reduced && <Burst />}
        <h3 className="adv-block-title">{copy.promoTitle}</h3>
        <PromoCard grant={promo} copy={copy} timezone={advent.schedule.timezone} nowMs={nowMs} fresh onNeedIdentity={() => setNeedIdentity(true)} />
        {nextButton(copy.outcomeNext)}
      </section>
    ) : (
      <section className="adv-promo-open">
        <h3 className="adv-block-title">{copy.promoTitle}</h3>
        <button type="button" className="adv-giftbtn" disabled={busy || !current.ready} onClick={() => void openPromo(current.index)} ref={focusFirst}>
          <span className="adv-giftbtn-art" aria-hidden="true"><AdventIcon name="gift" size={54} strokeWidth={1.5} /></span>
          <span>{busy ? copy.promoOpening : copy.promoOpen}</span>
        </button>
      </section>
    );
  } else {
    content = (
      <section className="adv-done" aria-live="polite">
        {acted && !reduced && <Burst />}
        <span className="adv-done-badge" aria-hidden="true"><AdventIcon name="star" size={30} /></span>
        <h3 className="adv-block-title">{copy.dayDoneTitle}</h3>
        <p className="adv-muted">{copy.dayDoneText}</p>
        {dayGrants.length > 0 ? (
          <div className="adv-grants">
            {dayGrants.map((grant) => (
              <PromoCard key={grant.id} grant={grant} copy={copy} timezone={advent.schedule.timezone} nowMs={nowMs} onNeedIdentity={() => setNeedIdentity(true)} />
            ))}
          </div>
        ) : (
          <p className="adv-muted-small">{copy.dayDoneNoReward}</p>
        )}
        {anonymous && saveCard("after-day")}
        <button type="button" className="adv-btn adv-btn-ghost" onClick={onClose}>{copy.sheetClose}</button>
      </section>
    );
  }

  return (
    <AdventSheet label={`${fill(copy.chapterEyebrow, { n })}: ${door.title}`} closeLabel={copy.sheetClose} onClose={onClose}>
      <div ref={bodyRef}>
        <header className="adv-sheet-head">
          <div className="adv-eyebrow">{fill(copy.chapterEyebrow, { n })}</div>
          <h2 className="adv-sheet-title">{door.title}</h2>
          <div className="adv-pips" role="img" aria-label={`${door.blocksDone} / ${door.blocksTotal}`}>
            {blocks.map((block) => (
              <i key={block.index} className={block.done ? "on" : block.index === currentIndex ? "now" : ""} />
            ))}
          </div>
        </header>
        {content}
      </div>
    </AdventSheet>
  );
}
