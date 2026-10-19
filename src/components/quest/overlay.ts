import type { Point } from "@/components/quest/pathfinding";

/**
 * Слой экранных подсказок поверх мира: облачка, маяк цели, стрелка у края.
 * Облачка живут в экранных координатах (читаемый размер при любом зуме и не выходят за края),
 * а их размеры кэшируются через ResizeObserver: в кадре читаются только числа, а не `offsetWidth`.
 */

export type Size = { w: number; h: number };
export type Viewport = { w: number; h: number; top: number };
export type Box = { x: number; y: number; w: number; h: number };

type Entry = { el: HTMLElement; size: Size; observer: ResizeObserver | null };

export class OverlayLayer {
  private entries = new Map<string, Entry>();

  register(id: string, el: HTMLElement | null) {
    this.unregister(id);
    if (!el) return;
    const entry: Entry = { el, size: { w: el.offsetWidth, h: el.offsetHeight }, observer: null };
    if (typeof ResizeObserver === "function") {
      entry.observer = new ResizeObserver((records) => {
        const box = records[0]?.borderBoxSize?.[0];
        entry.size = box ? { w: box.inlineSize, h: box.blockSize } : { w: el.offsetWidth, h: el.offsetHeight };
      });
      entry.observer.observe(el);
    }
    this.entries.set(id, entry);
  }

  unregister(id: string) {
    const entry = this.entries.get(id);
    entry?.observer?.disconnect();
    this.entries.delete(id);
  }

  has(id: string) {
    return this.entries.has(id);
  }

  /**
   * Ставит облачко над точкой `anchor` (экранные координаты); хвостик смотрит на точку.
   * Если облачко налезает на уже поставленные (`avoid`), оно поднимается над ними.
   */
  placeBubble(id: string, anchor: Point, viewport: Viewport, avoid: ReadonlyArray<Box> = [], pinTop = false): Box | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const { w, h } = entry.size;
    const x = clamp(anchor.x - w / 2, 8, Math.max(8, viewport.w - w - 8));
    let y = pinTop ? viewport.top + 4 : Math.max(viewport.top, anchor.y - h - 8);
    for (const other of pinTop ? [] : avoid) {
      if (x < other.x + other.w && x + w > other.x && y < other.y + other.h && y + h > other.y) y = Math.max(viewport.top, other.y - h - 6);
    }
    const tail = clamp(anchor.x - (x + w / 2), -(w / 2 - 18), w / 2 - 18);
    entry.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    entry.el.style.setProperty("--tail", `${tail.toFixed(1)}px`);
    return { x, y, w, h };
  }

  /** Ставит элемент центром в точку экрана (маркеры сервисов в раунде рывка). */
  placeAt(id: string, point: Point) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.el.style.transform = `translate3d(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px, 0)`;
  }

  /** Показать или скрыть элемент (пишет в DOM только при смене): маяк прячется, когда герой цели уже говорит рядом. */
  setVisible(id: string, visible: boolean) {
    const entry = this.entries.get(id);
    if (entry && entry.el.hidden === visible) entry.el.hidden = !visible;
  }

  /** Маяк цели: в кадре — над точкой, за кадром — стрелка у края экрана в сторону цели. */
  placePointer(id: string, target: Point, viewport: Viewport, margin = 34) {
    const entry = this.entries.get(id);
    if (!entry) return;
    const inside = target.x >= margin && target.x <= viewport.w - margin && target.y >= viewport.top + margin && target.y <= viewport.h - margin;
    if (inside) {
      entry.el.dataset.edge = "false";
      entry.el.style.transform = `translate3d(${target.x.toFixed(1)}px, ${target.y.toFixed(1)}px, 0)`;
      entry.el.style.setProperty("--angle", "0deg");
      return;
    }
    const clamped = edgePoint(target, viewport, margin + 6);
    const angle = Math.atan2(target.y - clamped.y, target.x - clamped.x);
    entry.el.dataset.edge = "true";
    entry.el.style.transform = `translate3d(${clamped.x.toFixed(1)}px, ${clamped.y.toFixed(1)}px, 0)`;
    entry.el.style.setProperty("--angle", `${((angle * 180) / Math.PI).toFixed(1)}deg`);
  }

  dispose() {
    for (const id of [...this.entries.keys()]) this.unregister(id);
  }
}

const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));

/** Точка на рамке вьюпорта, ближайшая к цели за его пределами. */
export function edgePoint(target: Point, viewport: Viewport, margin: number): Point {
  return {
    x: clamp(target.x, margin, viewport.w - margin),
    y: clamp(target.y, viewport.top + margin, viewport.h - margin)
  };
}

/** Видна ли точка в кадре (с запасом). */
export function isOnScreen(point: Point, viewport: Viewport, margin = 20): boolean {
  return point.x >= margin && point.x <= viewport.w - margin && point.y >= viewport.top + margin && point.y <= viewport.h - margin;
}
