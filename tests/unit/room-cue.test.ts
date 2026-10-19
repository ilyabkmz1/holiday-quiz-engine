import { describe, expect, it } from "vitest";

import { campaign } from "@tenants/demo-office/campaign";
import { campaignSchema } from "@/config/schema";
import { roomProgress, type RawState } from "@/server/game-state";
import { publicCampaign } from "@/server/presentation";

const EMPTY: RawState = { answers: [], entries: [], shown: [], run: null, rushAnswers: [] };

describe("реплика следующей заявки комнаты", () => {
  it("до входа в комнату отдаёт героя и say первой заявки, но не id задания", () => {
    for (const room of campaign.rooms) {
      const progress = roomProgress(campaign, EMPTY, room);
      expect(progress.currentTaskId).toBeNull();
      expect(progress.next).toEqual({ heroId: room.tasks[0].heroId, say: room.tasks[0].say });
    }
  });

  it("следующая заявка меняется после ответа и пропадает у пройденной комнаты", () => {
    const room = campaign.rooms[0];
    const answer = (task: (typeof room.tasks)[number], seq: number) =>
      ({ taskId: task.id, seq, basePoints: 100, comboBonus: 0, combo: seq, payload: {}, answeredAt: new Date(2026, 11, 20, 12, 0, seq) }) as unknown as RawState["answers"][number];
    const entry = { roomId: room.id, enteredAt: new Date(2026, 11, 20, 12) } as RawState["entries"][number];
    const one = roomProgress(campaign, { ...EMPTY, entries: [entry], answers: [answer(room.tasks[0], 1)] }, room);
    expect(one.next).toEqual({ heroId: room.tasks[1].heroId, say: room.tasks[1].say });
    const all = roomProgress(campaign, { ...EMPTY, entries: [entry], answers: room.tasks.map((task, i) => answer(task, i + 1)) }, room);
    expect(all.completed).toBe(true);
    expect(all.next).toBeNull();
  });

  it("в RoomProgress нет ни разбора, ни вариантов: только герой и реплика", () => {
    for (const room of campaign.rooms) {
      const cue = roomProgress(campaign, EMPTY, room).next!;
      expect(Object.keys(cue).sort()).toEqual(["heroId", "say"]);
      const task = room.tasks[0];
      for (const secret of [task.thanks, task.oops, task.tip, task.explanation]) expect(JSON.stringify(cue)).not.toContain(secret);
    }
  });
});

describe("campaign.mode", () => {
  it("по умолчанию — quest, в публичной кампании отдаётся как есть", () => {
    const { mode: _mode, ...withoutMode } = structuredClone(campaign);
    void _mode;
    expect(campaignSchema.parse(withoutMode).mode).toBe("quest");
    expect(publicCampaign(campaign).mode).toBe("quest");
    expect(publicCampaign({ ...campaign, mode: "cards" }).mode).toBe("cards");
  });

  it("принимает только cards и quest", () => {
    expect(campaignSchema.safeParse({ ...campaign, mode: "arcade" }).success).toBe(false);
  });
});
