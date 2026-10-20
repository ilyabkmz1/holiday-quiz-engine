// Контракты публичного API адвента (`/api/advent/*`). Ни правильных ответов неотвеченных заданий, ни исхода удачи
// до фиксации ответа в этих типах нет: верные варианты приходят только в `AdventTaskOutcome` после записи ответа.
import type { AdventPhase, DoorStatus } from "@/domain/advent";
import type { AdventCopy, AdventReward, RewardIcon } from "@/config/advent-schema";
import type { Facade } from "@/config/facade";
import type { GrantSource, GrantStatus } from "@/server/repositories/advent-repository";
import type { PublicHero, PublicTask, TaskOutcome, TaskPayloadBody } from "@/types/api";

export type { AdventPhase, DoorStatus, GrantSource, GrantStatus };

export type AdventDoor = {
  n: number;
  title: string;
  teaser: string;
  heroId: string | null;
  /** Когда день открывается (ISO). */
  unlocksAt: string;
  status: DoorStatus;
  /** День открыт и пройден: выполнены все блоки, включая удачу и подарок дня. */
  completed: boolean;
  /** Выполнено блоков дня из имеющихся. */
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
  /** `cover` — обложка задания в «Витрине» из пакета (`null` — по типу задания). */
  | { index: number; type: "task"; task: PublicTask; cover: "vessel" | "list" | null; done: boolean; outcome: AdventTaskOutcome | null }
  /**
   * Блок удачи: до выполнения исхода в состоянии нет (`reveal: null`). `ready` — доступен (остальные блоки дня
   * пройдены), `needsIdentity` — для выдачи приза нужен вход по ссылке (анонимному участнику ответ `identity_required`).
   */
  | { index: number; type: "luck"; choices: number; done: boolean; ready: boolean; needsIdentity: boolean; reveal: AdventGrantView | null }
  /** Блок подарка дня: раскрывает награду `rewardId`. Поля — как у блока удачи. */
  | { index: number; type: "promo"; rewardId: string; done: boolean; ready: boolean; needsIdentity: boolean; reveal: AdventGrantView | null };

/** Содержимое открытого дня. Для закрытых и ещё не открытых дней его в состоянии нет. */
export type AdventDayContent = {
  n: number;
  chapter: string[];
  heroId: string | null;
  blocks: AdventBlockState[];
  rewardId: string | null;
};

export type AdventGoal = { opened: number; rewardId: string; label: string; reached: boolean; granted: boolean };

/** Награда участника. Код и QR видны только владельцу (состояние отдаётся по его cookie). */
export type AdventGrantView = {
  /** Id выдачи: по нему гасится награда на кассе. */
  id: string;
  source: GrantSource;
  day: number;
  rewardId: string;
  kind: AdventReward["kind"];
  label: string;
  description: string;
  /** Значок награды в окне «Витрины» (из пакета или по виду награды). */
  icon: RewardIcon;
  status: GrantStatus;
  /** Срок действия; пуст, пока награда не активирована (нужен вход по ссылке) и у наград без срока. */
  expiresAt: string | null;
  /** Код погашения; `null`, пока не назначен (см. `needsIdentity`, `codePending`) и у наград без кодов. */
  code: string | null;
  grantedAt: string;
  redeemedAt: string | null;
  /** Как гасится: онлайн, на кассе, оба способа или не гасится. */
  redeem: AdventReward["redeem"];
  /** Ссылка для онлайн-погашения (`reward.url`). */
  url: string | null;
  /** Награда с кодом, остатком или погашением на кассе, а участник ещё не вошёл по ссылке: код появится после входа. */
  needsIdentity: boolean;
  /** Участник вошёл, но кода пока нет: пул кодов пуст, оператор ещё не загрузил новые. */
  codePending: boolean;
  /** Личный QR для кассы: содержимое и ссылка на `/redeem`; `null`, если награда не гасится на кассе или QR недоступен. */
  qr: { payload: string; url: string | null } | null;
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
    /** Можно включать и выключать напоминания: кампания их рассылает, адрес подтверждён. */
    canRemind: boolean;
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
/** `outcome` — разбор задания; `reward` — выданная награда блока удачи или подарка дня (после фиксации). */
export type SubmittedBlock = {
  index: number;
  type: "story" | "task" | "luck" | "promo";
  outcome: AdventTaskOutcome | null;
  reward: AdventGrantView | null;
};

export type SubmitBlockResponse =
  | { status: "ok"; block: SubmittedBlock; state: AdventState }
  /** Анонимному участнику награда с кодом или остатком не выдаётся: блок не отмечен, приз не разыгран, остаток не списан. */
  | { status: "identity_required"; block: SubmittedBlock; state: AdventState };
export type IdentityRequestResponse = { sent: true };

/** Фасад для клиента: шаблон из `facades/`, герой-хозяин у двери и текст вывески. */
export type PublicFacade = { template: Facade; hostHeroId: string; signText: string };

/**
 * Публичный срез адвент-пакета для страницы: бренд, тексты интерфейса, герои и расписание. Ни заданий, ни наград,
 * ни пулов удачи здесь нет (их показывает `AdventState` по мере прохождения); собирает его `publicAdvent`.
 */
export type PublicAdvent = {
  slug: string;
  tenant: string;
  worldId: string;
  title: string;
  subtitle: string;
  intro: string;
  presentation: "world" | "calendar" | "storefront";
  /** Фасад «Витрины»; `null` при других видах. */
  facade: PublicFacade | null;
  heroes: PublicHero[];
  brand: { name: string; mark: string; wordmark: string; logo?: string; tagline: string; topNote: string };
  story: { placeTitle: string; guideIntro: string };
  copy: AdventCopy;
  /** `marketingConsentText` — текст необязательной отметки «напоминания на почту» (согласие на рассылку); `null` — напоминаний нет. */
  legal: { operatorName: string; consentText: string; marketingConsentText: string | null };
  schedule: { timezone: string; days: number; startDate: string; finaleAt: string; claimEndsAt: string };
  /** Скин блока удачи; `null`, если удачи в адвенте нет. */
  luckSkin: "boxes" | "wheel" | "scratch" | null;
};
