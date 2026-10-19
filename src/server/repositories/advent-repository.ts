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
  /** Код из пула (A2); без кода пуст. */
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
