import { describe, expect, it } from "vitest";

import { cameraScale, cameraTarget, fitCamera, planCamera, stepCamera } from "@/components/quest/camera";
import { snowGlobeModel } from "../support/world";

const { GLOBE_RECT, WORLD_H, WORLD_W } = snowGlobeModel;

const none = { top: 0, right: 0, bottom: 0, left: 0 };

describe("камера мира", () => {
  it("на телефоне мир приближен (~2× к «картинке по ширине») и покрывает экран", () => {
    const s = cameraScale(390, 844, snowGlobeModel);
    expect(s * WORLD_W / 390).toBeGreaterThanOrEqual(1.8);
    expect(s * WORLD_W / 390).toBeLessThanOrEqual(4);
    expect(s * WORLD_W).toBeGreaterThanOrEqual(390);
    expect(s * WORLD_H).toBeGreaterThanOrEqual(844);
  });

  it("на десктопе шар почти целиком влезает по высоте", () => {
    const s = cameraScale(1440, 900, snowGlobeModel);
    expect(0.84 * WORLD_H * s).toBeLessThanOrEqual(900 * 1.02);
    expect(s * WORLD_W).toBeGreaterThanOrEqual(1440);
  });

  it("ставит фокус в центр и не выходит за края мира", () => {
    const s = cameraScale(390, 844, snowGlobeModel);
    const center = cameraTarget({ world: snowGlobeModel, vw: 390, vh: 844, scale: s, focus: { x: 980, y: 500 }, insets: none });
    expect(center.x + 980 * s).toBeCloseTo(195, 5);
    expect(center.y + 500 * s).toBeCloseTo(422, 5);
    const corner = cameraTarget({ world: snowGlobeModel, vw: 390, vh: 844, scale: s, focus: { x: 0, y: 0 }, insets: none });
    expect(corner).toEqual({ x: 0, y: 0 });
    const far = cameraTarget({ world: snowGlobeModel, vw: 390, vh: 844, scale: s, focus: { x: WORLD_W, y: WORLD_H }, insets: none });
    expect(far.x).toBeCloseTo(390 - WORLD_W * s, 5);
    expect(far.y).toBeCloseTo(844 - WORLD_H * s, 5);
  });

  it("при открытой карточке фокус остаётся выше неё (overscroll разрешает сдвиг мира)", () => {
    const vh = 844;
    const sheet = 440;
    const s = cameraScale(390, vh, snowGlobeModel);
    const focus = { x: 770, y: 720 };
    const target = cameraTarget({
      world: snowGlobeModel,
      vw: 390,
      vh,
      scale: s,
      focus,
      insets: { top: 56, right: 0, bottom: sheet, left: 0 },
      overscroll: { right: 0, bottom: sheet }
    });
    const screenY = target.y + focus.y * s;
    expect(screenY).toBeLessThan(vh - sheet);
    expect(screenY).toBeGreaterThan(56);
  });
});

describe("общий план и границы шара", () => {
  it("fitCamera вмещает прямоугольник целиком в свободную область и центрирует его", () => {
    const rect = { x: 470, y: 40, w: 1010, h: 880 };
    const cam = fitCamera({ vw: 390, vh: 844, rect, insets: { top: 60, right: 0, bottom: 100, left: 0 } });
    expect(cam.scale * rect.w).toBeLessThanOrEqual(390 + 0.001);
    expect(cam.scale * rect.h).toBeLessThanOrEqual(844 - 160 + 0.001);
    expect(cam.x + (rect.x + rect.w / 2) * cam.scale).toBeCloseTo(195, 5);
    expect(cam.y + (rect.y + rect.h / 2) * cam.scale).toBeCloseTo(60 + (844 - 160) / 2, 5);
  });

  it("камера следования ограничена контуром шара: пустое основание под ним не показывается", () => {
    const s = cameraScale(390, 700, snowGlobeModel);
    const down = cameraTarget({ world: snowGlobeModel, vw: 390, vh: 700, scale: s, focus: { x: 770, y: WORLD_H }, insets: none, bounds: GLOBE_RECT });
    const bottomVisibleWorldY = (700 - down.y) / s;
    expect(bottomVisibleWorldY).toBeLessThanOrEqual(GLOBE_RECT.y + GLOBE_RECT.h + 0.5);
    const up = cameraTarget({ world: snowGlobeModel, vw: 390, vh: 700, scale: s, focus: { x: 770, y: 0 }, insets: none, bounds: GLOBE_RECT });
    expect(-up.y / s).toBeGreaterThanOrEqual(GLOBE_RECT.y - 0.5);
  });

  it("если шар уже экрана, камера центрирует его вместо прилипания к краю", () => {
    const rect = { x: 500, y: 100, w: 400, h: 600 };
    const target = cameraTarget({ world: snowGlobeModel, vw: 1400, vh: 700, scale: 1.4, focus: { x: 0, y: 0 }, insets: none, bounds: rect });
    expect(target.x + (rect.x + rect.w / 2) * 1.4).toBeCloseTo(700, 5);
  });

  it("stepCamera плавно приближается к цели, а snap ставит её сразу", () => {
    const goal = { x: -200, y: -100, scale: 1 };
    const from = { x: 0, y: 0, scale: 0.5 };
    const step = stepCamera(from, goal, 0.016, false);
    expect(step.x).toBeLessThan(0);
    expect(step.x).toBeGreaterThan(goal.x);
    expect(step.scale).toBeGreaterThan(0.5);
    expect(stepCamera(from, goal, 0.016, true)).toEqual(goal);
    expect(stepCamera(null, goal, 0.016, false)).toEqual(goal);
  });
});

describe("план камеры по фазе игры", () => {
  const common = { world: snowGlobeModel, vw: 390, vh: 844, sheet: { bottom: 0, right: 0 }, focus: { x: 980, y: 700 }, moving: false, hold: false, prologueStep: 0 };

  it("праздник и финал показывают весь шар, рывок — комнаты вместе с ёлкой", () => {
    const hold = planCamera({ ...common, stage: "explore", hold: true });
    expect(hold.scale * GLOBE_RECT.w).toBeLessThanOrEqual(390.001);
    const finale = planCamera({ ...common, stage: "finale", sheet: { bottom: 360, right: 0 } });
    expect(finale.scale * GLOBE_RECT.w).toBeLessThanOrEqual(390.001);
    const rush = planCamera({ ...common, stage: "rush" });
    expect(rush.scale).toBeGreaterThan(hold.scale);
  });

  it("праздник на телефоне кадрирует комнату и ёлку: крупнее целого шара, область целиком в кадре и не пустует больше половины", () => {
    const rect = { x: 560, y: 330, w: 520, h: 330 };
    const whole = planCamera({ ...common, stage: "explore", hold: true });
    const cropped = planCamera({ ...common, stage: "explore", hold: true, holdRect: rect });
    expect(cropped.scale).toBeGreaterThan(whole.scale * 1.3);
    expect(cropped.x + rect.x * cropped.scale).toBeGreaterThanOrEqual(-0.5);
    expect(cropped.x + (rect.x + rect.w) * cropped.scale).toBeLessThanOrEqual(390.5);
    // На десктопе кадр остаётся общим планом шара.
    const desktop = planCamera({ ...common, vw: 1440, vh: 900, stage: "explore", hold: true, holdRect: rect });
    expect(desktop.scale * GLOBE_RECT.w).toBeLessThanOrEqual(1440.001);
  });

  it("пролог: сначала общий план, потом приближение к персонажу", () => {
    const wide = planCamera({ ...common, stage: "prologue", prologueStep: 0 });
    const close = planCamera({ ...common, stage: "prologue", prologueStep: 2 });
    expect(close.scale).toBeGreaterThan(wide.scale * 1.5);
  });

  it("в комнате фокус над карточкой; в мире на десктопе при ходьбе камера ближе, чем в покое", () => {
    const sheet = 360;
    const room = planCamera({ ...common, stage: "room", sheet: { bottom: sheet, right: 0 } });
    expect(room.y + 700 * room.scale).toBeLessThan(844 - sheet);
    const rest = planCamera({ ...common, vw: 1440, vh: 900, stage: "explore" });
    const walking = planCamera({ ...common, vw: 1440, vh: 900, stage: "explore", moving: true });
    expect(walking.scale).toBeGreaterThan(rest.scale);
  });
});
