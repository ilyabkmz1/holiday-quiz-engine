import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { packSchema } from "@/config/pack";
import { commandGo, initialSim, stepSim } from "@/components/quest/sim";
import { shortestPath } from "@/components/quest/pathfinding";
import { publicCampaign } from "@/server/presentation";
import { loadTenants } from "@/server/tenants";
import { checkPack } from "@/tools/pack-check";
import { buildTemplate } from "@/tools/template";
import { buildWorldModel, roomArt } from "@/worlds/model";
import { loadWorld, overrideWorlds } from "@/worlds/registry";
import { parseWorld, worldIssues, worldSchema } from "@/worlds/world";
import coffeePack from "@tenants/demo-coffee/pack.json";
import { pack as officePack } from "@tenants/demo-office/pack";
import ring from "../fixtures/worlds/ring.json";

// Второй мир-фикстура: другой граф и точки, та же картинка. Движок обязан работать с ним без правок кода.
beforeEach(() => overrideWorlds({ "ring-fixture": ring }));
afterEach(() => overrideWorlds(null));

const coffee = () => structuredClone(coffeePack) as unknown as { worldId: string; campaign: { mode: string; rooms: Array<{ id: string; spotId?: string; map: { x: number; y: number } }> } };
/** Пакет кофейни на фикстуре: зоны привязаны к точкам spot-a…c, id зон не совпадают с id точек. */
function onRing(mode: "cards" | "quest") {
  const pack = coffee();
  pack.worldId = "ring-fixture";
  pack.campaign.mode = mode;
  const world = loadWorld("ring-fixture");
  pack.campaign.rooms.forEach((room, index) => {
    room.spotId = world.spots[index].id;
    room.map = world.spots[index].card;
  });
  return pack;
}

describe("мир-фикстура ring-fixture", () => {
  it("проходит схему и отличается от snow-globe графом", () => {
    const world = loadWorld("ring-fixture");
    expect(worldIssues(world)).toEqual([]);
    expect(world.nodes.length).not.toBe(loadWorld("snow-globe").nodes.length);
    expect(world.spots.map((spot) => spot.id)).toEqual(["spot-a", "spot-b", "spot-c"]);
  });

  it("огни без иллюстрации точки — ошибка; ссылка на несуществующий узел rushStand — ошибка", () => {
    const withoutArt = structuredClone(ring) as typeof ring & { spots: Array<Record<string, unknown>> };
    delete withoutArt.spots[0].art;
    expect(worldIssues(worldSchema.parse(withoutArt)).join("\n")).toContain("огни заданы");
    expect(() => parseWorld({ ...ring, rushStand: "nowhere" })).toThrow(/rushStand/);
  });
});

describe("модель мира для зон со своим spotId", () => {
  const rooms = [{ id: "beans", spotId: "spot-a" }, { id: "brew", spotId: "spot-b" }, { id: "care", spotId: "spot-c" }];
  const model = () => buildWorldModel(loadWorld("ring-fixture"), rooms);

  it("точки находятся по id зоны, а не по id точки", () => {
    const { SPOTS, spotOf } = model();
    expect(SPOTS.map((spot) => spot.roomId)).toEqual(["beans", "brew", "care"]);
    expect(spotOf("beans")?.spotId).toBe("spot-a");
    expect(spotOf("spot-a")).toBeUndefined();
    expect(spotOf("beans")?.pad).toBe("padA");
  });

  it("граф связный: от старта до каждой площадки и ёлки есть путь", () => {
    const { GRAPH, SPOTS, START_NODE, TREE_NODE } = model();
    for (const target of [...SPOTS.map((spot) => spot.pad), TREE_NODE]) expect(shortestPath(GRAPH, START_NODE, target), target).not.toBeNull();
  });

  it("симуляция ходьбы доходит до площадки зоны на этом мире", () => {
    const { GRAPH, SPOTS, START_NODE } = model();
    const heroes = SPOTS.map((spot) => ({ roomId: spot.roomId, pos: spot.heroPos }));
    let state = commandGo(GRAPH, initialSim(GRAPH, START_NODE), SPOTS[0].pad);
    for (let i = 0; i < 60 * 30; i += 1) state = stepSim(state, { graph: GRAPH, heroes, frozen: false, instant: false }, 1 / 60).state;
    expect(state.last).toBe(SPOTS[0].pad);
  });

  it("искорки и подсветка пути строятся по рёбрам мира", () => {
    const { BONUSES, EDGES, GRAPH, START_NODE, SPOTS, leadFlakes } = model();
    expect(new Set(BONUSES.map((bonus) => bonus.edge)).size).toBe(EDGES.length);
    const route = shortestPath(GRAPH, START_NODE, SPOTS[1].pad)!;
    expect(leadFlakes(route.path).size).toBeGreaterThan(0);
  });

  it("зона на несуществующей точке — понятная ошибка", () => {
    expect(() => buildWorldModel(loadWorld("ring-fixture"), [{ id: "beans", spotId: "mail" }])).toThrow(/нет точки «mail»/);
  });

  it("иллюстрация зоны: своя у точки с art, иначе иллюстрация мира без огней", () => {
    const world = loadWorld("ring-fixture");
    expect(roomArt(world, { id: "beans", spotId: "spot-a" })).toEqual({ src: "/worlds/snow-globe/room-mail.webp", lights: world.spots[0].lights });
    expect(roomArt(world, { id: "brew", spotId: "spot-b" })).toEqual({ src: world.art.src });
    expect(roomArt(world, { id: "unknown" })).toEqual({ src: world.art.src });
  });
});

describe("пакет выбирает мир", () => {
  it("публичный срез несёт worldId пакета и точку зоны", () => {
    const pack = packSchema.parse(onRing("quest"));
    const view = publicCampaign(pack.campaign, pack.worldId);
    expect(view.worldId).toBe("ring-fixture");
    expect(view.rooms.map((room) => room.spotId)).toEqual(["spot-a", "spot-b", "spot-c"]);
    // Без второго аргумента — мир по умолчанию (snow-globe).
    expect(publicCampaign(packSchema.parse(officePack).campaign).worldId).toBe("snow-globe");
    expect(publicCampaign(packSchema.parse(officePack).campaign).rooms[0].spotId).toBe("mail");
  });

  it("квест на чужом мире со spotId ≠ id зоны проходит quiz:check", async () => {
    const report = await checkPack(onRing("quest"));
    expect(report.errors).toEqual([]);
  });

  it("реестр арендаторов не стартует с неизвестным миром и с битой привязкой зон", () => {
    expect(() => loadTenants([packSchema.parse(onRing("quest"))])).not.toThrow();
    expect(() => loadTenants([{ ...packSchema.parse(onRing("quest")), worldId: "no-such-world" }])).toThrow(/не найден/);
    const broken = onRing("quest");
    broken.campaign.rooms[0].spotId = "mail";
    expect(() => loadTenants([packSchema.parse(broken)])).toThrow(/нет в мире ring-fixture/);
    const twice = onRing("quest");
    twice.campaign.rooms[1].spotId = "spot-a";
    expect(() => loadTenants([packSchema.parse(twice)])).toThrow(/одной точке/);
  });

  it("заготовка quiz:new берёт точки выбранного мира", () => {
    const template = buildTemplate({ tenant: "demo-shop", zones: 3, worldId: "ring-fixture" }) as { worldId: string; campaign: { rooms: Array<{ spotId: string }> } };
    expect(template.worldId).toBe("ring-fixture");
    expect(template.campaign.rooms.map((room) => room.spotId)).toEqual(["spot-a", "spot-b", "spot-c"]);
    expect(packSchema.safeParse(template).success).toBe(true);
  });
});
