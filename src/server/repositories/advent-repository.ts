export type GrantSource = "day" | "luck" | "goal" | "comeback" | "endowed";
export type GrantStatus = "issued" | "redeemed";

/**
 * Ключ `day` для наград «раз за кампанию» (`comeback`, `endowed`). Колонка не может быть NULL:
 * в PostgreSQL NULL в уникальном индексе считаются разными, и уникальность (participantId, source, day) не сработала бы.
 * Для целей серии (`goal`) вместо дня используется число открытых дверей цели, для `day` и `luck` — номер дня.
 */
export const CAMPAIGN_GRANT_DAY = 0;

export type ParticipantRecord = {
  id: string;
  campaignSlug: string;
  /** Хеш ключа cookie устройства, на котором создан участник. Другие устройства — в ключах участника. */
  accessKeyHash: string;
  /** Появляется после подтверждения ссылки входа. */
  normalizedEmail: string | null;
  teamId: string | null;
  consentAt: Date | null;
  /** Отдельное согласие на рассылку (ст. 18 38-ФЗ). */
  marketingConsentAt: Date | null;
  reminderOptIn: boolean;
  unsubscribeHash: string | null;
  createdAt: Date;
};

export type DayOpenRecord = {
  participantId: string;
  day: number;
  openedAt: Date;
  /** Открыта в сам день (идёт в серию), а не догнана позже. */
  onTime: boolean;
};

export type DayBlockResultRecord = {
  participantId: string;
  day: number;
  blockIndex: number;
  /** Нормализованный результат блока; форму задаёт сервис. */
  result: unknown;
  points: number;
  createdAt: Date;
};

export type RewardGrantRecord = {
  id: string;
  participantId: string;
  day: number;
  source: GrantSource;
  rewardId: string;
  /** Код погашения (A2): общий, из пула или сгенерированный; пуст, пока не назначен (анонимный участник, пустой пул) или у наград без кода. */
  code: string | null;
  expiresAt: Date | null;
  status: GrantStatus;
  redeemedAt: Date | null;
  createdAt: Date;
};

export type LoginTokenRecord = {
  tokenHash: string;
  participantId: string;
  normalizedEmail: string;
  consentAt: Date;
  marketingConsentAt: Date | null;
  reminderOptIn: boolean;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
};

/** Откуда берётся код выдачи. */
export type CodeSource =
  /** Один код на всех. */
  | { kind: "static"; code: string }
  /** Атомарно берётся свободный код из загруженного пула награды (`FOR UPDATE SKIP LOCKED`). */
  | { kind: "list" }
  /** Новый код; при столкновении с уникальным ключом (кампания, код) запрашивается следующий. */
  | { kind: "generated"; next: () => string };

export type IssueGrantInput = {
  grant: RewardGrantRecord;
  campaignSlug: string;
  consumeStock: boolean;
  code: CodeSource | null;
  /** Пустой пул кодов — отказ без выдачи (удача), а не выдача без кода. */
  requireCode: boolean;
};

export type IssueGrantResult =
  | { status: "created" | "existing"; grant: RewardGrantRecord; codeMissing: boolean }
  | { status: "stock_exhausted" }
  | { status: "pool_empty" };

export type AssignCodeResult = { grant: RewardGrantRecord; status: "assigned" | "existing" | "pool_empty" };

export type GrantWithCampaign = RewardGrantRecord & { campaignSlug: string };

export type RedeemOutcome =
  | { status: "redeemed" | "already_redeemed" | "expired"; grant: RewardGrantRecord }
  | { status: "not_found" };

/** Сколько раз пробуем подобрать уникальный сгенерированный код. */
export const GENERATED_CODE_ATTEMPTS = 12;

export interface AdventRepository {
  createParticipant(participant: ParticipantRecord): Promise<ParticipantRecord>;
  getParticipant(participantId: string): Promise<ParticipantRecord | null>;
  /** Участник по хешу ключа cookie: ключ создателя или ключ дополнительного устройства. */
  findParticipantByAccessKeyHash(accessKeyHash: string): Promise<ParticipantRecord | null>;

  /** Идемпотентно: при повторном открытии остаётся первая запись (время и `onTime`). */
  openDayOnce(participantId: string, day: number, openedAt: Date, onTime: boolean): Promise<{ open: DayOpenRecord; created: boolean }>;
  listDayOpens(participantId: string): Promise<DayOpenRecord[]>;

  /** Идемпотентно: результат блока пишется один раз; повторная отправка (в том числе с другим ответом) возвращает сохранённый. */
  recordBlockResultOnce(result: DayBlockResultRecord): Promise<{ result: DayBlockResultRecord; created: boolean }>;
  listBlockResults(participantId: string): Promise<DayBlockResultRecord[]>;

  /** Идемпотентно по (participantId, source, day): повторная выдача возвращает существующую награду. */
  grantOnce(grant: RewardGrantRecord): Promise<{ grant: RewardGrantRecord; created: boolean }>;
  listGrants(participantId: string): Promise<RewardGrantRecord[]>;

  /**
   * Атомарная выдача награды (A2). В одной транзакции, по порядку:
   * 1. выдача для (участник, источник, день) уже есть — вернуть её (`existing`), ничего не списывая;
   * 2. `consumeStock`: `UPDATE "RewardStock" SET left = left - 1 WHERE … AND left > 0`; нечего списывать (или строки остатка нет) — `stock_exhausted`;
   * 3. записать выдачу; если параллельная выдача успела раньше — откатить списание остатка и вернуть её (`existing`);
   * 4. назначить код по `code` (см. `CodeSource`); пул пуст и `requireCode` — откатить всё и вернуть `pool_empty`,
   *    иначе выдача остаётся без кода (`codeMissing`), её можно дозаполнить через `assignGrantCode`.
   */
  issueGrant(input: IssueGrantInput): Promise<IssueGrantResult>;
  /**
   * Идемпотентно «активирует» выдачу, созданную до подтверждения email (или при пустом пуле): назначает код
   * (см. `CodeSource`) и устанавливает срок `expiresAt` (срок отсчитывается от активации, а не от создания).
   * Выдача с кодом возвращается как есть (`existing`). Без источника кода (`source = null`, награда без кодов)
   * только проставляет срок выдаче, у которой его ещё нет. Пул пуст — `pool_empty`, выдача не меняется.
   */
  assignGrantCode(grantId: string, source: CodeSource | null, expiresAt: Date | null): Promise<AssignCodeResult>;
  /** Выдача по id вместе с кампанией участника или `null`. */
  getGrant(grantId: string): Promise<GrantWithCampaign | null>;
  /** Выдачи кампании с этим кодом (без учёта регистра): личный код — одна, общий (`static`) — много. */
  findGrantsByCode(campaignSlug: string, code: string): Promise<RewardGrantRecord[]>;
  /**
   * Погашение одним условным UPDATE: `status = 'redeemed'` только для `issued` и не просроченной выдачи кампании.
   * Повторное погашение и просрочка различаются по причине отказа; чужая кампания — `not_found`.
   */
  redeemGrant(campaignSlug: string, grantId: string, now: Date): Promise<RedeemOutcome>;

  /** Создаёт строки остатков, которых ещё нет (`ON CONFLICT DO NOTHING`): уже идущий розыгрыш остатки не сбрасывает. */
  ensureStock(campaignSlug: string, items: ReadonlyArray<{ rewardId: string; left: number }>): Promise<void>;
  /** Текущие остатки кампании: `rewardId` → сколько осталось. */
  stockLeft(campaignSlug: string): Promise<Record<string, number>>;
  /** Добавляет коды в пул награды. Код, уже имеющийся в кампании (в любой награде), не добавляется и считается дублем. */
  importCodes(campaignSlug: string, rewardId: string, codes: readonly string[]): Promise<{ added: number; duplicates: number }>;
  /** Размер пула кодов по наградам: всего загружено и свободно. */
  poolOverview(campaignSlug: string): Promise<Record<string, { total: number; free: number }>>;
  /** Все выдачи кампании для выгрузки (без персональных данных). */
  listCampaignGrants(campaignSlug: string): Promise<RewardGrantRecord[]>;
  /** Сколько выдано и погашено по наградам кампании. */
  grantTotals(campaignSlug: string): Promise<Array<{ rewardId: string; issued: number; redeemed: number }>>;

  /**
   * Переносит прогресс анонимного участника `fromId` в `intoId` и удаляет `fromId`. Открытые дни объединяются
   * (самое раннее `openedAt`, `onTime` по ИЛИ), результаты блоков и награды дедуплицируются по уникальным ключам
   * (при совпадении остаётся запись `intoId`), ключи устройств переходят к `intoId`, неиспользованные ссылки входа
   * `fromId` удаляются (иначе чужая ссылка после слияния могла бы сменить email `intoId`).
   * Участники должны быть из одной кампании, у `fromId` не должно быть email. Атомарно.
   */
  mergeParticipants(fromId: string, intoId: string): Promise<void>;
}

export type CompleteLoginInput = {
  tokenHash: string;
  now: Date;
  campaignSlug: string;
  /** Участник, чьи cookie сейчас у устройства (если есть). */
  currentParticipantId: string | null;
  /** Хеш нового ключа cookie для этого устройства. */
  newAccessKeyHash: string;
};

export type CompleteLoginResult = {
  participant: ParticipantRecord;
  /** Участники, влитые в итогового (анонимные с этого и с запросившего устройства). */
  mergedFrom: string[];
};

export interface IdentityRepository {
  createLoginToken(token: LoginTokenRecord): Promise<void>;

  /**
   * Атомарно подтверждает ссылку входа (одноразовую):
   * - email ещё не занят: он (и согласия из запроса) записываются участнику, запросившему ссылку;
   * - email уже принадлежит другому участнику: итоговым становится он, согласия дополняются;
   * - анонимные участники запросившего и текущего устройств вливаются в итогового (см. `mergeParticipants`);
   * - устройству выдаётся новый ключ (хеш из `newAccessKeyHash`);
   * - если ссылку открыли не на запросившем устройстве (`currentParticipantId` не равен запросившему), устройства
   *   запросившего доступа к итоговому участнику не получают: при слиянии его ключи не переносятся, а если итоговый —
   *   сам запросивший, его прежние ключи отзываются. Так ссылка, запрошенная злоумышленником на чужой адрес и открытая
   *   владельцем почты (или сканером писем), не даёт злоумышленнику доступа к прогрессу и наградам владельца.
   * Согласия монотонны: первое сохраняется, `reminderOptIn` — по ИЛИ; отзыв — отдельный шаг (отписка).
   * Ошибки: `invalid` (нет такой ссылки или она из другой кампании), `expired`, `conflict` (уже использована).
   * Пара (кампания, email) остаётся уникальной даже при параллельных подтверждениях.
   */
  completeLogin(input: CompleteLoginInput): Promise<CompleteLoginResult>;

  /** Очистка ПДн: удаляет использованные и просроченные к `now` ссылки входа (в них email). Возвращает число удалённых. */
  deleteStaleLoginTokens(now: Date): Promise<number>;

  /**
   * Очистка ПДн после кампании: у всех участников кампании стираются email, согласия, подписка на напоминания и
   * ключ отписки, ссылки входа кампании удаляются. Прогресс и награды остаются (обезличены). Возвращает число
   * участников, у которых было что стирать.
   */
  anonymizeCampaignParticipants(campaignSlug: string): Promise<number>;
}
