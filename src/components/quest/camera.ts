import type { Point } from "@/components/quest/pathfinding";

/** Свободные поля вьюпорта: HUD сверху, док снизу, карточка задания справа (десктоп) или снизу (телефон). */
export type Insets = { top: number; right: number; bottom: number; left: number };

export const MOBILE_BREAKPOINT = 760;

export type Rect = { x: number; y: number; w: number; h: number };

/** Размеры мира, от которых зависит камера: иллюстрация, контур шара и общий план рывка (из `WorldModel`). */
export type CameraWorld = { WORLD_W: number; WORLD_H: number; GLOBE_RECT: Rect; RUSH_RECT: Rect };

/** Допустимый сдвиг мира по одной оси: границы покрывают вьюпорт, а если границы уже вьюпорта — центрируются. */
function axisRange(viewport: number, scale: number, start: number, size: number, over: number): [lo: number, hi: number] {
  const lo = viewport - (start + size) * scale - over;
  const hi = -start * scale || 0;
  if (lo <= hi) return [lo, hi];
  const centered = (viewport - size * scale) / 2 - start * scale;
  return [centered, centered];
}

/**
 * Масштаб мира (CSS-пикселей на пиксель иллюстрации).
 * Телефон: ~0.95 — на экране 390 px шириной это 2–2,2× относительно «картинка целиком по ширине».
 * Десктоп: шар (84% высоты картинки) почти целиком по высоте окна, не больше 1,25.
 * Мир всегда покрывает вьюпорт.
 */
export function cameraScale(vw: number, vh: number, { WORLD_W, WORLD_H }: Pick<CameraWorld, "WORLD_W" | "WORLD_H">): number {
  const cover = Math.max(vw / WORLD_W, vh / WORLD_H);
  const base = vw < MOBILE_BREAKPOINT ? 0.95 : Math.min(1.25, vh / (0.84 * WORLD_H));
  return Math.max(cover, base);
}

/**
 * Куда сдвинуть мир, чтобы точка `focus` оказалась в центре свободной области.
 * Края мира не уходят внутрь вьюпорта; `overscroll` (карточка задания) разрешает
 * подвинуть мир дальше, чтобы герой в нижней части картинки был виден над карточкой.
 */
export function cameraTarget(args: {
  vw: number;
  vh: number;
  scale: number;
  focus: Point;
  insets: Insets;
  overscroll?: { right: number; bottom: number };
  /** Область мира, за которую камера не выходит (по умолчанию весь мир; в игре — контур шара). */
  bounds?: Rect;
  world: Pick<CameraWorld, "WORLD_W" | "WORLD_H">;
}): Point {
  const { vw, vh, scale, focus, insets } = args;
  const bounds = args.bounds ?? { x: 0, y: 0, w: args.world.WORLD_W, h: args.world.WORLD_H };
  const over = args.overscroll ?? { right: 0, bottom: 0 };
  const cx = insets.left + (vw - insets.left - insets.right) / 2;
  const cy = insets.top + (vh - insets.top - insets.bottom) / 2;
  const [minX, maxX] = axisRange(vw, scale, bounds.x, bounds.w, over.right);
  const [minY, maxY] = axisRange(vh, scale, bounds.y, bounds.h, over.bottom);
  return {
    x: Math.max(minX, Math.min(maxX, cx - focus.x * scale)),
    y: Math.max(minY, Math.min(maxY, cy - focus.y * scale))
  };
}

export type Camera = { x: number; y: number; scale: number };

/** Камера, в которой `rect` целиком виден в свободной области вьюпорта (общий план: пролог, праздник, рывок, финал). */
export function fitCamera(args: { vw: number; vh: number; rect: Rect; insets: Insets; maxScale?: number }): Camera {
  const { vw, vh, rect, insets } = args;
  const availW = Math.max(1, vw - insets.left - insets.right);
  const availH = Math.max(1, vh - insets.top - insets.bottom);
  const scale = Math.min(args.maxScale ?? Infinity, availW / rect.w, availH / rect.h);
  return {
    scale,
    x: insets.left + availW / 2 - (rect.x + rect.w / 2) * scale,
    y: insets.top + availH / 2 - (rect.y + rect.h / 2) * scale
  };
}

/** Плавное приближение камеры к цели (экспоненциальное сглаживание); `snap` ставит её сразу. */
export function stepCamera(current: Camera | null, goal: Camera, dt: number, snap: boolean, rate = 5): Camera {
  if (!current || snap) return goal;
  const k = 1 - Math.exp(-dt * rate);
  return {
    x: current.x + (goal.x - current.x) * k,
    y: current.y + (goal.y - current.y) * k,
    scale: current.scale + (goal.scale - current.scale) * k
  };
}

export type CameraStage = "prologue" | "explore" | "room" | "celebrate" | "rush" | "finale";

export type CameraPlanArgs = {
  stage: CameraStage;
  vw: number;
  vh: number;
  /** Свободное место, которое занимает карточка: снизу на телефоне, справа на десктопе. */
  sheet: { bottom: number; right: number };
  /** Точка, на которую смотрит камера при следовании: игрок или герой открытой комнаты. */
  focus: Point;
  moving: boolean;
  /** Праздник: на пару секунд показать весь шар. */
  hold: boolean;
  /** Телефон: вместо всего шара кадрируется эта область (комната, ёлка и путь игрушки), иначе кадр наполовину пустой. */
  holdRect?: Rect;
  /** Шаг пролога: 0–1 общий план, 2 — приближение к персонажу. */
  prologueStep: number;
  world: CameraWorld;
};

/** Куда смотреть камере в текущей фазе игры. Чистая функция: проверяется юнит-тестами. */
export function planCamera(args: CameraPlanArgs): Camera {
  const { stage, vw, vh, sheet, world } = args;
  const { GLOBE_RECT, RUSH_RECT } = world;
  const wide = vw >= MOBILE_BREAKPOINT;
  const top = wide ? 72 : 60;
  const idle: Insets = { top, right: 0, bottom: wide ? 24 : 84, left: 0 };
  // В комнате над героем нужно место под облачко с репликой и под HUD с таймером.
  const sheeted: Insets = { top: top + (wide ? 70 : 170), right: sheet.right, bottom: sheet.bottom || idle.bottom, left: 0 };
  const base = cameraScale(vw, vh, world);

  if (args.hold) return fitCamera({ vw, vh, rect: !wide && args.holdRect ? args.holdRect : GLOBE_RECT, insets: idle });
  if (stage === "finale") return fitCamera({ vw, vh, rect: GLOBE_RECT, insets: { ...sheeted, top: top + 4, bottom: sheet.bottom || (wide ? 24 : 120) } });
  if (stage === "rush") return fitCamera({ vw, vh, rect: RUSH_RECT, insets: { top: top + 64, right: 0, bottom: wide ? 40 : 96, left: 0 } });
  if (stage === "prologue" && args.prologueStep < 2) {
    return fitCamera({ vw, vh, rect: GLOBE_RECT, insets: { top, right: 0, bottom: wide ? 150 : 270, left: 0 } });
  }
  const insets = stage === "prologue" ? { top, right: 0, bottom: wide ? 150 : 270, left: 0 } : stage === "room" ? sheeted : idle;
  // На десктопе во время ходьбы камера ближе, в покое отъезжает.
  const scale = wide ? base * (args.moving ? 1.1 : 1) : base;
  const target = cameraTarget({
    vw,
    vh,
    scale,
    focus: args.focus,
    insets,
    overscroll: { right: stage === "room" ? sheet.right : wide ? 260 : 0, bottom: stage === "room" ? sheet.bottom : 0 },
    bounds: GLOBE_RECT,
    world
  });
  return { ...target, scale };
}
