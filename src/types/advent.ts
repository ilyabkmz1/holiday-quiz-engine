// Контракты публичного API адвента (`/api/advent/*`). Ни правильных ответов неотвеченных заданий, ни исхода удачи
// до фиксации ответа в этих типах нет: верные варианты приходят только в `AdventTaskOutcome` после записи ответа.
import type { AdventPhase, DoorStatus } from "@/domain/advent";
import type { GrantSource, GrantStatus } from "@/server/repositories/advent-repository";
import type { PublicTask, TaskOutcome, TaskPayloadBody } from "@/types/api";

export type { AdventPhase, DoorStatus, GrantSource, GrantStatus };

export type AdventDoor = {
  n: number;
  title: string;
  teaser: string;
  heroId: string | null;
  /** Когда день открывается (ISO). */
  unlocksAt: string;
  status: DoorStatus;
  /** День открыт и пройден: все блоки истории и заданий выполнены. */
  completed: boolean;
  /** Выполнено блоков истории и заданий из имеющихся. */
  blocksDone: number;
  blocksTotal: number;
  /** Положена ли награда дня при открытии сейчас (с учётом `rewardOnlyOnDay`). */
  rewardAvailable: boolean;
};

/** Разбор задания после ответа. */
export type AdventTaskOutcome = {
  taskId: string;
  type: PublicTask["type"];
  payload: TaskPayloadBody;
  base: number;
  outcome: TaskOutcome;
  correctIds: string[];
  explanation: string;
  tip: string;
  mood: "happy" | "neutral" | "sad";
  line: string;
};

export type AdventBlockState =
  | { index: number; type: "story"; lines: string[]; done: boolean }
  | { index: number; type: "task"; task: PublicTask; done: boolean; outcome: AdventTaskOutcome | null }
  /** Блоки удачи и подарка заработают на этапе A2: исхода и кода в состоянии нет. */
  | { index: number; type: "luck"; choices: number; done: false; ready: false }
  | { index: number; type: "promo"; rewardId: string; done: false; ready: false };

/** Содержимое открытого дня. Для закрытых и ещё не открытых дней его в состоянии нет. */
export type AdventDayContent = {
  n: number;
  chapter: string[];
  heroId: string | null;
  blocks: AdventBlockState[];
  rewardId: string | null;
};

export type AdventGoal = { opened: number; rewardId: string; label: string; reached: boolean; granted: boolean };

export type AdventGrantView = {
  source: GrantSource;
  day: number;
  rewardId: string;
  label: string;
  description: string;
  status: GrantStatus;
  expiresAt: string | null;
  /** Код погашения; до A2 всегда `null`. */
  code: string | null;
  grantedAt: string;
};

export type AdventState = {
  serverTime: string;
  phase: AdventPhase;
  /** Номер текущего дня или `null` до старта. */
  today: number | null;
  totalDays: number;
  participant: {
    id: string;
    /** Маска email (`a***@domain.ru`) после входа по ссылке. */
    email: string | null;
    consent: boolean;
    marketingConsent: boolean;
    reminderOptIn: boolean;
  };
  doors: AdventDoor[];
  days: AdventDayContent[];
  streak: {
    current: number;
    best: number;
    freezes: number;
    freezesLeft: number;
    /** Открыто дверей плюс подаренный день. */
    progress: number;
    endowed: boolean;
    /** Положен бонус за возвращение, но ещё не получен. */
    comebackEligible: boolean;
    comebackGranted: boolean;
  };
  goals: AdventGoal[];
  nextGoal: { opened: number; rewardId: string; label: string } | null;
  grants: AdventGrantView[];
};

export type CreateParticipantResponse = { participantId: string; state: AdventState };
export type OpenDayResponse = { state: AdventState };
export type SubmitBlockResponse = { block: { index: number; type: "story" | "task"; outcome: AdventTaskOutcome | null }; state: AdventState };
export type IdentityRequestResponse = { sent: true };
