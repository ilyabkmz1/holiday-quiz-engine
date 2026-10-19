import { buildGraph, distance, type Graph, type Point } from "@/components/quest/pathfinding";
import type { LightSet, World } from "@/worlds/world";

/** Зона кампании, которой нужна точка мира: `spotId` по умолчанию совпадает с id зоны. */
export type WorldRoom = { id: string; spotId?: string };

export type Spot = {
  /** id зоны кампании: по нему игра находит точку. */
  roomId: string;
  /** id точки мира (`world.spots[].id`). */
  spotId: string;
  pad: string;
  hero: { x: number; y: number; face: "left" | "right" };
  box: { x: number; y: number; w: number; h: number };
  heroPos: Point;
  padPos: Point;
  center: Point;
  rushPos: Point;
};

export type Bonus = { id: string; x: number; y: number; edge: number };

export type Rect = { x: number; y: number; w: number; h: number };

/** На сколько мировых пикселей выше ног героя стоит нижний край маяка «!»: сразу над головой, в рамке своей комнаты. */
export const POINTER_LIFT = 70;

/** Мировая точка маяка цели: над головой героя комнаты, а не этажом выше. */
export function pointerAnchor(spot: Pick<Spot, "heroPos">): Point {
  return { x: spot.heroPos.x, y: spot.heroPos.y - POINTER_LIFT };
}

/** Иллюстрация зоны для карточного режима: своя у точки мира, иначе иллюстрация мира; огни есть только у своей. */
export function roomArt(world: World, room: WorldRoom): { src: string; lights?: LightSet } {
  const spot = world.spots.find((candidate) => candidate.id === (room.spotId ?? room.id));
  return spot?.art ? { src: spot.art, lights: spot.lights } : { src: world.art.src };
}

const FLAKE_SPACING = 120;

/**
 * Всё, что игра считает из `world.json` и списка зон кампании: граф, точки зон в мировых пикселях, искорки-бонусы.
 * Чистая функция: клиент строит модель один раз на мир, тесты — для любого мира (в том числе фикстуры с другим графом).
 */
export function buildWorldModel(world: World, rooms: ReadonlyArray<WorldRoom>) {
  const WORLD_W = world.art.width;
  const WORLD_H = world.art.height;
  const toWorld = (p: Point): Point => ({ x: (p.x / 100) * WORLD_W, y: (p.y / 100) * WORLD_H });

  const NODES = world.nodes;
  const EDGES: ReadonlyArray<readonly [string, string]> = world.edges;
  const GRAPH: Graph = buildGraph(NODES, EDGES, toWorld);

  const SPOTS: Spot[] = rooms.map((room) => {
    const spotId = room.spotId ?? room.id;
    const spot = world.spots.find((candidate) => candidate.id === spotId);
    if (!spot) throw new Error(`Зона «${room.id}»: в мире «${world.id}» нет точки «${spotId}»`);
    return {
      roomId: room.id,
      spotId,
      pad: spot.pad,
      hero: spot.hero,
      box: spot.box,
      heroPos: toWorld(spot.hero),
      padPos: GRAPH.nodes.get(spot.pad)!,
      center: toWorld({ x: spot.box.x + spot.box.w / 2, y: spot.box.y + spot.box.h / 2 }),
      rushPos: toWorld({ x: spot.rush[0], y: spot.rush[1] })
    };
  });

  const spotOf = (roomId: string): Spot | undefined => SPOTS.find((spot) => spot.roomId === roomId);

  /** Куда на ёлке вешается игрушка комнаты (по номеру комнаты в кампании). */
  const treeSlot = (roomIndex: number): Point => {
    const slot = world.treeSlots[roomIndex] ?? world.treeSlots[0];
    return toWorld({ x: slot[0], y: slot[1] });
  };

  /** Искорки-бонусы: по одной на каждые ~120 единиц дорожки, в серединах отрезков. Только косметика. */
  const BONUSES: Bonus[] = [];
  EDGES.forEach(([a, b], edge) => {
    const from = GRAPH.nodes.get(a)!;
    const to = GRAPH.nodes.get(b)!;
    const count = Math.max(1, Math.round(distance(from, to) / FLAKE_SPACING));
    for (let i = 0; i < count; i += 1) {
      const t = (i + 0.5) / count;
      BONUSES.push({ id: `${edge}:${i}`, x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t - 8, edge });
    }
  });

  const edgeIndex = new Map<string, number>();
  EDGES.forEach(([a, b], index) => {
    edgeIndex.set(`${a}|${b}`, index);
    edgeIndex.set(`${b}|${a}`, index);
  });

  /** Искорки на пути от узла к цели: они подсвечиваются и «ведут» игрока. */
  const leadFlakes = (path: ReadonlyArray<string>): Set<string> => {
    const edges = new Set<number>();
    for (let i = 1; i < path.length; i += 1) {
      const edge = edgeIndex.get(`${path[i - 1]}|${path[i]}`);
      if (edge !== undefined) edges.add(edge);
    }
    return new Set(BONUSES.filter((bonus) => edges.has(bonus.edge)).map((bonus) => bonus.id));
  };

  return {
    id: world.id,
    WORLD_W,
    WORLD_H,
    toWorld,
    NODES,
    EDGES,
    GRAPH,
    SPOTS,
    spotOf,
    treeSlot,
    BONUSES,
    leadFlakes,
    START_NODE: world.start,
    TREE_NODE: world.tree,
    RUSH_STAND_NODE: world.rushStand,
    TREE_POS: GRAPH.nodes.get(world.tree)!,
    START_POS: GRAPH.nodes.get(world.start)!,
    STAR_POS: toWorld({ x: world.star[0], y: world.star[1] }),
    ROBOT_HOME_POS: toWorld({ x: world.robotHome[0], y: world.robotHome[1] }),
    GLOBE_RECT: world.globeRect as Rect,
    RUSH_RECT: world.rushRect as Rect,
    GLOBE_CENTER: { x: world.globeRect.x + world.globeRect.w / 2, y: world.globeRect.y + world.globeRect.h / 2 } as Point
  };
}

export type WorldModel = ReturnType<typeof buildWorldModel>;
