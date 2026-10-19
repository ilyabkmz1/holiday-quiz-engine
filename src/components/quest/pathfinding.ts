/** Поиск пути по графу проходимых точек мира. Чистые функции без DOM: покрываются юнит-тестами. */

export type Point = { x: number; y: number };
export type GraphNode = Point & { id: string };
export type Graph = {
  nodes: ReadonlyMap<string, GraphNode>;
  /** Соседи узла вместе с длиной ребра. */
  adjacency: ReadonlyMap<string, ReadonlyArray<{ id: string; length: number }>>;
};

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Строит граф. Координаты узлов приводятся к единицам мира функцией `toWorld`,
 * поэтому длины рёбер — в тех же единицах, что и скорость персонажа.
 */
export function buildGraph(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<readonly [string, string]>,
  toWorld: (p: Point) => Point = (p) => p
): Graph {
  const byId = new Map<string, GraphNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) throw new Error(`Дублирующийся узел графа: ${node.id}`);
    byId.set(node.id, { id: node.id, ...toWorld(node) });
  }
  const adjacency = new Map<string, Array<{ id: string; length: number }>>();
  for (const id of byId.keys()) adjacency.set(id, []);
  for (const [a, b] of edges) {
    const from = byId.get(a);
    const to = byId.get(b);
    if (!from || !to) throw new Error(`Ребро ссылается на неизвестный узел: ${a} — ${b}`);
    const length = distance(from, to);
    adjacency.get(a)!.push({ id: b, length });
    adjacency.get(b)!.push({ id: a, length });
  }
  return { nodes: byId, adjacency };
}

/** Алгоритм Дейкстры. Возвращает узлы пути включая оба конца и его длину; `null`, если пути нет. */
export function shortestPath(graph: Graph, from: string, to: string): { path: string[]; length: number } | null {
  if (!graph.nodes.has(from) || !graph.nodes.has(to)) return null;
  if (from === to) return { path: [from], length: 0 };
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  // Граф мал (десятки узлов): линейный поиск минимума проще и надёжнее кучи.
  for (;;) {
    let current: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!done.has(id) && d < best) {
        best = d;
        current = id;
      }
    }
    if (current === null) return null;
    if (current === to) break;
    done.add(current);
    for (const next of graph.adjacency.get(current) ?? []) {
      const candidate = best + next.length;
      if (candidate < (dist.get(next.id) ?? Infinity)) {
        dist.set(next.id, candidate);
        prev.set(next.id, current);
      }
    }
  }
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0])!);
  return { path, length: dist.get(to)! };
}

/** Ближайший к точке узел графа. */
export function nearestNode(graph: Graph, point: Point): GraphNode {
  let best: GraphNode | null = null;
  let bestDistance = Infinity;
  for (const node of graph.nodes.values()) {
    const d = distance(node, point);
    if (d < bestDistance) {
      bestDistance = d;
      best = node;
    }
  }
  if (!best) throw new Error("Граф пуст");
  return best;
}

/**
 * Путь от точки, лежащей на ребре `lastNode`—`nextNode` (или в узле `lastNode`), до цели.
 * Можно развернуться и выйти через любой конец ребра: выбирается более короткий вариант.
 */
export function planFrom(
  graph: Graph,
  position: Point,
  lastNode: string,
  nextNode: string | null,
  target: string
): { path: string[]; length: number } | null {
  const options = [lastNode, ...(nextNode && nextNode !== lastNode ? [nextNode] : [])];
  let best: { path: string[]; length: number } | null = null;
  for (const start of options) {
    const found = shortestPath(graph, start, target);
    if (!found) continue;
    const total = found.length + distance(position, graph.nodes.get(start)!);
    if (!best || total < best.length) best = { path: found.path, length: total };
  }
  return best;
}

export type Direction = "left" | "right" | "up" | "down";

const VECTORS: Record<Direction, Point> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 }
};

function bestInDirection(graph: Graph, from: string, candidates: ReadonlyArray<string>, want: Point): string | null {
  const origin = graph.nodes.get(from);
  if (!origin) return null;
  let best: string | null = null;
  let bestScore = 0.5;
  for (const id of candidates) {
    const node = graph.nodes.get(id)!;
    const length = distance(origin, node) || 1;
    const score = ((node.x - origin.x) * want.x + (node.y - origin.y) * want.y) / length;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

/**
 * Сосед узла, ближе всего лежащий по направлению стрелки (или `null`, если ни одно ребро
 * не идёт хотя бы приблизительно в эту сторону: угол к направлению не больше ~60°).
 * Если прямого соседа нет, выбирается сосед через одного: узел-тупик (например, у ёлки)
 * не должен глушить стрелку, пока дальше в этой стороне есть куда идти.
 */
export function neighborInDirection(graph: Graph, from: string, direction: Direction): string | null {
  const want = VECTORS[direction];
  const direct = (graph.adjacency.get(from) ?? []).map((next) => next.id);
  const found = bestInDirection(graph, from, direct, want);
  if (found) return found;
  const second = new Set<string>();
  for (const id of direct) for (const next of graph.adjacency.get(id) ?? []) if (next.id !== from && !direct.includes(next.id)) second.add(next.id);
  const far = bestInDirection(graph, from, [...second], want);
  if (!far) return null;
  // Идём к промежуточному узлу, который ближе всего к цели через одного.
  const target = graph.nodes.get(far)!;
  let via: string | null = null;
  let viaDistance = Infinity;
  for (const id of direct) {
    if (!(graph.adjacency.get(id) ?? []).some((next) => next.id === far)) continue;
    const d = distance(graph.nodes.get(id)!, target);
    if (d < viaDistance) {
      viaDistance = d;
      via = id;
    }
  }
  return via;
}

/** Все узлы достижимы из любого другого? Проверка целостности данных мира. */
export function isConnected(graph: Graph): boolean {
  const ids = [...graph.nodes.keys()];
  if (ids.length === 0) return true;
  const seen = new Set<string>([ids[0]]);
  const queue = [ids[0]];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of graph.adjacency.get(id) ?? []) {
      if (!seen.has(next.id)) {
        seen.add(next.id);
        queue.push(next.id);
      }
    }
  }
  return seen.size === ids.length;
}
