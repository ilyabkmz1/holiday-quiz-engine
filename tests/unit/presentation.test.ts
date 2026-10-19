import { describe, expect, it } from "vitest";

import { campaign } from "@tenants/demo-office/campaign";
import type { Task } from "@/config/schema";
import { correctIds } from "@/domain/tasks";
import { REVEALING_ID_PATTERN } from "@/config/schema";
import { publicCampaign, publicTask } from "@/server/presentation";

import { allTasks } from "../support/solve";

const KEYS = {
  pick: ["heroId", "id", "options", "roomId", "say", "type"],
  build: ["heroId", "id", "options", "roomId", "say", "slots", "type"],
  phish: ["heroId", "id", "letters", "roomId", "say", "type"],
  access: ["heroId", "id", "roomId", "say", "switches", "type"],
  order: ["heroId", "id", "items", "roomId", "say", "type"]
} as const;

const SESSION = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const roomOf = (task: Task) => campaign.rooms.find((candidate) => candidate.tasks.includes(task))!;
const sessionIds = Array.from({ length: 300 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);

type View = ReturnType<typeof publicTask>;

/** Идентификаторы вариантов в том порядке, в котором их увидит игрок. */
function shownIds(view: View): string[] {
  switch (view.type) {
    case "pick":
    case "build":
      return view.options.map((item) => item.id);
    case "phish":
      return view.letters.map((item) => item.id);
    case "access":
      return view.switches.map((item) => item.id);
    case "order":
      return view.items.map((item) => item.id);
  }
}

describe("publicTask", () => {
  it.each(allTasks.map((task) => [task.id, task] as const))("exposes only the whitelisted fields: %s", (_id, task) => {
    const view = publicTask(roomOf(task).id, task, SESSION);

    expect(Object.keys(view).sort()).toEqual([...KEYS[task.type]]);
    const text = JSON.stringify(view);
    for (const secret of [task.thanks, task.oops, task.tip, task.explanation]) {
      expect(text).not.toContain(secret);
    }
  });

  it.each(allTasks.map((task) => [task.id, task] as const))("carries no sign of the verdict in any field: %s", (_id, task) => {
    const view = publicTask(roomOf(task).id, task, SESSION);
    // Реплика героя — текст для игрока, она вправе называть задачу («найдите подделку»); остальное проверяем.
    const text = JSON.stringify({ ...view, say: undefined });

    // Ни в именах полей, ни в значениях (ид, названия, адреса) нет слов-маркеров верности.
    expect(text).not.toMatch(/correct|right|wrong|fake|genuine|trap|isFake|подделк|ловушк|фишинг/i);
    // Идентификаторы вариантов нейтральны и не совпадают с идентификатором верного ответа по смыслу конфигурации.
    for (const id of shownIds(view)) {
      expect(id).not.toMatch(REVEALING_ID_PATTERN);
    }
  });

  it("keeps phish letters free of any verdict and shows the same data for every letter", () => {
    const phish = allTasks.find((task) => task.type === "phish")!;
    const view = publicTask("mail", phish, SESSION);
    if (view.type !== "phish") throw new Error("unexpected type");
    expect(view.letters).toHaveLength(5);
    for (const letter of view.letters) {
      expect(Object.keys(letter).sort()).toEqual(["address", "attachment", "id", "mark", "sender", "subject"]);
      expect(letter.id).toMatch(/^m\d$/);
    }
  });

  it.each(allTasks.map((task) => [task.id, task] as const))("shows every variant exactly once: %s", (_id, task) => {
    const shown = shownIds(publicTask(roomOf(task).id, task, SESSION));
    const source = (
      task.type === "phish" ? task.letters : task.type === "access" ? task.switches : task.type === "order" ? task.items : task.options
    ).map((item) => item.id);
    expect([...shown].sort()).toEqual([...source].sort());
  });

  it.each(allTasks.map((task) => [task.id, task] as const))("keeps the order for one session on repeat and restore: %s", (_id, task) => {
    const first = shownIds(publicTask(roomOf(task).id, task, SESSION));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(shownIds(publicTask(roomOf(task).id, task, SESSION))).toEqual(first);
    }
  });

  it.each(allTasks.map((task) => [task.id, task] as const))("shows different sessions different orders: %s", (_id, task) => {
    const orders = new Set(sessionIds.map((id) => shownIds(publicTask(roomOf(task).id, task, id)).join(",")));
    expect(orders.size).toBeGreaterThan(1);
  });

  it.each(allTasks.filter((task) => task.type !== "order").map((task) => [task.id, task] as const))(
    "does not keep the correct ids in front, nor at a fixed place: %s",
    (_id, task) => {
      const correct = new Set(correctIds(task));
      let prefix = 0;
      const firstPlaces = new Set<number>();
      for (const id of sessionIds) {
        const shown = shownIds(publicTask(roomOf(task).id, task, id));
        const head = shown.slice(0, correct.size);
        if (head.every((item) => correct.has(item))) prefix += 1;
        firstPlaces.add(shown.findIndex((item) => correct.has(item)));
      }
      const options = shownIds(publicTask(roomOf(task).id, task, SESSION)).length;
      // Случайная выдача поставила бы верные впереди с вероятностью 1 / C(n, k): допускаем двойной запас.
      const choose = (n: number, k: number): number => (k === 0 ? 1 : (n * choose(n - 1, k - 1)) / k);
      const expected = 1 / choose(options, correct.size);
      expect(prefix / sessionIds.length).toBeLessThan(Math.min(0.9, expected * 2 + 0.05));
      expect(firstPlaces.size).toBeGreaterThan(1);
    }
  );

  it("shuffles the order task cards by session without excluding the correct order", () => {
    const order = allTasks.find((task) => task.type === "order")!;
    if (order.type !== "order") throw new Error("unexpected type");
    const seen = new Set<string>();
    for (const id of sessionIds) seen.add(shownIds(publicTask("projects", order, id)).join(","));
    expect(seen.size).toBeGreaterThan(2);
    // Правило «никогда не верный порядок» было бы подсказкой: у любого порядка одинаковая вероятность,
    // поэтому на достаточной выборке верный порядок хотя бы раз выпадает.
    const many = Array.from({ length: 400 }, (_, index) => shownIds(publicTask("projects", order, `probe-${index}`)).join(","));
    expect(many).toContain(order.correctOrder.join(","));
  });
});

describe("publicCampaign", () => {
  it("lists rooms and rules but neither task texts nor the rush pool", () => {
    const view = publicCampaign(campaign);
    const text = JSON.stringify(view);

    expect(view.scene).toEqual(campaign.scene);
    expect(view.rooms.map((room) => room.taskIds.length)).toEqual([3, 3, 3, 3, 3]);
    expect(view.rush).toMatchObject({ durationSeconds: 30, penaltySeconds: 2, pointsPerHit: 20 });
    for (const task of allTasks) {
      expect(text).not.toContain(task.say);
      expect(text).not.toContain(task.explanation);
    }
    for (const item of campaign.rush.pool) {
      expect(text).not.toContain(item.prompt);
    }
    expect(view.rewardTiers.map((tier) => tier.minScore)).toEqual([0, 1700, 2400, 3000]);
  });
});
