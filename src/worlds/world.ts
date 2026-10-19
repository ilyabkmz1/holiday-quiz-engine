import { z } from "zod";

const pct = z.number().min(0).max(100);
const point = z.tuple([pct, pct]);
const id = z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,40}$/);
const artPath = z.string().regex(/^\/[A-Za-z0-9/_.-]+\.(webp|jpg|jpeg|png)$/).refine((path) => !path.includes(".."), "Без «..» в пути");

/** Огни поверх иллюстрации (проценты картинки): гирлянда, лампы на ёлке, звезда и свечение ёлки (`glowSize` — % ширины). */
export const lightSetSchema = z.object({
  garland: z.array(point),
  tree: z.array(point),
  star: point,
  glow: point,
  glowSize: z.number().positive()
});
export type LightSet = z.infer<typeof lightSetSchema>;

/**
 * Мир: иллюстрация и разметка поверх неё. Все координаты — проценты картинки (x слева направо, y сверху вниз),
 * кроме `globeRect`/`rushRect` (мировые пиксели). Мир не содержит контента бизнеса: герои, тексты и призы живут в пакете.
 */
export const worldSchema = z.object({
  id,
  title: z.string().min(1),
  /** Иллюстрация мира; файл лежит при мире: `public/worlds/<id>/`. */
  art: z.object({ src: artPath, width: z.number().int().positive(), height: z.number().int().positive() }),
  /** Огни на иллюстрации мира и ореол вокруг робота. */
  lights: lightSetSchema.extend({ halo: point }),
  /** Кроп робота-админа из иллюстрации для аватарки: `width` — ширина картинки (px) при аватарке 56 px, `x`/`y` — сдвиг в долях размера аватарки. */
  robotCrop: z.object({ width: z.number().positive(), x: z.number(), y: z.number() }),
  /** Узел старта игрока и узел «у ёлки» (сюда летят игрушки). */
  start: id,
  tree: id,
  /** Узел, где стоит игрок в раунде рывка (вне кнопок сервисов). */
  rushStand: id,
  nodes: z.array(z.object({ id, x: pct, y: pct, label: z.string().optional() })).min(2),
  edges: z.array(z.tuple([id, id])).min(1),
  /** Точки зон: к ним привязываются зоны пакета (`room.spotId`, по умолчанию id зоны). */
  spots: z
    .array(
      z.object({
        id,
        /** Площадка перед комнатой — узел графа, куда приходит игрок. */
        pad: id,
        /** Где стоит герой и куда смотрит. */
        hero: z.object({ x: pct, y: pct, face: z.enum(["left", "right"]) }),
        /** Прямоугольник комнаты на картинке (затемнение, свечение). */
        box: z.object({ x: pct, y: pct, w: pct, h: pct }),
        /** Площадка героя у ёлки в раунде рывка. */
        rush: point,
        /** Положение кнопки зоны на карте режима cards. */
        card: z.object({ x: pct, y: pct }),
        /** Иллюстрация зоны для карточного режима; без неё показывается иллюстрация мира. */
        art: artPath.optional(),
        /** Огни на иллюстрации зоны (нужны вместе с `art`). */
        lights: lightSetSchema.optional()
      })
    )
    .min(1),
  /** Куда на ёлке вешается игрушка по номеру зоны в кампании. */
  treeSlots: z.array(point).min(1),
  globeRect: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
  rushRect: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
  robotHome: point,
  star: point
});

export type World = z.infer<typeof worldSchema>;

/** Проверки, которые схема выразить не может: ссылки между частями и проходимость. Пустой список — мир годен. */
export function worldIssues(world: World): string[] {
  const issues: string[] = [];
  const nodeIds = new Set(world.nodes.map((node) => node.id));
  if (nodeIds.size !== world.nodes.length) issues.push("узлы: повторяющиеся id");
  const spotIds = world.spots.map((spot) => spot.id);
  if (new Set(spotIds).size !== spotIds.length) issues.push("споты: повторяющиеся id");
  if (!nodeIds.has(world.start)) issues.push(`start: узла «${world.start}» нет`);
  if (!nodeIds.has(world.tree)) issues.push(`tree: узла «${world.tree}» нет`);
  if (!nodeIds.has(world.rushStand)) issues.push(`rushStand: узла «${world.rushStand}» нет`);
  for (const [from, to] of world.edges) {
    if (!nodeIds.has(from) || !nodeIds.has(to)) issues.push(`ребро ${from}—${to}: неизвестный узел`);
    if (from === to) issues.push(`ребро ${from}—${to}: петля`);
  }
  for (const spot of world.spots) {
    if (spot.lights && !spot.art) issues.push(`спот ${spot.id}: огни заданы, а иллюстрации (art) нет`);
    if (!nodeIds.has(spot.pad)) issues.push(`спот ${spot.id}: площадки «${spot.pad}» нет среди узлов`);
  }
  if (world.treeSlots.length < world.spots.length) issues.push(`treeSlots: ${world.treeSlots.length} мест на ёлке при ${world.spots.length} спотах`);

  // Достижимость от старта обходом в ширину.
  const adjacent = new Map<string, string[]>();
  for (const [from, to] of world.edges) {
    adjacent.set(from, [...(adjacent.get(from) ?? []), to]);
    adjacent.set(to, [...(adjacent.get(to) ?? []), from]);
  }
  const reached = new Set<string>([world.start]);
  const queue = [world.start];
  while (queue.length > 0) {
    for (const next of adjacent.get(queue.shift()!) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  const lost = world.nodes.filter((node) => !reached.has(node.id)).map((node) => node.id);
  if (lost.length > 0) issues.push(`граф не связный: из старта не достичь ${lost.join(", ")}`);
  for (const spot of world.spots) {
    if (nodeIds.has(spot.pad) && !reached.has(spot.pad)) issues.push(`спот ${spot.id}: площадка «${spot.pad}» недостижима от старта`);
  }
  if (nodeIds.has(world.tree) && !reached.has(world.tree)) issues.push("ёлка недостижима от старта");
  return issues;
}

/** Разбор и проверка мира; бросает с перечнем всех проблем. */
export function parseWorld(raw: unknown): World {
  const world = worldSchema.parse(raw);
  const issues = worldIssues(world);
  if (issues.length > 0) throw new Error(`Мир «${world.id}» не годен: ${issues.join("; ")}`);
  return world;
}

/** Зона кампании для привязки к точке мира. */
export type BindableRoom = { id: string; spotId?: string; map: { x: number; y: number } };

/**
 * Привязка зон пакета к точкам мира: ошибки блокируют запуск (и `quiz:check`, и старт приложения),
 * предупреждения — на усмотрение человека. `spotId` зоны не обязан совпадать с её id.
 */
export function roomBindingReport(world: World, rooms: ReadonlyArray<BindableRoom>, mode: "cards" | "quest"): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (rooms.length > world.spots.length) errors.push(`зон ${rooms.length}, а в мире ${world.id} всего ${world.spots.length} точек`);
  const spotIds = world.spots.map((spot) => spot.id);
  const used = new Map<string, string>();
  for (const room of rooms) {
    const spotId = room.spotId ?? room.id;
    const spot = world.spots.find((candidate) => candidate.id === spotId);
    if (!spot) {
      if (room.spotId || mode === "quest") errors.push(`зона ${room.id}: точки «${spotId}» нет в мире ${world.id} (есть: ${spotIds.join(", ")})`);
      else warnings.push(`зона ${room.id}: не привязана к точке мира (spotId), кнопка стоит по координатам map`);
      continue;
    }
    if (used.has(spot.id)) errors.push(`зоны ${used.get(spot.id)} и ${room.id} привязаны к одной точке «${spot.id}»`);
    used.set(spot.id, room.id);
    if (Math.hypot(room.map.x - spot.card.x, room.map.y - spot.card.y) > 2) {
      warnings.push(`зона ${room.id}: map (${room.map.x}, ${room.map.y}) не совпадает с точкой «${spot.id}» (${spot.card.x}, ${spot.card.y}) — кнопка окажется не на комнате`);
    }
  }
  if (mode === "quest" && world.spots.length !== rooms.length) {
    warnings.push(`mode "quest": в мире ${world.spots.length} точек, а зон ${rooms.length}: лишние комнаты останутся пустыми`);
  }
  return { errors, warnings };
}
