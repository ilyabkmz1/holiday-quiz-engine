import { RobotHint } from "@/components/game/room-ui";
import { CountUp } from "@/components/game/CountUp";
import { signed } from "@/components/game/format";
import type { PublicTask, TaskReveal } from "@/types/api";

/** Названия верных вариантов — только из `reveal.correctIds` и публичного задания. */
export function correctTitles(task: PublicTask, reveal: TaskReveal): string {
  const ids = reveal.correctIds;
  switch (task.type) {
    case "pick":
    case "build":
      return ids.map((id) => task.options.find((option) => option.id === id)?.title ?? id).join(", ");
    case "access": {
      const titles = ids.map((id) => task.switches.find((item) => item.id === id)?.title ?? id);
      return titles.length > 0 ? `включить: ${titles.join(", ")}` : "ничего не включать";
    }
    case "order":
      return ids.map((id) => task.items.find((item) => item.id === id)?.title ?? id).join(" → ");
    case "phish": {
      const letter = task.letters.find((candidate) => candidate.id === ids[0]);
      return letter ? `${letter.sender} (${letter.address})` : "";
    }
  }
}

const TITLES = {
  perfect: "Заявка закрыта!",
  combo: "Комбо! Офис разгорается",
  partial: "Почти: сценарий работает частично",
  miss: "Сбой в офисе"
} as const;

export function RevealPanel({
  task,
  reveal,
  nextLabel,
  busy,
  onNext
}: {
  task: PublicTask;
  reveal: TaskReveal;
  nextLabel: string;
  busy: boolean;
  onNext: () => void;
}) {
  const title = reveal.outcome === "perfect" ? (reveal.combo >= 2 ? TITLES.combo : TITLES.perfect) : TITLES[reveal.outcome];
  const color = reveal.outcome === "perfect" ? "gold" : reveal.outcome === "partial" ? "amber" : "coral";
  return (
    <div className="reveal rise" data-outcome={reveal.outcome}>
      <div className="reveal-head">
        <div className={`reveal-points pop ${color}`}>
          <span className="sr-only">Баллы за заявку: {reveal.base}</span>
          <span aria-hidden="true"><CountUp value={reveal.base} from={0} format={signed} duration={700} /></span>
          {reveal.base > 0 && <span className="points-fly" aria-hidden="true">{signed(reveal.base)}</span>}
        </div>
        <div className="reveal-titles">
          <h2 className="reveal-title">{title}</h2>
          {reveal.comboBonus > 0 && (
            <div className="reveal-bonus pop">
              Комбо ×{reveal.combo}: {signed(reveal.comboBonus)}
            </div>
          )}
          {reveal.outcome !== "perfect" && (
            <div className="reveal-miss">
              {reveal.outcome === "miss" ? "Сбой! " : ""}Верно: {correctTitles(task, reveal)}
            </div>
          )}
        </div>
      </div>
      <p className="reveal-explanation">{reveal.explanation}</p>
      <RobotHint title="Робот-помощник: совет">{reveal.tip}</RobotHint>
      <button type="button" className="btn btn-primary reveal-next" onClick={onNext} disabled={busy} autoFocus>
        {nextLabel}
      </button>
    </div>
  );
}
