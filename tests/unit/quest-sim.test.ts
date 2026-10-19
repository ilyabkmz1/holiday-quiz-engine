import { describe, expect, it } from "vitest";

import { buildGraph } from "@/components/quest/pathfinding";
import {
  NEAR_RADIUS, RUN_SPEED, TURN_DELAY, WALK_SPEED, clearKeys, commandGo, initialSim, poseOf, pressKey, releaseKey, stepSim,
  type SimHero, type SimInput, type SimState
} from "@/components/quest/sim";
import { EDGES, NODES, ROOM_SPOTS, START_NODE, TREE_NODE, WORLD_H, WORLD_W } from "../support/world";

const graph = buildGraph(NODES, EDGES, (p) => ({ x: (p.x / 100) * WORLD_W, y: (p.y / 100) * WORLD_H }));
const heroes: SimHero[] = ROOM_SPOTS.map((spot) => ({ roomId: spot.roomId, pos: { x: (spot.hero.x / 100) * WORLD_W, y: (spot.hero.y / 100) * WORLD_H } }));
const input = (patch: Partial<SimInput> = {}): SimInput => ({ graph, heroes, frozen: false, instant: false, ...patch });

function run(state: SimState, seconds: number, options: Partial<SimInput> = {}, fps = 60) {
  let current = state;
  const events: string[] = [];
  for (let i = 0; i < seconds * fps; i += 1) {
    const result = stepSim(current, input(options), 1 / fps);
    current = result.state;
    for (const event of result.events) events.push(event.type === "approached" ? `approached:${event.roomId}` : event.type);
  }
  return { state: current, events };
}

describe("движение", () => {
  it("персонаж идёт по маршруту к узлу и останавливается точно в нём", () => {
    const start = initialSim(graph, START_NODE);
    const go = commandGo(graph, start, "mailPad");
    expect(go.path.at(-1)).toBe("mailPad");
    const { state, events } = run(go, 30);
    const pad = graph.nodes.get("mailPad")!;
    expect(state.last).toBe("mailPad");
    expect([state.x, state.y]).toEqual([pad.x, pad.y]);
    expect(state.moving).toBe(false);
    expect(events).toContain("stopped");
  });

  it("длинный маршрут проходится бегом, короткий — шагом; скорость нарастает плавно", () => {
    const start = initialSim(graph, START_NODE);
    const far = commandGo(graph, start, "calendarR");
    const near = commandGo(graph, start, "stairs");
    expect(far.running).toBe(true);
    expect(near.running).toBe(false);
    const first = stepSim(far, input(), 1 / 60).state;
    expect(first.speed).toBeGreaterThan(0);
    expect(first.speed).toBeLessThan(RUN_SPEED / 2);
    const mid = run(far, 1.2).state;
    expect(mid.speed).toBeGreaterThan(WALK_SPEED);
    expect(poseOf(mid, false)).toBe("run");
    expect(poseOf(near, false)).toBe("idle");
  });

  it("у цели персонаж тормозит, а не врезается на полной скорости", () => {
    let state = commandGo(graph, initialSim(graph, START_NODE), "stairs");
    let maxSpeedNearEnd = Infinity;
    for (let i = 0; i < 600 && state.path.length > 0; i += 1) {
      state = stepSim(state, input(), 1 / 60).state;
      const left = Math.hypot(graph.nodes.get("stairs")!.x - state.x, graph.nodes.get("stairs")!.y - state.y);
      if (left < 10 && state.moving) maxSpeedNearEnd = Math.min(maxSpeedNearEnd, state.speed);
    }
    expect(maxSpeedNearEnd).toBeLessThan(WALK_SPEED);
    expect(state.last).toBe("stairs");
  });

  it("при открытой карточке или списке ходьба стоит", () => {
    const go = commandGo(graph, initialSim(graph, START_NODE), "mailPad");
    const { state } = run(go, 2, { frozen: true });
    expect(state.x).toBe(go.x);
    expect(state.moving).toBe(false);
  });

  it("reduced motion: перемещение мгновенное", () => {
    const state = commandGo(graph, initialSim(graph, START_NODE), "mailPad", { instant: true });
    expect(state.last).toBe("mailPad");
    expect(state.path).toEqual([]);
  });
});

describe("клавиши", () => {
  it("стрелка вправо ведёт к соседу в этой стороне, отпущенная — останавливает у узла", () => {
    let state = pressKey(initialSim(graph, START_NODE), "right");
    state = run(state, 0.1).state;
    expect(state.next ?? state.last).not.toBe(START_NODE);
    state = releaseKey(state, "right");
    state = run(state, 5).state;
    expect(state.moving).toBe(false);
    expect(state.last).toBe("groundR");
  });

  it("зажатая стрелка не тормозит на каждом узле", () => {
    let state = pressKey(initialSim(graph, "ringL"), "up");
    const speeds: number[] = [];
    for (let i = 0; i < 180; i += 1) {
      state = stepSim(state, input(), 1 / 60).state;
      if (state.moving) speeds.push(state.speed);
    }
    expect(Math.min(...speeds.slice(30))).toBeGreaterThan(WALK_SPEED * 0.6);
  });

  it("у ёлки стрелка не глохнет: влево и вправо идут по площадке", () => {
    for (const [key, node] of [["left", "ringL"], ["right", "ringR"]] as const) {
      const state = run(pressKey(initialSim(graph, TREE_NODE), key), 0.2).state;
      expect(state.path[0] ?? state.last, key).toBe(node);
    }
  });

  it("стрелка в никуда ничего не делает; clearKeys сбрасывает нажатое", () => {
    const state = run(pressKey(initialSim(graph, "gate"), "down"), 0.5).state;
    expect(state.moving).toBe(false);
    expect(clearKeys(state).keys).toEqual([]);
  });
});

describe("герои рядом", () => {
  it("рядом с героем комнаты выдаётся nearChanged; вдали — null", () => {
    const mail = ROOM_SPOTS.find((spot) => spot.roomId === "mail")!;
    const state = commandGo(graph, initialSim(graph, START_NODE), mail.pad, { instant: true });
    const at = stepSim(state, input(), 0.016);
    expect(at.state.near).toBe("mail");
    expect(at.events).toContainEqual({ type: "nearChanged", roomId: "mail" });
    const gate = stepSim(initialSim(graph, START_NODE), input(), 0.016).state;
    expect(gate.near).toBeNull();
    expect(NEAR_RADIUS).toBeGreaterThan(0);
  });

  it("у каждой площадки комнаты герой в радиусе общения", () => {
    for (const spot of ROOM_SPOTS) {
      const state = commandGo(graph, initialSim(graph, START_NODE), spot.pad, { instant: true });
      expect(stepSim(state, input(), 0.016).state.near, spot.roomId).toBe(spot.roomId);
    }
  });

  it("«Помочь»: персонаж доходит до площадки, поворачивается к герою и только потом выдаёт approached", () => {
    const spot = ROOM_SPOTS.find((s) => s.roomId === "messenger")!;
    const go = commandGo(graph, initialSim(graph, START_NODE), spot.pad, { approachRoom: "messenger" });
    const { state, events } = run(go, 30);
    expect(events).toContain("approached:messenger");
    expect(events.indexOf("stopped")).toBeLessThan(events.indexOf("approached:messenger"));
    expect(state.facing).toBe(spot.hero.x >= (graph.nodes.get(spot.pad)!.x / WORLD_W) * 100 ? 1 : -1);
    expect(state.approach).toBeNull();
    expect(TURN_DELAY).toBeGreaterThan(0);
  });

  it("approached выдаётся один раз", () => {
    const spot = ROOM_SPOTS[0];
    const go = commandGo(graph, initialSim(graph, START_NODE), spot.pad, { approachRoom: spot.roomId });
    const { events } = run(go, 40);
    expect(events.filter((event) => event.startsWith("approached")).length).toBe(1);
  });
});
