import { describe, expect, it } from "vitest";

import {
  buildGraph,
  isConnected,
  nearestNode,
  neighborInDirection,
  planFrom,
  shortestPath
} from "@/components/quest/pathfinding";
import { EDGES, NODES, ROOM_SPOTS, RUSH_SPOTS, START_NODE, TREE_NODE, TREE_SLOTS, WORLD_H, WORLD_W } from "../support/world";
import { campaign } from "@tenants/demo-office/campaign";

const toWorld = (p: { x: number; y: number }) => ({ x: (p.x / 100) * WORLD_W, y: (p.y / 100) * WORLD_H });
const world = buildGraph(NODES, EDGES, toWorld);

describe("поиск пути по графу", () => {
  const small = buildGraph(
    [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 10, y: 0 },
      { id: "c", x: 10, y: 10 },
      { id: "d", x: 0, y: 10 },
      { id: "far", x: 100, y: 100 }
    ],
    [
      ["a", "b"],
      ["b", "c"],
      ["a", "d"],
      ["d", "c"]
    ]
  );

  it("находит кратчайший по длине путь, а не по числу рёбер", () => {
    const graph = buildGraph(
      [
        { id: "a", x: 0, y: 0 },
        { id: "m", x: 50, y: 0 },
        { id: "b", x: 100, y: 0 },
        { id: "up", x: 50, y: 80 }
      ],
      [
        ["a", "up"],
        ["up", "b"],
        ["a", "m"],
        ["m", "b"]
      ]
    );
    expect(shortestPath(graph, "a", "b")?.path).toEqual(["a", "m", "b"]);
    expect(shortestPath(graph, "a", "b")?.length).toBeCloseTo(100);
  });

  it("путь в тот же узел состоит из него одного; несвязанный узел недостижим", () => {
    expect(shortestPath(small, "a", "a")).toEqual({ path: ["a"], length: 0 });
    expect(shortestPath(small, "a", "far")).toBeNull();
    expect(shortestPath(small, "a", "нет")).toBeNull();
  });

  it("отвергает рёбра к неизвестным узлам и дубли", () => {
    expect(() => buildGraph([{ id: "a", x: 0, y: 0 }], [["a", "z"]])).toThrow();
    expect(() => buildGraph([{ id: "a", x: 0, y: 0 }, { id: "a", x: 1, y: 1 }], [])).toThrow();
  });

  it("ближайший узел и выбор соседа по стрелке", () => {
    expect(nearestNode(small, { x: 9, y: 9 }).id).toBe("c");
    expect(neighborInDirection(small, "a", "right")).toBe("b");
    expect(neighborInDirection(small, "a", "down")).toBe("d");
    expect(neighborInDirection(small, "a", "left")).toBeNull();
    expect(neighborInDirection(small, "a", "up")).toBeNull();
  });

  it("на ребре можно развернуться: путь стартует с ближайшего к цели конца", () => {
    // игрок между a и b, ближе к b, цель — a: разворот через a короче, чем обход через b, c, d
    const back = planFrom(small, { x: 7, y: 0 }, "a", "b", "a");
    expect(back?.path).toEqual(["a"]);
    expect(back?.length).toBeCloseTo(7);
    const forward = planFrom(small, { x: 7, y: 0 }, "a", "b", "c");
    expect(forward?.path).toEqual(["b", "c"]);
  });
});

describe("граф мира", () => {
  it("связный: из точки старта можно дойти до любой точки", () => {
    expect(isConnected(world)).toBe(true);
  });

  it("площадка каждой комнаты кампании есть в графе и достижима от входа и от ёлки", () => {
    expect(ROOM_SPOTS.map((spot) => spot.roomId).sort()).toEqual(campaign.rooms.map((room) => room.id).sort());
    for (const spot of ROOM_SPOTS) {
      expect(world.nodes.has(spot.pad), spot.pad).toBe(true);
      expect(shortestPath(world, START_NODE, spot.pad)).not.toBeNull();
      expect(shortestPath(world, TREE_NODE, spot.pad)).not.toBeNull();
    }
  });

  it("у каждой комнаты кампании есть площадка, место на ёлке и место в рывке у ёлки", () => {
    campaign.rooms.forEach((room, index) => {
      const spot = ROOM_SPOTS.find((candidate) => candidate.roomId === room.id);
      expect(spot, room.id).toBeDefined();
      expect(TREE_SLOTS[index], room.id).toBeDefined();
      expect(RUSH_SPOTS[room.id], room.id).toBeDefined();
      expect(room.hostId).toBeTruthy();
    });
    expect(TREE_SLOTS.length).toBeGreaterThanOrEqual(campaign.rooms.length);
  });

  it("узел у ёлки не тупик для стрелок: влево и вправо есть куда идти, вверх идёт через одного", () => {
    expect(neighborInDirection(world, TREE_NODE, "left")).toBe("ringL");
    expect(neighborInDirection(world, TREE_NODE, "right")).toBe("ringR");
    // Прямого соседа выше ёлки нет, но через одного достижим лифт: стрелка не глохнет.
    expect(neighborInDirection(world, TREE_NODE, "up")).not.toBeNull();
  });

  it("все точки лежат внутри картинки", () => {
    for (const node of NODES) {
      expect(node.x).toBeGreaterThan(0);
      expect(node.x).toBeLessThan(100);
      expect(node.y).toBeGreaterThan(0);
      expect(node.y).toBeLessThan(100);
    }
  });

  it("от входа до Почтовой (зона mail) путь идёт по лестнице и лифту, а не напрямик", () => {
    const route = shortestPath(world, START_NODE, "mailPad")!;
    expect(route.path[0]).toBe("gate");
    expect(route.path).toContain("walkL");
    expect(route.path.at(-1)).toBe("mailPad");
    // нет «телепортов»: каждый шаг пути — ребро графа
    for (let i = 1; i < route.path.length; i += 1) {
      expect(world.adjacency.get(route.path[i - 1])!.some((next) => next.id === route.path[i])).toBe(true);
    }
  });
});
