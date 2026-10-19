import { describe, expect, it } from "vitest";

import { loadWorld, worldIds } from "@/worlds/registry";
import { parseWorld, worldIssues, type World } from "@/worlds/world";
import { campaign } from "@tenants/demo-office/campaign";
import { EDGES, NODES, ROOM_SPOTS, RUSH_SPOTS, START_NODE, TREE_NODE } from "../support/world";

const clone = (): World => structuredClone(loadWorld("snow-globe"));

describe("мир snow-globe (worlds/snow-globe/world.json)", () => {
  it("проходит схему и проверки ссылок и связности", () => {
    expect(worldIds()).toContain("snow-globe");
    expect(worldIssues(loadWorld("snow-globe"))).toEqual([]);
  });

  it("загрузчик отдаёт те же данные, что раньше были константами world-data.ts", () => {
    expect(NODES).toHaveLength(20);
    expect(EDGES).toHaveLength(24);
    expect(START_NODE).toBe("gate");
    expect(TREE_NODE).toBe("tree");
    expect(NODES.find((node) => node.id === "mailPad")).toEqual({ id: "mailPad", x: 49.5, y: 48.4 });
    expect(ROOM_SPOTS.map((spot) => spot.roomId)).toEqual(["mail", "calendar", "messenger", "files", "projects"]);
    expect(ROOM_SPOTS[0]).toEqual({ roomId: "mail", pad: "mailPad", hero: { x: 54.2, y: 48.1, face: "left" }, box: { x: 40.5, y: 38, w: 15, h: 11.8 } });
    expect(RUSH_SPOTS.projects).toEqual([69.8, 67.4]);
  });

  it("кнопки карты режима cards у demo-office совпадают с точками мира", () => {
    const world = loadWorld("snow-globe");
    for (const room of campaign.rooms) {
      const spot = world.spots.find((candidate) => candidate.id === (room.spotId ?? room.id))!;
      expect(room.map).toEqual(spot.card);
    }
  });

  it("ловит разорванный граф, неизвестную площадку и ребро в никуда", () => {
    const broken = clone();
    broken.edges = broken.edges.filter(([from, to]) => from !== "calendarPad" && to !== "calendarPad");
    expect(worldIssues(broken).join("\n")).toContain("недостижим");

    const pad = clone();
    pad.spots[0].pad = "nowhere";
    expect(worldIssues(pad).join("\n")).toContain("площадки «nowhere»");

    const edge = clone();
    edge.edges.push(["gate", "ghost"]);
    expect(worldIssues(edge).join("\n")).toContain("неизвестный узел");

    const slots = clone();
    slots.treeSlots = slots.treeSlots.slice(0, 2);
    expect(worldIssues(slots).join("\n")).toContain("treeSlots");
  });

  it("parseWorld бросает с перечнем проблем, а схема отвергает координаты вне 0–100", () => {
    const lost = clone();
    lost.nodes.push({ id: "island", x: 1, y: 1 });
    expect(() => parseWorld(lost)).toThrow(/не связный/);
    const outside = clone();
    outside.nodes[0].x = 140;
    expect(() => parseWorld(outside)).toThrow();
  });

  it("неизвестный мир — понятная ошибка", () => {
    expect(() => loadWorld("no-such")).toThrow(/Доступны: snow-globe/);
  });
});
