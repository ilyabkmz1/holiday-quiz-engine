import { describe, expect, it } from "vitest";

import { pointerAnchor } from "@/worlds/model";
import { resolveRoomHero } from "@/components/quest/hero-view";
import { snowGlobeModel } from "../support/world";

const { SPOTS, WORLD_H, WORLD_W } = snowGlobeModel;

const inBox = (point: { x: number; y: number }, box: { x: number; y: number; w: number; h: number }) =>
  point.x >= (box.x / 100) * WORLD_W && point.x <= ((box.x + box.w) / 100) * WORLD_W && point.y >= (box.y / 100) * WORLD_H && point.y <= ((box.y + box.h) / 100) * WORLD_H;

describe("маяк цели «!»", () => {
  for (const spot of SPOTS) {
    it(`комната «${spot.roomId}»: маяк над головой её героя, внутри её рамки и не над другой комнатой`, () => {
      const anchor = pointerAnchor(spot);
      expect(anchor.x).toBe(spot.heroPos.x);
      expect(anchor.y).toBeLessThan(spot.heroPos.y);
      // Над головой, а не этажом выше: выше ног героя не больше чем на рост фигурки и облачко.
      expect(spot.heroPos.y - anchor.y).toBeLessThanOrEqual(100);
      expect(inBox(anchor, spot.box)).toBe(true);
      for (const other of SPOTS.filter((candidate) => candidate.roomId !== spot.roomId)) expect(inBox(anchor, other.box)).toBe(false);
    });
  }
});

describe("герой комнаты", () => {
  const next = { heroId: "marina", say: "Реплика Марины" };
  it("вне карточки у незавершённой комнаты — герой следующей заявки, прошлый разбор и его настроение не действуют", () => {
    const resolved = resolveRoomHero({ view: { heroId: "timur", mood: "happy" }, progress: { completed: false, next }, playing: false, host: "lena" });
    expect(resolved).toEqual({ heroId: "marina", mood: null });
  });
  it("пока карточка открыта и у пройденной комнаты — герой последнего задания с его настроением", () => {
    expect(resolveRoomHero({ view: { heroId: "timur", mood: "happy" }, progress: { completed: false, next }, playing: true, host: "lena" })).toEqual({ heroId: "timur", mood: "happy" });
    expect(resolveRoomHero({ view: { heroId: "timur", mood: "happy" }, progress: { completed: true, next: null }, playing: false, host: "lena" })).toEqual({ heroId: "timur", mood: "happy" });
  });
  it("без заявки и разбора — хозяин комнаты", () => {
    expect(resolveRoomHero({ view: undefined, progress: undefined, playing: false, host: "lena" }).heroId).toBe("lena");
  });
});
