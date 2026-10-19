// Контракт публичного API игры. Ни один тип здесь не содержит признаков правильности ответа
// для задания, на которое игрок ещё не ответил: верные варианты приходят только в `TaskReveal`.
import type { RoomSummary } from "@/domain/scoring";

export type { RoomSummary };

export type TaskType = "pick" | "build" | "phish" | "access" | "order";

export type PublicHero = { id: string; name: string; role: string; color: string };
export type PublicCard = { id: string; title: string; icon: string };
export type PublicLetter = {
  id: string;
  sender: string;
  address: string;
  subject: string;
  mark: "none" | "verified" | "gov";
  attachment: string | null;
};

type PublicTaskBase = { id: string; roomId: string; heroId: string; say: string };

/**
 * Задание без признаков правильности. Тело ответа `POST /api/sessions/:id/answers`:
 * - `pick`, `phish`: `{ optionId }` (для phish — id письма);
 * - `build`: `{ optionIds }` ровно `slots` разных карточек, порядок не важен;
 * - `access`: `{ enabledIds }` — id включённых переключателей (может быть пустым);
 * - `order`: `{ orderedIds }` — все id карточек в выбранном порядке.
 */
export type PublicTask =
  | (PublicTaskBase & { type: "pick"; options: PublicCard[] })
  | (PublicTaskBase & { type: "build"; slots: number; options: PublicCard[] })
  | (PublicTaskBase & { type: "phish"; letters: PublicLetter[] })
  | (PublicTaskBase & { type: "access"; switches: PublicCard[] })
  | (PublicTaskBase & { type: "order"; items: PublicCard[] });

export type TaskPayloadBody =
  | { optionId: string }
  | { optionIds: string[] }
  | { enabledIds: string[] }
  | { orderedIds: string[] };

export type PublicRoom = {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  icon: string;
  ornament: string;
  color: string;
  map: { x: number; y: number };
  /** Герой-хозяин зоны до первой заявки. */
  hostId: string;
  /** Точка мира, к которой привязана зона (`world.spots[].id`). */
  spotId: string;
  taskIds: string[];
};

export type PublicRushService = { id: string; title: string; icon: string; color: string };

export type RewardTier = { minScore: number; title: string; description: string; giftLabel: string };

/** Подача игры: `quest` — мир-иллюстрация, `cards` — карта и полноэкранные комнаты. */
export type CampaignMode = "cards" | "quest";

export type PublicCampaign = {
  slug: string;
  /** Мир пакета (`worlds/<id>/world.json`): страница отдаёт его клиенту рядом с кампанией. */
  worldId: string;
  mode: CampaignMode;
  title: string;
  subtitle: string;
  intro: string;
  scene: { dateLabel: string; rushClock: string };
  heroes: PublicHero[];
  prologue: {
    heroId: string;
    lines: string[];
    mfa: { prompt: string; switchLabel: string; done: string };
  };
  rooms: PublicRoom[];
  rush: {
    intro: string;
    services: PublicRushService[];
    /** Для отображения; решения принимает сервер. */
    durationSeconds: number;
    penaltySeconds: number;
    pointsPerHit: number;
  };
  rules: {
    fusesPerRoom: number;
    noFailBonus: number;
    speedWindowSeconds: number;
  };
  rewardTiers: RewardTier[];
  brand: { name: string; mark: string; wordmark: string; logo?: string; tagline: string; topNote: string };
  story: {
    placeTitle: string;
    guideIntro: string;
    landingAlt: string;
    finaleAlt: string;
    shareCardAlt: string;
    shareHeadline: string;
    shareSubline: string;
    shareLead: string;
  };
  copy: {
    ornamentsMapLabel: string;
    ornamentsAria: string;
    newOrnament: string;
    ornamentName: string;
    hangOrnament: string;
  };
  /** Текст согласия для формы заявки (клиенту нужен только он; политика открывается на /privacy). */
  legal: { consentText: string };
};

/** `perfect` — 100, `partial` — 50, `miss` — 0. */
export type TaskOutcome = "perfect" | "partial" | "miss";

/** Разбор одного задания; приходит только после ответа на него. */
export type TaskReveal = {
  taskId: string;
  roomId: string;
  type: TaskType;
  /** Ответ игрока в нормализованном виде. */
  payload: TaskPayloadBody;
  base: number;
  comboBonus: number;
  /** Длина серии заданий на 100 после этого ответа. */
  combo: number;
  outcome: TaskOutcome;
  /** Верные id: для `order` — в правильном порядке, для `access` — включённые переключатели, для `phish` — подделка. */
  correctIds: string[];
  explanation: string;
  tip: string;
  mood: "happy" | "neutral" | "sad";
  /** Реплика героя: благодарность при 100, иначе реплика при ошибке. */
  line: string;
  /** Предохранители комнаты (из 3) после этого ответа. */
  fuses: number;
  answeredAt: string;
};

/**
 * Реплика следующей заявки комнаты: кто просит и что говорит. Ни вариантов, ни признаков
 * правильности: это тот же текст, что игрок увидит в самом задании.
 */
export type RoomCue = { heroId: string; say: string };

export type RoomProgress = {
  roomId: string;
  entered: boolean;
  enteredAt: string | null;
  /** Время уже отвеченных заданий комнаты, мс: от выдачи задания до ответа (без чтения разбора). */
  spentMs: number;
  /** Когда текущее задание было выдано впервые; `null`, пока оно не запрошено. */
  taskShownAt: string | null;
  answered: number;
  completed: boolean;
  /** id следующего задания комнаты; `null`, если вход не выполнен или комната пройдена. */
  currentTaskId: string | null;
  /** Реплика следующей заявки (герой над комнатой в мире); `null`, если комната пройдена. */
  next: RoomCue | null;
  fuses: number;
  /** Итог комнаты с бонусами; есть только у пройденной комнаты. */
  summary: RoomSummary | null;
};

export type RushCurrent = { itemId: string; prompt: string; index: number };

export type RushState = {
  /** `finished`: вышло время (дедлайн сервера + допуск), пул исчерпан или рывок завершён. */
  status: "running" | "finished";
  startedAt: string;
  /** Дедлайн сервера с учётом штрафов. */
  deadlineAt: string;
  serverNow: string;
  secondsLeft: number;
  answered: number;
  hits: number;
  misses: number;
  points: number;
  total: number;
  current: RushCurrent | null;
};

export type FinalResult = {
  score: number;
  level: RewardTier;
  rooms: RoomSummary[];
  rushHits: number;
  rushPoints: number;
  /** Игрушки на ёлку: названия за каждую пройденную комнату, в порядке комнат. */
  ornaments: Array<{ roomId: string; name: string }>;
};

export type SessionProgress = {
  id: string;
  status: "playing" | "completed";
  /** Текущий счёт по серверным данным; у завершённой сессии равен итоговому. */
  score: number;
  combo: number;
  rooms: RoomProgress[];
  roomsCompleted: number;
  /** Рывок доступен после всех пяти комнат. */
  rushUnlocked: boolean;
  rush: RushState | null;
  /** Разборы уже отвеченных заданий в порядке ответов. */
  answers: TaskReveal[];
  completedAt: string | null;
  final: FinalResult | null;
};

// POST /api/sessions
export type CreateSessionResponse = { sessionId: string; campaign: PublicCampaign; session: SessionProgress };
// GET /api/sessions/:id
export type GetSessionResponse = { campaign: PublicCampaign; session: SessionProgress };
// POST /api/sessions/:id/rooms/:roomId/enter (без тела)
export type EnterRoomResponse = { room: RoomProgress };
// GET /api/sessions/:id/rooms/:roomId/task; `task` равен null, когда комната пройдена
export type RoomTaskResponse = { room: RoomProgress; task: PublicTask | null; taskNumber: number };
// POST /api/sessions/:id/answers, тело AnswerRequest
export type AnswerRequest = { taskId: string; payload: TaskPayloadBody };
export type AnswerResponse = {
  reveal: TaskReveal;
  score: number;
  room: RoomProgress;
  /** Итог комнаты, если этот ответ был третьим в комнате. */
  roomResult: RoomSummary | null;
  nextTaskId: string | null;
};
// POST /api/sessions/:id/rush/start (без тела)
export type RushStartResponse = { rush: RushState; score: number };
// POST /api/sessions/:id/rush/answer, тело RushAnswerRequest
export type RushAnswerRequest = { itemId: string; serviceId: string };
export type RushAnswerResponse = { correct: boolean; scoreDelta: number; score: number; rush: RushState };
// POST /api/sessions/:id/rush/finish (без тела)
export type RushFinishResponse = { rush: RushState; score: number };
// POST /api/sessions/:id/complete (без тела)
export type CompleteResponse = { score: number; rewardTierTitle: string; final: FinalResult };
