import { distance, neighborInDirection, planFrom, type Direction, type Graph, type Point } from "@/components/quest/pathfinding";

/**
 * Чистая симуляция ходьбы персонажа по графу мира: без DOM, времени и случайности.
 * Компонент мира вызывает `stepSim` каждый кадр и применяет результат к DOM; тесты гоняют
 * ту же функцию без браузера (движение, клавиши, близость героев, тупики графа).
 */

export type PlayerPose = "idle" | "walk" | "run" | "joy";

/** Скорость ходьбы, единиц мира (пикселей иллюстрации) в секунду: в 1,3 раза быстрее прототипа (250). */
export const WALK_SPEED = 325;
/** Бег на длинных маршрутах. */
export const RUN_SPEED = 470;
/** Маршрут длиннее этого значения проходится бегом. */
export const RUN_THRESHOLD = 360;
export const ACCELERATION = 1100;
export const DECELERATION = 1500;
export const NEAR_RADIUS = 125;
/** Пауза между остановкой на площадке и открытием карточки: персонаж успевает повернуться к герою. */
export const TURN_DELAY = 0.34;

export type SimState = {
  x: number;
  y: number;
  /** Последний пройденный узел; персонаж находится в нём или на ребре от него к `next`. */
  last: string;
  next: string | null;
  path: string[];
  facing: 1 | -1;
  speed: number;
  moving: boolean;
  running: boolean;
  keys: Direction[];
  idleSeconds: number;
  /** Комната героя в радиусе общения. */
  near: string | null;
  /** Идём к площадке героя, чтобы открыть заявку. */
  approach: { roomId: string; waited: number } | null;
};

export type SimHero = { roomId: string; pos: Point };

export type SimInput = {
  graph: Graph;
  heroes: ReadonlyArray<SimHero>;
  /** Открыта карточка или список комнат: ходьба на паузе, клавиши не читаются. */
  frozen: boolean;
  /** Reduced motion: перемещение мгновенное. */
  instant: boolean;
};

export type SimEvent =
  | { type: "stopped" }
  | { type: "approached"; roomId: string }
  | { type: "nearChanged"; roomId: string | null };

export function initialSim(graph: Graph, start: string): SimState {
  const node = graph.nodes.get(start)!;
  return {
    x: node.x, y: node.y, last: start, next: null, path: [], facing: 1, speed: 0, moving: false, running: false,
    keys: [], idleSeconds: 0, near: null, approach: null
  };
}

function pathLength(graph: Graph, state: Pick<SimState, "x" | "y" | "path">): number {
  let total = 0;
  let at: Point = { x: state.x, y: state.y };
  for (const id of state.path) {
    const node = graph.nodes.get(id)!;
    total += distance(at, node);
    at = node;
  }
  return total;
}

function teleport(graph: Graph, state: SimState, nodeId: string): SimState {
  const node = graph.nodes.get(nodeId)!;
  return { ...state, x: node.x, y: node.y, last: nodeId, next: null, path: [], speed: 0, moving: false, running: false, keys: [] };
}

/** Команда «идти к узлу». С `approachRoom` по прибытии персонаж повернётся к герою и выдаст `approached`. */
export function commandGo(graph: Graph, state: SimState, nodeId: string, options: { instant?: boolean; approachRoom?: string } = {}): SimState {
  if (!graph.nodes.has(nodeId)) return state;
  const base: SimState = { ...state, idleSeconds: 0, approach: options.approachRoom ? { roomId: options.approachRoom, waited: 0 } : null };
  if (options.instant) return teleport(graph, base, nodeId);
  const plan = planFrom(graph, { x: state.x, y: state.y }, state.last, state.next, nodeId);
  if (!plan) return base;
  const next: SimState = { ...base, path: plan.path, next: plan.path[0] ?? null };
  return { ...next, running: plan.length > RUN_THRESHOLD };
}

/** Новая стрелка отменяет маршрут, заданный касанием, но дорогу до ближайшего узла доводит. */
export function pressKey(state: SimState, direction: Direction, repeat = false): SimState {
  const keys = state.keys.filter((key) => key !== direction);
  keys.push(direction);
  const path = !repeat && state.path.length > 1 ? state.path.slice(0, 1) : state.path;
  return { ...state, keys, path, approach: null };
}

export function releaseKey(state: SimState, direction: Direction): SimState {
  return { ...state, keys: state.keys.filter((key) => key !== direction) };
}

export function clearKeys(state: SimState): SimState {
  return state.keys.length === 0 ? state : { ...state, keys: [] };
}

function nearestHero(state: SimState, heroes: ReadonlyArray<SimHero>): { hero: SimHero; distance: number } | null {
  let best: { hero: SimHero; distance: number } | null = null;
  for (const hero of heroes) {
    const d = Math.hypot(hero.pos.x - state.x, hero.pos.y - state.y);
    if (d < NEAR_RADIUS && (!best || d < best.distance)) best = { hero, distance: d };
  }
  return best;
}

export function stepSim(state: SimState, input: SimInput, dt: number): { state: SimState; events: SimEvent[] } {
  const { graph } = input;
  const events: SimEvent[] = [];
  let s: SimState = { ...state };

  // Стрелки: сосед по направлению, когда нет маршрута.
  if (!input.frozen && s.path.length === 0 && s.keys.length > 0) {
    const wanted = neighborInDirection(graph, s.last, s.keys[s.keys.length - 1]);
    if (wanted) {
      s.idleSeconds = 0;
      s.running = false;
      s.approach = null;
      if (input.instant) {
        s = { ...teleport(graph, s, wanted), keys: [] };
        s.speed = 0;
      } else {
        s.path = [wanted];
        s.next = wanted;
      }
    }
  }

  let moving = false;
  if (s.path.length > 0 && !input.frozen) {
    const holdingKey = s.keys.length > 0;
    const maxSpeed = s.running ? RUN_SPEED : WALK_SPEED;
    const remaining = pathLength(graph, s);
    // Торможение у цели; при зажатой стрелке персонаж не замедляется на каждом узле.
    const brake = holdingKey ? maxSpeed : Math.max(70, Math.sqrt(2 * DECELERATION * remaining));
    const target = Math.min(maxSpeed, brake);
    s.speed = s.speed < target ? Math.min(target, s.speed + ACCELERATION * dt) : Math.max(target, s.speed - DECELERATION * dt);
    let budget = s.speed * dt;
    while (budget > 0 && s.path.length > 0) {
      const node = graph.nodes.get(s.path[0])!;
      const dx = node.x - s.x;
      const dy = node.y - s.y;
      const dist = Math.hypot(dx, dy);
      // На лестнице и в лифтах идут чуть медленнее.
      const slope = Math.abs(dy) > Math.abs(dx) * 0.8 ? 0.8 : 1;
      const reach = budget * slope;
      if (Math.abs(dx) > 1.5) s.facing = dx > 0 ? 1 : -1;
      if (dist <= reach) {
        s.x = node.x;
        s.y = node.y;
        budget -= dist / slope;
        s.last = node.id;
        s.path = s.path.slice(1);
        // Стрелка всё ещё зажата: следующий узел выбирается сразу, без остановки на каждом узле.
        if (s.path.length === 0 && s.keys.length > 0) {
          const wanted = neighborInDirection(graph, node.id, s.keys[s.keys.length - 1]);
          if (wanted) s.path = [wanted];
        }
        s.next = s.path[0] ?? null;
      } else {
        s.x += (dx / dist) * reach;
        s.y += (dy / dist) * reach;
        budget = 0;
        moving = true;
      }
    }
    if (s.path.length === 0) {
      moving = false;
      s.speed = 0;
      s.running = false;
      events.push({ type: "stopped" });
    }
  } else if (!input.frozen) {
    s.speed = 0;
  }
  s.moving = moving;
  s.idleSeconds = moving ? 0 : s.idleSeconds + dt;

  // Близость героя; остановившись рядом с ним, персонаж смотрит на героя.
  const close = nearestHero(s, input.heroes);
  const near = close?.hero.roomId ?? null;
  if (near !== s.near) {
    s.near = near;
    events.push({ type: "nearChanged", roomId: near });
  }
  if (!moving && close && Math.abs(close.hero.pos.x - s.x) > 8) s.facing = close.hero.pos.x >= s.x ? 1 : -1;

  // К площадке героя дошли: повернуться и через короткую паузу открыть заявку.
  if (s.approach && !moving && s.path.length === 0 && !input.frozen) {
    const hero = input.heroes.find((candidate) => candidate.roomId === s.approach!.roomId);
    if (hero && Math.abs(hero.pos.x - s.x) > 8) s.facing = hero.pos.x >= s.x ? 1 : -1;
    const waited = s.approach.waited + (input.instant ? TURN_DELAY : dt);
    if (waited >= TURN_DELAY) {
      events.push({ type: "approached", roomId: s.approach.roomId });
      s.approach = null;
    } else {
      s.approach = { roomId: s.approach.roomId, waited };
    }
  }
  return { state: s, events };
}

export function poseOf(state: SimState, joy: boolean): PlayerPose {
  if (joy) return "joy";
  if (!state.moving) return "idle";
  return state.running ? "run" : "walk";
}
