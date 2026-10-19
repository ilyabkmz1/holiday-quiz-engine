import { describe, expect, it } from "vitest";

import { campaign } from "@tenants/demo-office/campaign";
import type { Task } from "@/config/schema";
import { correctIds, scoreTask } from "@/domain/tasks";

import { allTasks, correctPayload, partialPayload, wrongPayload } from "../support/solve";

const byType = (type: Task["type"]) => allTasks.filter((task) => task.type === type);
const task = (id: string) => allTasks.find((candidate) => candidate.id === id)!;

describe("scoreTask", () => {
  it.each(allTasks.map((candidate) => [candidate.id, candidate] as const))(
    "gives 100 for the correct answer and 0 for a wrong one: %s",
    (_id, candidate) => {
      expect(scoreTask(candidate, correctPayload(candidate)).base).toBe(100);
      expect(scoreTask(candidate, wrongPayload(candidate)).base).toBe(0);
    }
  );

  it("gives 50 for build and access when exactly one card or switch is wrong", () => {
    for (const candidate of [...byType("build"), ...byType("access")]) {
      expect(scoreTask(candidate, partialPayload(candidate)!).base).toBe(50);
    }
  });

  it("has no partial credit for pick, phish and order", () => {
    for (const candidate of [...byType("pick"), ...byType("phish"), ...byType("order")]) {
      expect(partialPayload(candidate)).toBeNull();
    }
  });

  it("counts a build by its composition, ignoring the slot order", () => {
    const build = task("mail-answer");
    if (build.type !== "build") throw new Error("unexpected type");
    expect(scoreTask(build, { optionIds: [...build.correctOptionIds].reverse() }).base).toBe(100);
  });

  it("gives 0 for build and access with two or more mistakes", () => {
    const access = task("files-backup");
    if (access.type !== "access") throw new Error("unexpected type");
    expect(scoreTask(access, { enabledIds: [] }).base).toBe(0);
    expect(scoreTask(access, { enabledIds: ["samedisk", "purge"] }).base).toBe(0);
    expect(scoreTask(access, { enabledIds: ["daily", "offsite", "drill", "samedisk", "purge"] }).base).toBe(0);
  });

  it("treats a switch left on beyond the correct ones as exactly one mistake", () => {
    expect(scoreTask(task("files-backup"), { enabledIds: ["daily", "offsite", "drill", "purge"] }).base).toBe(50);
  });

  it("requires the exact order for order tasks", () => {
    const order = task("projects-stages");
    if (order.type !== "order") throw new Error("unexpected type");
    const swapped = [...order.correctOrder];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(scoreTask(order, { orderedIds: swapped }).base).toBe(0);
  });

  it("rejects payloads of the wrong shape", () => {
    expect(() => scoreTask(task("mail-invite"), { optionIds: ["bcc"] })).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => scoreTask(task("mail-invite"), {})).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => scoreTask(task("mail-invite"), { optionId: "bcc", extra: 1 })).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => scoreTask(task("mail-answer"), { optionId: "apology" })).toThrow(expect.objectContaining({ code: "invalid" }));
  });

  it("rejects unknown, duplicated and miscounted choices", () => {
    expect(() => scoreTask(task("mail-invite"), { optionId: "missing" })).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => scoreTask(task("mail-letters"), { optionId: "bcc" })).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => scoreTask(task("mail-answer"), { optionIds: ["apology", "apology", "resend"] })).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => scoreTask(task("mail-answer"), { optionIds: ["apology", "resend"] })).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => scoreTask(task("mail-answer"), { optionIds: ["apology", "resend", "zzz"] })).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => scoreTask(task("files-backup"), { enabledIds: ["daily", "daily"] })).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => scoreTask(task("projects-stages"), { orderedIds: ["goal", "plan"] })).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => scoreTask(task("projects-stages"), { orderedIds: ["goal", "plan", "plan"] })).toThrow(expect.objectContaining({ code: "invalid" }));
  });
});

describe("correctIds", () => {
  it("lists the revealed correct ids for every task type", () => {
    expect(correctIds(task("mail-invite"))).toEqual(["bcc"]);
    expect(correctIds(task("mail-letters"))).toEqual(["m2"]);
    expect(correctIds(task("mail-answer"))).toEqual(["apology", "resend", "contact"]);
    expect(correctIds(task("files-backup"))).toEqual(["daily", "offsite", "drill"]);
    expect(correctIds(task("projects-stages"))).toEqual(["goal", "plan", "rehearsal"]);
  });

  it("covers the whole campaign", () => {
    expect(allTasks).toHaveLength(campaign.rooms.length * 3);
  });
});
