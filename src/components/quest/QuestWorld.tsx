"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

import { usePrefersReducedMotion } from "@/components/game/hooks";
import { Icon } from "@/components/game/icons";
import { resolveRoomHero, type HeroView } from "@/components/quest/hero-view";
import { Celebration, type CelebrateEvent } from "@/components/quest/Celebration";
import { FLAKE_PERK_EVERY, readFlakes, writeFlakes } from "@/components/quest/flakes";
import { OverlayLayer, type Box } from "@/components/quest/overlay";
import { cameraScale, planCamera, stepCamera, type Camera, type CameraStage, type Rect } from "@/components/quest/camera";
import { nearestNode, shortestPath, type Direction, type Point } from "@/components/quest/pathfinding";
import { ScreenOverlay, type BubbleSpec } from "@/components/quest/ScreenOverlay";
import {
  clearKeys, commandGo, initialSim, poseOf, pressKey, releaseKey, stepSim, type PlayerPose, type SimHero, type SimInput, type SimState
} from "@/components/quest/sim";
import type { RobotPose, SpriteFacing } from "@/components/quest/sprites";
import { useWorldModel } from "@/components/play/world-context";
import { pointerAnchor, type WorldModel } from "@/worlds/model";
import { WorldLayer, type WorldHeroView } from "@/components/quest/WorldLayer";
import { getSound } from "@/components/play/sound";
import type { PublicCampaign, PublicHero, SessionProgress } from "@/types/api";

export type { HeroView };
export type WorldStage = CameraStage;
export type ServiceMarker = { id: string; roomId: string; title: string; icon: string; color: string };

const COLLECT_RADIUS = 34;
const ROBOT_OFFSET = 42;
/** Столько спокойных кадров подряд — и цикл мира переходит на редкие тики. */
const SETTLED_FRAMES = 3;
const SLOW_TICK_MS = 250;
/** Где стоит персонаж в авале (`world.rushStand`): левее героев у ёлки и вне кнопок сервисов. */
const PERK_HINT = "Встряхнули шар! Искорки просто для красоты, на очки они не влияют.";

export type QuestWorldProps = {
  campaign: PublicCampaign;
  session: SessionProgress;
  /** Кто сейчас стоит на площадке комнаты и в каком он настроении. */
  heroes: Record<string, HeroView>;
  stage: WorldStage;
  /** Комнаты, где уже горит свет. */
  lit: ReadonlySet<string>;
  /** Комната открытой карточки: камера смотрит на её героя над карточкой. */
  focusRoom: string | null;
  /** Место карточки: камера держит фокус в свободной области. */
  sheet: { bottom: number; right: number };
  /** Куда идти дальше: маяк «!», стрелка у края, пунктир. */
  goalRoom: string | null;
  /** Реплики, заданные фазой (диалог в комнате, заявки рывка, пролог). */
  bubbles: ReadonlyArray<BubbleSpec>;
  celebrate: CelebrateEvent | null;
  onCelebrated: (key: number) => void;
  /** Ошибка в задании: свет в комнате мигает, предохранитель искрит. */
  fault: { roomId: string; key: number } | null;
  prologueStep: number;
  /** Герой пролога: стоит у входа рядом с игроком. */
  prologueHero: PublicHero | null;
  /** Рывок: сервисы-комнаты на шаре. */
  services: ReadonlyArray<ServiceMarker> | null;
  onService: (serviceId: string) => void;
  /** Персонаж дошёл до площадки и повернулся к герою: пора открыть заявку. */
  onHelp: (roomId: string) => void;
  /** Снежинок собрано (для карточки «Поделиться» и ёлки в финале). */
  onFlakes: (count: number) => void;
  /** Финал: весь свет горит, на ёлке искорки. */
  finale: boolean;
  treeFlakes: number;
};

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", KeyA: "left", KeyD: "right", KeyW: "up", KeyS: "down"
};

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest("button, a, input, textarea, select, [role='button'], [role='dialog']");
}

/** Сервис-комната рывка на шаре. Ссылка стабильна, поэтому кнопка не перерегистрируется при каждой перерисовке. */
const ServiceButton = memo(function ServiceButton({ layer, service, index, onService }: { layer: OverlayLayer; service: ServiceMarker; index: number; onService: (id: string) => void }) {
  const id = `svc-${service.id}`;
  const ref = useCallback(
    (el: HTMLButtonElement | null) => {
      layer.register(id, el);
    },
    [layer, id]
  );
  return (
    <button type="button" className="qw-service" style={{ "--sc": service.color } as CSSProperties} ref={ref} onClick={() => onService(service.id)}>
      <Icon name={service.icon} size={26} color={service.color} />
      <span className="qw-service-title">{service.title}</span>
      <span className="card-key" aria-hidden="true">{index + 1}</span>
    </button>
  );
});

/** Кадр праздника на телефоне: комната, звезда и слот игрушки на ёлке с полями, не уже 520 пикселей мира. */
const CELEBRATE_PAD = 70;
const CELEBRATE_MIN_W = 520;
function celebrateRect({ spotOf, treeSlot, STAR_POS, TREE_POS, WORLD_W, WORLD_H }: WorldModel, roomId: string | null, roomIndex: number): Rect | undefined {
  const spot = roomId ? spotOf(roomId) : undefined;
  if (!roomId || !spot) return undefined;
  const slot = treeSlot(Math.max(0, roomIndex));
  const box = { x: (spot.box.x / 100) * WORLD_W, y: (spot.box.y / 100) * WORLD_H, w: (spot.box.w / 100) * WORLD_W, h: (spot.box.h / 100) * WORLD_H };
  const left = Math.min(box.x, STAR_POS.x - 80, slot.x - 40) - CELEBRATE_PAD;
  const right = Math.max(box.x + box.w, STAR_POS.x + 80, slot.x + 40) + CELEBRATE_PAD;
  const top = Math.min(box.y, STAR_POS.y, slot.y) - CELEBRATE_PAD;
  const bottom = Math.max(box.y + box.h, TREE_POS.y) + CELEBRATE_PAD;
  const w = Math.max(CELEBRATE_MIN_W, right - left);
  return { x: (left + right) / 2 - w / 2, y: top, w, h: bottom - top };
}

function heroOf(campaign: PublicCampaign, id: string): PublicHero {
  return campaign.heroes.find((hero) => hero.id === id) ?? campaign.heroes[0];
}

export const QuestWorld = memo(function QuestWorld(props: QuestWorldProps) {
  const { campaign, session, heroes, stage, lit, goalRoom, celebrate, fault, prologueStep, services, finale } = props;
  const model = useWorldModel();
  const { BONUSES, GRAPH, ROBOT_HOME_POS, SPOTS, START_NODE, RUSH_STAND_NODE, WORLD_W, WORLD_H, leadFlakes, spotOf } = model;
  const reduced = usePrefersReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const robotRef = useRef<HTMLDivElement>(null);
  const listButtonRef = useRef<HTMLButtonElement>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const layer = useMemo(() => new OverlayLayer(), []);
  const setPlayerEl = useCallback((el: HTMLDivElement | null) => {
    playerRef.current = el;
  }, []);
  const setRobotEl = useCallback((el: HTMLDivElement | null) => {
    robotRef.current = el;
  }, []);
  const hintTimer = useRef<number | null>(null);
  /** Будит цикл мира из медленного режима: вызывается после любого внешнего изменения (команда, клавиша, новые props). */
  const wake = useRef<() => void>(() => undefined);

  const sim = useRef<SimState>(initialSim(GRAPH, START_NODE));
  const robot = useRef<{ x: number; y: number }>({ x: ROBOT_HOME_POS.x, y: ROBOT_HOME_POS.y });
  const cam = useRef<Camera | null>(null);
  const hold = useRef(0);
  const snap = useRef(true);
  const joyUntil = useRef(0);
  const metrics = useRef({ vw: 390, vh: 844, base: 0.95 });
  const poseRef = useRef<PlayerPose>("idle");
  const facingRef = useRef<SpriteFacing>(1);
  const movingRef = useRef(false);
  const stepClock = useRef(0);
  const flakeIds = useRef<Set<string>>(new Set());
  const hudBottom = useRef(64);
  const bubblesRef = useRef<ReadonlyArray<BubbleSpec>>([]);

  const [pose, setPose] = useState<PlayerPose>("idle");
  const [facing, setFacing] = useState<SpriteFacing>(1);
  const [moving, setMoving] = useState(false);
  const [near, setNear] = useState<string | null>(null);
  const [collected, setCollected] = useState<ReadonlySet<string>>(new Set());
  const [lead, setLead] = useState<ReadonlySet<string>>(new Set());
  const [target, setTarget] = useState<string | null>(null);
  const [trail, setTrail] = useState<Point[] | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [moved, setMoved] = useState(false);
  const [snowBurst, setSnowBurst] = useState(0);
  const [trick, setTrick] = useState(0);
  const [extraLanded, setExtraLanded] = useState<ReadonlySet<string>>(new Set());
  const [flyers, setFlyers] = useState<Array<{ id: number; from: Point; to: Point; text: string }>>([]);
  const [faults, setFaults] = useState<Record<string, number>>({});
  const [lastNode, setLastNode] = useState(START_NODE);

  // Свежие значения для rAF-цикла и обработчиков без пересоздания подписок.
  const live = useRef({ ...props, listOpen, reduced, near });
  useEffect(() => {
    live.current = { ...props, listOpen, reduced, near };
    wake.current();
  });

  const explore = stage === "explore";
  const total = campaign.rooms.length;

  // Собранные искорки переживают перезагрузку.
  useEffect(() => {
    const saved = readFlakes(session.id);
    flakeIds.current = new Set(saved);
     
    setCollected(new Set(saved));
    props.onFlakes(saved.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при смене сессии
  }, [session.id]);

  const say = useCallback((text: string, ms = 6500) => {
    setHint(text);
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), ms);
  }, []);
  useEffect(
    () => () => {
      if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
    },
    []
  );

  const spotOfGoal = goalRoom ? spotOf(goalRoom) : undefined;
  const goalTitle = goalRoom ? campaign.rooms.find((room) => room.id === goalRoom)?.title : undefined;

  /** Пунктир от персонажа до площадки комнаты и искорки-цепочка вдоль него. */
  const showTrailTo = useCallback((padId: string) => {
    const route = shortestPath(GRAPH, sim.current.last, padId);
    if (!route) return;
    setTrail([{ x: sim.current.x, y: sim.current.y }, ...route.path.map((id) => GRAPH.nodes.get(id)!)]);
  }, [GRAPH]);

  // Искорки ведут к цели цепочкой.
  useEffect(() => {
    if (!spotOfGoal || !explore) {
       
      setLead(new Set());
      return;
    }
    const route = shortestPath(GRAPH, lastNode, spotOfGoal.pad);
    setLead(route ? leadFlakes(route.path) : new Set());
  }, [spotOfGoal, lastNode, explore, GRAPH, leadFlakes]);

  /** Закрыть список и вернуть фокус на его кнопку: она была inert, пока список был открыт, поэтому фокус — после перерисовки. */
  const closeList = useCallback(() => {
    setListOpen(false);
    window.setTimeout(() => listButtonRef.current?.focus(), 30);
  }, []);

  const goToNode = useCallback((nodeId: string, approachRoom?: string) => {
    setTrail(null);
    setMoved(true);
    const instant = live.current.reduced;
    sim.current = commandGo(GRAPH, sim.current, nodeId, { instant, approachRoom });
    if (instant) snap.current = true;
    setTarget(instant ? null : nodeId);
    wake.current();
  }, [GRAPH]);

  /** «Помочь»: дойти до площадки, повернуться к герою, потом открыть карточку. */
  const requestHelp = useCallback(
    (roomId: string) => {
      const spot = spotOf(roomId);
      if (spot) goToNode(spot.pad, roomId);
    },
    [goToNode, spotOf]
  );

  // Размер вьюпорта → базовый масштаб.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const apply = () => {
      const rect = viewport.getBoundingClientRect();
      metrics.current = { vw: rect.width, vh: rect.height, base: cameraScale(rect.width, rect.height, model) };
      snap.current = true;
      wake.current();
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [model]);

  // Облачка не заходят под HUD: его высота меняется (в комнате и в авале он выше).
  useEffect(() => {
    const hud = document.querySelector<HTMLElement>(".qw-hud");
    if (!hud || typeof ResizeObserver !== "function") return;
    const measure = () => {
      hudBottom.current = Math.max(64, hud.getBoundingClientRect().bottom + 6);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(hud);
    return () => observer.disconnect();
  }, []);

  const heroList = useMemo<SimHero[]>(() => SPOTS.map((spot) => ({ roomId: spot.roomId, pos: spot.heroPos })), [SPOTS]);

  // Основной цикл: симуляция, камера, робот, экранные подсказки.
  useEffect(() => {
    let frame = 0;
    let slowTimer: number | null = null;
    let settledFrames = 0;
    let previous = performance.now();
    // Элементы и последние записанные значения: кадр ничего не ищет в DOM и пишет только изменения.
    const heroEls = new Map<string, HTMLElement>();
    const heroMarks = new Map<string, string>();
    const written = { player: "", robot: "", world: "" };
    const heroElOf = (roomId: string): HTMLElement | null => {
      let el = heroEls.get(roomId);
      if (!el?.isConnected) {
        el = stageRef.current?.querySelector<HTMLElement>(`.qw-hero[data-room="${roomId}"]`) ?? undefined;
        if (el) heroEls.set(roomId, el);
        else heroEls.delete(roomId);
      }
      return el ?? null;
    };
    const viewportOf = () => ({ w: metrics.current.vw, h: metrics.current.vh, top: hudBottom.current });

    const step = (nowMs: number) => {
      const elapsed = Math.max(0, (nowMs - previous) / 1000);
      const dt = Math.min(0.05, elapsed);
      previous = nowMs;
      const L = live.current;
      const m = metrics.current;
      const input: SimInput = { graph: GRAPH, heroes: heroList, frozen: L.stage !== "explore" || L.listOpen, instant: L.reduced };
      const result = stepSim(sim.current, input, dt);
      sim.current = result.state;
      const s = sim.current;
      // В медленном режиме кадры редкие: бездействие считается по настоящему времени (подсказки робота).
      if (!s.moving && elapsed > dt) s.idleSeconds += elapsed - dt;
      for (const event of result.events) {
        if (event.type === "approached") L.onHelp(event.roomId);
        else if (event.type === "nearChanged") setNear(event.roomId);
        else if (event.type === "stopped") {
          setTarget(null);
          setLastNode(s.last);
        }
      }

      // Поза и направление: React узнаёт только об изменениях.
      const nextPose = poseOf(s, nowMs < joyUntil.current);
      if (nextPose !== poseRef.current) {
        poseRef.current = nextPose;
        setPose(nextPose);
      }
      if (s.facing !== facingRef.current) {
        facingRef.current = s.facing;
        setFacing(s.facing);
      }
      if (s.moving !== movingRef.current) {
        movingRef.current = s.moving;
        setMoving(s.moving);
      }

      // Шаги (тихо, отключаются кнопкой звука).
      if (s.moving) {
        stepClock.current += dt;
        if (stepClock.current > (s.running ? 0.2 : 0.3)) {
          stepClock.current = 0;
          getSound().effect("step");
        }
      }

      // Искорки-бонусы.
      if (L.stage === "explore") {
        for (const bonus of BONUSES) {
          if (flakeIds.current.has(bonus.id)) continue;
          if (Math.hypot(bonus.x - s.x, bonus.y - 10 - s.y) < COLLECT_RADIUS + 12) {
            flakeIds.current.add(bonus.id);
            const count = flakeIds.current.size;
            writeFlakes(L.session.id, flakeIds.current);
            setCollected(new Set(flakeIds.current));
            L.onFlakes(count);
            getSound().effect("flake");
            if (count % FLAKE_PERK_EVERY === 0) {
              setSnowBurst(Date.now());
              setTrick(Date.now());
              say(PERK_HINT, 5200);
            }
          }
        }
      }

      // Игрок.
      const player = playerRef.current;
      if (player) {
        const transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0)`;
        if (transform !== written.player) {
          written.player = transform;
          player.style.transform = transform;
          player.style.zIndex = String(Math.round(s.y));
        }
      }

      // Герои смотрят на игрока и машут, когда он рядом.
      for (const spot of SPOTS) {
        const el = heroElOf(spot.roomId);
        if (!el) continue;
        const close = L.stage === "explore" && s.near === spot.roomId;
        const faceRight = spot.hero.face !== "left";
        const playerRight = s.x > spot.heroPos.x;
        const mark = `${close}|${close && playerRight !== faceRight}`;
        if (heroMarks.get(spot.roomId) === mark) continue;
        heroMarks.set(spot.roomId, mark);
        el.dataset.near = close ? "true" : "false";
        el.dataset.flip = close && playerRight !== faceRight ? "true" : "false";
      }

      // Робот: до пролога сидит на своём месте иллюстрации, потом летит следом за игроком.
      const atHome = L.stage === "prologue" && L.prologueStep < 1;
      const nearSpot = s.near ? spotOf(s.near) : undefined;
      const side = nearSpot ? (nearSpot.heroPos.x >= s.x ? -1 : 1) : -s.facing;
      const robotBefore = { x: robot.current.x, y: robot.current.y };
      const goalX = atHome ? ROBOT_HOME_POS.x : s.x + side * ROBOT_OFFSET;
      const goalY = atHome ? ROBOT_HOME_POS.y : s.y - 74;
      const flying = L.stage === "prologue";
      const follow = L.reduced || snap.current ? 1 : 1 - Math.exp(-dt * (flying ? 1.6 : 3));
      robot.current.x += (goalX - robot.current.x) * follow;
      robot.current.y += (goalY - robot.current.y) * follow;
      const robotEl = robotRef.current;
      if (robotEl) {
        const transform = `translate3d(${robot.current.x.toFixed(1)}px, ${robot.current.y.toFixed(1)}px, 0)`;
        if (transform !== written.robot) {
          written.robot = transform;
          robotEl.style.transform = transform;
        }
      }
      const robotMoved = Math.hypot(robot.current.x - robotBefore.x, robot.current.y - robotBefore.y);

      // Камера.
      const focusSpot = L.focusRoom ? spotOf(L.focusRoom) : undefined;
      const heldNow = nowMs < hold.current;
      const goal = planCamera({
        stage: L.stage,
        vw: m.vw,
        vh: m.vh,
        sheet: L.sheet,
        focus: focusSpot && L.stage === "room" ? { x: focusSpot.heroPos.x, y: focusSpot.heroPos.y - 40 } : { x: s.x, y: s.y - 30 },
        moving: s.moving,
        hold: heldNow,
        holdRect: L.celebrate ? celebrateRect(model, L.celebrate.roomId, L.campaign.rooms.findIndex((item) => item.id === L.celebrate!.roomId)) : undefined,
        prologueStep: L.prologueStep,
        world: model
      });
      const cameraBefore = cam.current;
      cam.current = stepCamera(cam.current, goal, dt, snap.current || L.reduced, L.stage === "prologue" ? 2.2 : 5);
      const c = cam.current;
      const cameraMoved = !cameraBefore || Math.abs(c.x - cameraBefore.x) > 0.05 || Math.abs(c.y - cameraBefore.y) > 0.05 || Math.abs(c.scale - cameraBefore.scale) > 0.0002;
      const world = worldRef.current;
      if (world) {
        const transform = `translate3d(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px, 0) scale(${c.scale.toFixed(4)})`;
        if (transform !== written.world) {
          written.world = transform;
          world.style.transform = transform;
        }
      }

      // Экранные подсказки: облачка с кэшированными размерами, маяк цели, маркеры сервисов.
      const toScreen = (p: Point): Point => ({ x: c.x + p.x * c.scale, y: c.y + p.y * c.scale });
      const viewport = viewportOf();
      const placed: Box[] = [];
      const anchorOf = (spec: BubbleSpec): Point | null => {
        if (spec.anchor.kind === "player") return toScreen({ x: s.x, y: s.y - 92 });
        if (spec.anchor.kind === "robot") return toScreen({ x: robot.current.x, y: robot.current.y - 28 });
        if (spec.anchor.kind === "point") return toScreen({ x: spec.anchor.at.x, y: spec.anchor.at.y - 92 });
        const spot = spotOf(spec.anchor.roomId);
        if (!spot) return null;
        const at = L.stage === "rush" ? spot.rushPos : spot.heroPos;
        return toScreen({ x: at.x, y: at.y - 96 });
      };
      const specs = bubblesRef.current;
      // Сначала реплики героев, роботу — после них: он уступает место.
      const ordered = [...specs].sort((a, b) => (a.anchor.kind === "robot" ? 1 : 0) - (b.anchor.kind === "robot" ? 1 : 0));
      for (const spec of ordered) {
        const anchor = anchorOf(spec);
        if (!anchor) continue;
        const box = layer.placeBubble(spec.id, anchor, viewport, placed, spec.pin === "top");
        if (box) placed.push(box);
      }
      if (L.goalRoom && L.stage === "explore") {
        const goalSpot = spotOf(L.goalRoom);
        // Герой цели рядом и говорит в облачке: маяк над его головой только мешает.
        layer.setVisible("pointer", s.near !== L.goalRoom);
        if (goalSpot) layer.placePointer("pointer", toScreen(pointerAnchor(goalSpot)), viewport);
      }
      if (L.services) for (const service of L.services) {
        const spot = spotOf(service.roomId);
        if (spot) layer.placeAt(`svc-${service.id}`, toScreen(spot.center));
      }
      const wasSnap = snap.current;
      snap.current = false;

      // Ничего не движется (ждём ответа игрока, карточка, финал): кадры нужны всё реже, пока что-нибудь не разбудит цикл.
      const calm = !s.moving && s.path.length === 0 && !s.approach && s.keys.length === 0 && !heldNow && !cameraMoved && robotMoved < 0.2 && !wasSnap;
      settledFrames = calm ? settledFrames + 1 : 0;
      if (settledFrames >= SETTLED_FRAMES) {
        slowTimer = window.setTimeout(() => {
          slowTimer = null;
          step(performance.now());
        }, SLOW_TICK_MS);
      } else {
        frame = requestAnimationFrame(step);
      }
    };
    wake.current = () => {
      settledFrames = 0;
      if (slowTimer === null) return;
      window.clearTimeout(slowTimer);
      slowTimer = null;
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      if (slowTimer !== null) window.clearTimeout(slowTimer);
      wake.current = () => undefined;
    };
  }, [heroList, layer, say, BONUSES, GRAPH, ROBOT_HOME_POS.x, ROBOT_HOME_POS.y, SPOTS, model, spotOf]);

  // Тап/клик по миру: комната или герой → площадка; иначе ближайшая точка дорожки.
  const onViewportPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (live.current.stage !== "explore" || live.current.listOpen) return;
      const viewport = viewportRef.current;
      const c = cam.current;
      if (!viewport || !c) return;
      const rect = viewport.getBoundingClientRect();
      const point = { x: (event.clientX - rect.left - c.x) / c.scale, y: (event.clientY - rect.top - c.y) / c.scale };
      getSound().effect("tap");
      const spot = SPOTS.find((candidate) => {
        const box = {
          x: (candidate.box.x / 100) * WORLD_W, y: (candidate.box.y / 100) * WORLD_H, w: (candidate.box.w / 100) * WORLD_W, h: (candidate.box.h / 100) * WORLD_H
        };
        const onHero = Math.hypot(candidate.heroPos.x - point.x, candidate.heroPos.y - 30 - point.y) < 50;
        return onHero || (point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h);
      });
      goToNode(spot ? spot.pad : nearestNode(GRAPH, point).id);
    },
    [goToNode, GRAPH, SPOTS, WORLD_H, WORLD_W]
  );

  // Клавиатура: стрелки и WASD — ходьба; Enter/пробел — поговорить с героем рядом.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const L = live.current;
      const direction = KEY_DIRECTIONS[event.code];
      if (direction) {
        if (L.stage !== "explore" || L.listOpen || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        sim.current = pressKey(sim.current, direction, event.repeat);
        setTrail(null);
        setMoved(true);
        wake.current();
        return;
      }
      if ((event.key === "Enter" || event.key === " ") && L.stage === "explore" && !L.listOpen && !isInteractive(event.target)) {
        const room = sim.current.near;
        const done = room ? L.lit.has(room) : true;
        if (room && !done) {
          event.preventDefault();
          requestHelp(room);
        }
      }
      if (event.key === "Escape" && L.listOpen) closeList();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const direction = KEY_DIRECTIONS[event.code];
      if (direction) sim.current = releaseKey(sim.current, direction);
    };
    const clear = () => {
      sim.current = clearKeys(sim.current);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clear);
    };
  }, [requestHelp, closeList]);

  // Подсказки робота: приветствие и «подтолкнуть» после паузы.
  useEffect(() => {
    if (!explore) return;
    const timer = window.setTimeout(() => {
      if (!sim.current.moving && goalTitle) say(`Идите по офису: тапните по комнате или нажимайте стрелки. Начните с комнаты «${goalTitle}».`);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [explore, goalTitle, say]);
  useEffect(() => {
    if (!explore) return;
    const timer = window.setInterval(() => {
      const L = live.current;
      if (L.stage !== "explore" || L.listOpen || sim.current.moving || sim.current.idleSeconds < 9) return;
      const spot = L.goalRoom ? spotOf(L.goalRoom) : undefined;
      if (!spot) return;
      const title = L.campaign.rooms.find((room) => room.id === spot.roomId)?.title ?? "";
      sim.current = { ...sim.current, idleSeconds: 0 };
      if (sim.current.near === spot.roomId) say("Нажмите «Помочь»: заявка ждёт.");
      else {
        showTrailTo(spot.pad);
        say(`Загляните в комнату «${title}»: там ждёт заявка.`);
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [explore, say, showTrailTo, spotOf]);

  // После праздника подсказываем следующий шаг.
  const celebratedBefore = useRef(lit.size);
  useEffect(() => {
    if (lit.size > celebratedBefore.current && explore && goalRoom) {
      const spot = spotOf(goalRoom);
      const title = campaign.rooms.find((room) => room.id === goalRoom)?.title ?? "";
      if (spot) showTrailTo(spot.pad);
      say(`Игрушка на ёлке! Дальше — комната «${title}».`, 8000);
    }
    celebratedBefore.current = lit.size;
  }, [lit, explore, goalRoom, campaign.rooms, showTrailTo, say, spotOf]);

  // Рывок: персонаж и робот уходят к подножию ёлки, а не остаются под кнопкой сервиса в комнате.
  useEffect(() => {
    if (stage !== "rush") return;
    sim.current = commandGo(GRAPH, sim.current, RUSH_STAND_NODE, { instant: true });
    wake.current();
  }, [stage, GRAPH, RUSH_STAND_NODE]);

  // Радость героя-игрока после праздника и ошибки в комнатах.
  useEffect(() => {
    if (stage === "celebrate") joyUntil.current = performance.now() + 2200;
  }, [stage]);
  useEffect(() => {
    if (!fault) return;
    const { roomId, key } = fault;
     
    setFaults((current) => ({ ...current, [roomId]: key }));
    getSound().effect("miss");
    const timer = window.setTimeout(
      () =>
        setFaults((current) => {
          const next = { ...current };
          if (next[roomId] === key) delete next[roomId];
          return next;
        }),
      1500
    );
    return () => window.clearTimeout(timer);
  }, [fault]);

  // Список комнат: фокус внутрь при открытии.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (listOpen) listRef.current?.querySelector<HTMLElement>(".qw-list-item")?.focus();
  }, [listOpen]);

  function teleport(roomId: string) {
    const spot = spotOf(roomId);
    if (!spot) return;
    // Список комнат — путь для клавиатуры: персонаж оказывается у героя сразу.
    setTrail(null);
    setTarget(null);
    setMoved(true);
    sim.current = { ...commandGo(GRAPH, sim.current, spot.pad, { instant: true }), facing: spot.heroPos.x >= spot.padPos.x ? 1 : -1 };
    snap.current = true;
    wake.current();
    setListOpen(false);
    window.setTimeout(() => (helpButtonRef.current ?? listButtonRef.current)?.focus(), 80);
  }

  // Камера и праздник.
  const holdCamera = useCallback((ms: number) => {
    hold.current = performance.now() + ms;
    wake.current();
  }, []);
  const landRoom = useCallback((roomId: string) => setExtraLanded((current) => new Set(current).add(roomId)), []);
  const flyPoints = useCallback(
    (roomId: string) => {
      const room = live.current.session.rooms.find((item) => item.roomId === roomId);
      const spot = spotOf(roomId);
      const c = cam.current;
      const scoreEl = document.querySelector<HTMLElement>('[data-hud="score"]');
      if (!room?.summary || !spot || !c || !scoreEl) return;
      const box = scoreEl.getBoundingClientRect();
      const stageBox = stageRef.current?.getBoundingClientRect();
      const from = { x: c.x + spot.center.x * c.scale, y: c.y + spot.center.y * c.scale };
      const to = { x: box.left + box.width / 2 - (stageBox?.left ?? 0), y: box.top + box.height / 2 - (stageBox?.top ?? 0) };
      const id = Date.now();
      setFlyers((current) => [...current, { id, from, to, text: `+${room.summary!.total}` }]);
      window.setTimeout(() => setFlyers((current) => current.filter((item) => item.id !== id)), 1300);
    },
    [spotOf]
  );
  const feedback = useCallback(() => {
    getSound().effect("lit");
    try {
      navigator.vibrate?.([30, 50, 70]);
    } catch {
      // Вибрация недоступна.
    }
  }, []);

  const celebratingRoom = celebrate ? campaign.rooms.find((room) => room.id === celebrate.roomId) : undefined;
  const celebratingIndex = celebrate ? campaign.rooms.findIndex((room) => room.id === celebrate.roomId) : 0;

  // Герои в мире: пока карточка открыта и у пройденной комнаты — герой последнего задания, иначе — герой следующей заявки.
  const heroViews = useMemo<WorldHeroView[]>(
    () =>
      SPOTS.map((spot) => {
        const progress = session.rooms.find((room) => room.roomId === spot.roomId);
        const resolved = resolveRoomHero({ view: heroes[spot.roomId], progress, playing: stage === "room" && props.focusRoom === spot.roomId, host: campaign.rooms.find((room) => room.id === spot.roomId)?.hostId ?? campaign.heroes[0].id });
        const done = lit.has(spot.roomId) || finale || !!progress?.completed;
        return { roomId: spot.roomId, hero: heroOf(campaign, resolved.heroId), mood: resolved.mood ?? (done ? "happy" : "neutral"), marker: done ? null : "alert" };
      }),
    [campaign, heroes, session.rooms, lit, finale, stage, props.focusRoom, SPOTS]
  );

  const landed = useMemo(() => {
    const map = new Map<string, string>();
    for (const room of campaign.rooms) if (lit.has(room.id) || extraLanded.has(room.id) || finale) map.set(room.id, room.color);
    return map;
  }, [campaign.rooms, lit, extraLanded, finale]);

  const roomColors = useMemo(() => campaign.rooms.map((room) => ({ id: room.id, color: room.color })), [campaign.rooms]);
  const doneCount = lit.size;
  const trailTarget = target ? GRAPH.nodes.get(target)! : null;

  // Облачка: заданные фазой + реплика героя рядом + подсказка робота.
  const nearSpot = near ? spotOf(near) : undefined;
  const nearProgress = near ? session.rooms.find((room) => room.roomId === near) : undefined;
  const nearHero = nearSpot ? heroViews.find((view) => view.roomId === nearSpot.roomId)?.hero : undefined;
  const nearLine = nearSpot ? (lit.has(nearSpot.roomId) ? "Спасибо! Теперь здесь светло." : (nearProgress?.next?.say ?? "У меня заявка! Поможете?")) : "";
  const bubbles = useMemo<BubbleSpec[]>(() => {
    const list = [...props.bubbles];
    if (explore && !listOpen && nearHero && nearSpot && !list.some((spec) => spec.anchor.kind === "hero" && spec.anchor.roomId === nearSpot.roomId)) {
      list.push({ id: `near-${nearSpot.roomId}`, anchor: { kind: "hero", roomId: nearSpot.roomId }, title: nearHero.name, text: nearLine });
    }
    // Реплика героя рядом важнее: подсказка робота не наезжает на её облачко (текст остаётся в живом регионе для скринридера).
    const heroSpeaking = list.some((spec) => spec.anchor.kind === "hero");
    if (explore && !listOpen && hint && !heroSpeaking) list.push({ id: "robot-hint", anchor: { kind: "robot" }, text: hint, tone: "robot" });
    return list;
  }, [props.bubbles, explore, listOpen, nearHero, nearSpot, nearLine, hint]);
  useEffect(() => {
    bubblesRef.current = bubbles;
    wake.current();
  }, [bubbles]);

  // Скринридер озвучивает реплику героя только когда персонаж остановился.
  const spoken = explore && !listOpen && !moving && nearHero ? `${nearHero.name}, ${nearHero.role}: ${nearLine}` : "";

  // Трюк робота за каждые N снежинок.
  useEffect(() => {
    const el = robotRef.current;
    if (!el || trick === 0) return;
    el.dataset.trick = "true";
    const timer = window.setTimeout(() => {
      el.dataset.trick = "false";
    }, 1300);
    return () => window.clearTimeout(timer);
  }, [trick]);

  const nextHelpRoom = near && nearSpot && !lit.has(near) ? near : null;
  const robotPose: RobotPose = stage === "prologue" && prologueStep >= 1 ? "fly" : "hover";

  return (
    <div className="qw-stage" ref={stageRef} data-pose={pose} data-stage={stage}>
      <div
        className="qw-viewport"
        ref={viewportRef}
        onPointerUp={onViewportPointer}
        inert={listOpen}
        data-moving={moving ? "true" : "false"}
      >
        <div className="qw-world" ref={worldRef} style={{ width: WORLD_W, height: WORLD_H }}>
          <WorldLayer
            rooms={roomColors}
            heroes={heroViews}
            lit={lit}
            active={celebrate?.roomId ?? near}
            landed={landed}
            collected={collected}
            lead={lead}
            progress={finale ? 1 : doneCount / total}
            trail={trail}
            target={trailTarget}
            door={spotOfGoal ? spotOfGoal.padPos : null}
            gather={stage === "rush"}
            robotGone={stage !== "prologue" || prologueStep >= 1}
            playerVisible={stage !== "prologue" || prologueStep >= 2}
            pose={pose}
            facing={facing}
            robotPose={robotPose}
            prologueHero={props.prologueHero}
            treeFlakes={props.treeFlakes}
            snowBurst={snowBurst}
            faults={faults}
            allLit={finale}
            onPlayerEl={setPlayerEl}
            onRobotEl={setRobotEl}
          />
          <Celebration
            event={celebrate}
            color={celebratingRoom?.color ?? "#ffcb5c"}
            roomIndex={Math.max(0, celebratingIndex)}
            reduced={reduced}
            onCamera={holdCamera}
            onLanded={landRoom}
            onFlyPoints={flyPoints}
            onFeedback={feedback}
            onDone={props.onCelebrated}
          />

        </div>
      </div>

      <ScreenOverlay layer={layer} bubbles={bubbles} pointerLabel={explore && goalTitle ? `Цель: ${goalTitle}` : null}>
        {services && (
          <div className="qw-services" role="group" aria-label="Сервисы">
            {services.map((service, index) => (
              <ServiceButton key={service.id} layer={layer} service={service} index={index} onService={props.onService} />
            ))}
          </div>
        )}
      </ScreenOverlay>

      {flyers.map((flyer) => (
        <span
          key={flyer.id}
          className="qw-points-fly"
          style={{ "--fx": `${flyer.from.x}px`, "--fy": `${flyer.from.y}px`, "--tx": `${flyer.to.x}px`, "--ty": `${flyer.to.y}px` } as CSSProperties}
          aria-hidden="true"
        >
          {flyer.text}
        </span>
      ))}

      {explore && !moved && (
        <p className="qw-controls qw-ui" aria-hidden="true">
          <span className="qw-controls-touch">Тапните по офису, чтобы идти</span>
          <span className="qw-controls-keys">Стрелки или WASD — идти · Enter — поговорить · клик по офису — идти туда</span>
        </p>
      )}

      {explore && (
        <div className="qw-dock qw-ui" inert={listOpen}>
          {nextHelpRoom && nearHero && (
            <button type="button" ref={helpButtonRef} className="btn btn-gold qw-help" onClick={() => requestHelp(nextHelpRoom)}>
              Помочь: {nearHero.name}
            </button>
          )}
          <button
            type="button"
            ref={listButtonRef}
            className="btn btn-ghost qw-list-btn"
            aria-expanded={listOpen}
            aria-controls="qw-room-list"
            onClick={() => setListOpen((open) => !open)}
          >
            Список комнат
          </button>
        </div>
      )}

      {listOpen && explore && (
        <div className="qw-list qw-ui" id="qw-room-list" role="dialog" aria-modal="true" aria-label="Список комнат" ref={listRef}>
          <div className="qw-list-head">
            <h2>Комнаты офиса</h2>
            <button type="button" className="qw-list-close" aria-label="Закрыть список комнат" onClick={closeList}>×</button>
          </div>
          <p className="muted-small">Выберите комнату: персонаж сразу окажется рядом с героем.</p>
          <ul>
            {campaign.rooms.map((room) => {
              const view = heroViews.find((item) => item.roomId === room.id);
              const hero = view?.hero ?? heroOf(campaign, room.hostId);
              const status = lit.has(room.id) ? "свет включён" : "есть заявка";
              return (
                <li key={room.id}>
                  <button type="button" className="qw-list-item" onClick={() => teleport(room.id)}>
                    <span className="qw-list-dot" style={{ background: room.color }} aria-hidden="true" />
                    <span className="qw-list-text">
                      <b>{room.title}</b>
                      <span>{hero.name} · {status}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">{spoken}</p>
      <p className="sr-only" role="status" aria-live="polite">{explore && !moving ? (hint ?? "") : ""}</p>
    </div>
  );
});
