import { campaign as config } from "@tenants/demo-office/campaign";
import { publicCampaign } from "@/server/presentation";
import type { FinalResult, RoomProgress, RoomSummary, SessionProgress } from "@/types/api";

export const campaign = publicCampaign(config);

export const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

export function summary(roomId: string): RoomSummary {
  return { roomId, answered: 3, completed: true, base: 300, comboBonus: 0, fuses: 3, noFailBonus: 0, speedBonus: 0, elapsedSeconds: 30, total: 300 };
}

export function room(roomId: string, patch: Partial<RoomProgress> = {}): RoomProgress {
  return { roomId, entered: false, enteredAt: null, spentMs: 0, taskShownAt: null, answered: 0, completed: false, currentTaskId: null, next: null, fuses: 3, summary: null, ...patch };
}

export function doneRoom(roomId: string): RoomProgress {
  return room(roomId, { entered: true, enteredAt: new Date().toISOString(), answered: 3, completed: true, summary: summary(roomId) });
}

export function session(patch: Partial<SessionProgress> = {}): SessionProgress {
  return {
    id: "s1", status: "playing", score: 0, combo: 0, rooms: campaign.rooms.map((item) => room(item.id)), roomsCompleted: 0,
    rushUnlocked: false, rush: null, answers: [], completedAt: null, final: null, ...patch
  };
}

/** Комнаты с реальной репликой первой заявки (как отдаёт сервер до входа). */
export function cued(): SessionProgress {
  return session({ rooms: config.rooms.map((item) => room(item.id, { next: { heroId: item.tasks[0].heroId, say: item.tasks[0].say } })) });
}

export function rushSession(): SessionProgress {
  const now = new Date();
  return {
    ...session({ id: "s1", score: 300, rooms: campaign.rooms.map((item) => doneRoom(item.id)), roomsCompleted: 5, rushUnlocked: true }),
    rush: {
      status: "running", startedAt: now.toISOString(), deadlineAt: new Date(now.getTime() + campaign.rush.durationSeconds * 1000).toISOString(), serverNow: now.toISOString(),
      secondsLeft: campaign.rush.durationSeconds, answered: 0, hits: 0, misses: 0, points: 0, total: 20, current: { itemId: "i1", prompt: "Первая заявка", index: 0 }
    }
  };
}

export function finalSession(): SessionProgress {
  const final: FinalResult = {
    score: 1500, level: campaign.rewardTiers[0], rooms: campaign.rooms.map((item) => summary(item.id)), rushHits: 10, rushPoints: 200,
    ornaments: campaign.rooms.map((item) => ({ roomId: item.id, name: item.ornament }))
  };
  return { ...rushSession(), status: "completed", rush: null, score: final.score, completedAt: new Date().toISOString(), final };
}

export const stubResizeObserver = () =>
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
