import { describe, expect, it } from "vitest";

import { dayRewardAvailable, doorStatus } from "@/domain/advent/doors";

const rules = (catchUp: Parameters<typeof doorStatus>[3]["catchUp"], rewardOnlyOnDay = false) => ({ catchUp, rewardOnlyOnDay });

describe("doorStatus", () => {
  it("opened важнее всего, даже для будущих и закрытых дней", () => {
    expect(doorStatus(3, 5, [3], rules("none"))).toBe("opened");
    expect(doorStatus(9, 5, new Set([9]), rules("none"))).toBe("opened");
    expect(doorStatus(3, 5, [3], rules("all"), "closed")).toBe("opened");
  });

  it("locked: дни после сегодняшнего и всё до старта", () => {
    expect(doorStatus(6, 5, [], rules("all"))).toBe("locked");
    expect(doorStatus(1, null, [], rules("all"))).toBe("locked");
    expect(doorStatus(1, null, [], rules("all"), "upcoming")).toBe("locked");
  });

  it("today: сегодняшний неоткрытый день", () => {
    expect(doorStatus(5, 5, [1, 2], rules("none"))).toBe("today");
  });

  it("catchUp none: прошедшие дни пропущены", () => {
    expect(doorStatus(4, 5, [], rules("none"))).toBe("missed");
    expect(doorStatus(1, 5, [], rules("none"))).toBe("missed");
  });

  it("catchUp window: дни не раньше today − k", () => {
    const window2 = rules({ window: 2 });
    expect(doorStatus(4, 5, [], window2)).toBe("catchup");
    expect(doorStatus(3, 5, [], window2)).toBe("catchup");
    expect(doorStatus(2, 5, [], window2)).toBe("missed");
    expect(doorStatus(1, 5, [], rules({ window: 7 }))).toBe("catchup");
  });

  it("catchUp all: любой прошедший день", () => {
    expect(doorStatus(1, 12, [], rules("all"))).toBe("catchup");
    expect(doorStatus(11, 12, [], rules("all"))).toBe("catchup");
  });

  it("вне running двери не открываются: прошедшие неоткрытые — missed", () => {
    expect(doorStatus(12, 12, [], rules("all"), "finale")).toBe("missed");
    expect(doorStatus(3, 12, [], rules("all"), "closed")).toBe("missed");
    expect(doorStatus(3, 12, [], rules("all"), "upcoming")).toBe("locked");
  });
});

describe("dayRewardAvailable", () => {
  it("сегодняшний день всегда даёт награду", () => {
    expect(dayRewardAvailable(5, 5, [], rules("none", true))).toBe(true);
    expect(dayRewardAvailable(5, 5, [], rules("none", false))).toBe(true);
  });

  it("догоняемый день даёт награду, только если rewardOnlyOnDay выключен", () => {
    expect(dayRewardAvailable(4, 5, [], rules({ window: 1 }, false))).toBe(true);
    expect(dayRewardAvailable(4, 5, [], rules({ window: 1 }, true))).toBe(false);
  });

  it("открытые, пропущенные и будущие дни награду не дают", () => {
    expect(dayRewardAvailable(5, 5, [5], rules("none"))).toBe(false);
    expect(dayRewardAvailable(1, 5, [], rules("none"))).toBe(false);
    expect(dayRewardAvailable(9, 5, [], rules("all"))).toBe(false);
  });

  it("в финале и после награды дня нет", () => {
    expect(dayRewardAvailable(12, 12, [], rules("all"), "finale")).toBe(false);
  });
});
