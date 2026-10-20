import { AdventIcon } from "@/components/advent/icons";
import type { AdventCopy } from "@/config/advent-schema";

export type StepKey = "story" | "task" | "gift";
export type StepState = "done" | "now" | "todo";

/**
 * Шаги дня «история → задание → подарок»: в индикаторе только те, что есть в этом дне; текущий — по положению игрока.
 * `current` — шаг, на котором игрок сейчас, либо `"done"`, когда день пройден.
 */
export function daySteps(present: readonly StepKey[], current: StepKey | "done"): Array<{ key: StepKey; state: StepState }> {
  const order: StepKey[] = ["story", "task", "gift"];
  const at = current === "done" ? order.length : order.indexOf(current);
  return present.map((key) => {
    const rank = order.indexOf(key);
    return { key, state: rank < at ? "done" : rank === at ? "now" : "todo" };
  });
}

/** Какие шаги есть в дне: история всегда, задание и подарок — если в дне есть такие блоки или награда. */
export function presentSteps(blocks: ReadonlyArray<{ type: string }>, hasReward: boolean): StepKey[] {
  const steps: StepKey[] = ["story"];
  if (blocks.some((block) => block.type === "task")) steps.push("task");
  if (hasReward || blocks.some((block) => block.type === "luck" || block.type === "promo")) steps.push("gift");
  return steps;
}

export function StepRail({ steps, copy }: { steps: Array<{ key: StepKey; state: StepState }>; copy: AdventCopy }) {
  const label: Record<StepKey, string> = { story: copy.stepStory, task: copy.stepTask, gift: copy.stepGift };
  return (
    <ol className="adv-steps" aria-label={copy.stepsLabel}>
      {steps.map((step, index) => (
        <li key={step.key} className="adv-step" data-state={step.state} data-step={step.key} aria-current={step.state === "now" ? "step" : undefined}>
          <span className="adv-step-dot" aria-hidden="true">{step.state === "done" ? <AdventIcon name="check" size={14} strokeWidth={3} /> : index + 1}</span>
          <span className="adv-step-label">{label[step.key]}</span>
        </li>
      ))}
    </ol>
  );
}
