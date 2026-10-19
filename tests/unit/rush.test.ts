import { describe, expect, it } from "vitest";

import { initialDeadline, penalizedDeadline, rushAcceptsAnswers, secondsLeft, shuffle } from "@/domain/rush";

const start = new Date("2026-12-24T12:00:00Z");
const ms = (offset: number) => new Date(start.getTime() + offset);

describe("rush deadline", () => {
  it("lasts 30 seconds and each mistake moves it 2 seconds earlier", () => {
    const deadline = initialDeadline(start);
    expect(deadline).toEqual(ms(30_000));
    expect(penalizedDeadline(penalizedDeadline(deadline))).toEqual(ms(26_000));
  });

  it("accepts answers up to the deadline plus a 2 second network allowance", () => {
    const run = { deadlineAt: ms(30_000), finishedAt: null };
    expect(rushAcceptsAnswers(run, ms(29_000))).toBe(true);
    expect(rushAcceptsAnswers(run, ms(32_000))).toBe(true);
    expect(rushAcceptsAnswers(run, ms(32_001))).toBe(false);
  });

  it("refuses answers once the run is finished", () => {
    expect(rushAcceptsAnswers({ deadlineAt: ms(30_000), finishedAt: ms(10_000) }, ms(11_000))).toBe(false);
  });

  it("shows whole seconds left, never negative", () => {
    expect(secondsLeft(ms(30_000), ms(0))).toBe(30);
    expect(secondsLeft(ms(30_000), ms(1_001))).toBe(29);
    expect(secondsLeft(ms(30_000), ms(31_000))).toBe(0);
  });
});

describe("shuffle", () => {
  it("returns a permutation without touching the source", () => {
    const source = ["a", "b", "c", "d", "e"];
    const shuffled = shuffle(source, () => 0.3);
    expect([...shuffled].sort()).toEqual(source);
    expect(source).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("is deterministic for a deterministic source of randomness", () => {
    const random = () => 0.5;
    expect(shuffle([1, 2, 3, 4], random)).toEqual(shuffle([1, 2, 3, 4], random));
  });
});
