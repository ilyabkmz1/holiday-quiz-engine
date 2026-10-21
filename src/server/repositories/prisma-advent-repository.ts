import { DomainError } from "@/domain/errors";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  GENERATED_CODE_ATTEMPTS,
  MAX_SOURCE_LABELS,
  OTHER_SOURCE,
  type PlatformId,
  type SourceVisitRow,
  SYNTHETIC_EMAIL_DOMAIN,
  type AdventRepository,
  type AnalyticsQuery,
  type AnalyticsRaw,
  type AnalyticsRepository,
  type TeamRaw,
  type AssignCodeResult,
  type CodeSource,
  type CompleteLoginInput,
  type CompleteLoginResult,
  type DayBlockResultRecord,
  type DayOpenRecord,
  type GrantWithCampaign,
  type IdentityRepository,
  type IssueGrantInput,
  type IssueGrantResult,
  type LoginTokenRecord,
  type ParticipantRecord,
  type RedeemOutcome,
  type ReminderCandidateQuery,
  type ReminderClaimInput,
  type ReminderDeliveryRecord,
  type ReminderRepository,
  type ReminderStats,
  type ReminderStatus,
  type RewardGrantRecord
} from "@/server/repositories/advent-repository";

type Tx = Prisma.TransactionClient;

/** Строка Participant из Prisma: `platform` там обычная строка. */
type ParticipantRow = Omit<ParticipantRecord, "platform"> & { platform: string | null };

function mapParticipant(participant: ParticipantRow): ParticipantRecord {
  return {
    id: participant.id,
    campaignSlug: participant.campaignSlug,
    accessKeyHash: participant.accessKeyHash,
    normalizedEmail: participant.normalizedEmail,
    teamId: participant.teamId,
    consentAt: participant.consentAt,
    marketingConsentAt: participant.marketingConsentAt,
    reminderOptIn: participant.reminderOptIn,
    unsubscribeHash: participant.unsubscribeHash,
    unsubscribedAt: participant.unsubscribedAt,
    platform: participant.platform === "telegram" ? "telegram" : null,
    createdAt: participant.createdAt
  };
}

function mapResult(result: DayBlockResultRecord): DayBlockResultRecord {
  return { ...result };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Нарушение внешнего ключа: участника нет (например, слит с другим). */
function isMissingParent(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

function participantMissing(): DomainError {
  return new DomainError("not_found", "Участник не найден.");
}

/** Параллельная выдача с тем же ключом успела раньше: транзакция откатывается (вместе со списанием остатка) и читает её результат. */
class GrantRaceLost extends Error {}
/** Пул кодов пуст при `requireCode`: транзакция откатывается целиком. */
class CodePoolEmpty extends Error {}

function mapGrant(grant: RewardGrantRecord): RewardGrantRecord {
  return {
    id: grant.id,
    participantId: grant.participantId,
    day: grant.day,
    source: grant.source,
    rewardId: grant.rewardId,
    code: grant.code,
    expiresAt: grant.expiresAt,
    status: grant.status,
    redeemedAt: grant.redeemedAt,
    createdAt: grant.createdAt
  };
}

/**
 * Берёт код для выдачи внутри транзакции и записывает его в выдачу. `null` — свободного кода в пуле нет.
 * - `list`: `SELECT … WHERE grantId IS NULL … LIMIT 1 FOR UPDATE SKIP LOCKED`: параллельные выдачи берут разные строки и не ждут друг друга;
 * - `generated`: `INSERT … ON CONFLICT DO NOTHING` в `RewardCode` (уникальность кампания+код); при столкновении — следующий код
 *   (ошибка уникальности внутри транзакции PostgreSQL её бы отменила, поэтому конфликт отдаётся без исключения);
 * - `static`: общий код, строки в пуле нет.
 */
async function takeCode(tx: Tx, campaignSlug: string, grantId: string, rewardId: string, source: CodeSource): Promise<string | null> {
  let code: string | null = null;
  if (source.kind === "static") {
    code = source.code;
  } else if (source.kind === "list") {
    const rows = await tx.$queryRaw<Array<{ code: string }>>`
      SELECT "code" FROM "RewardCode"
      WHERE "campaignSlug" = ${campaignSlug} AND "rewardId" = ${rewardId} AND "grantId" IS NULL
      ORDER BY "code" LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (rows.length === 0) return null;
    code = rows[0].code;
    await tx.$executeRaw`UPDATE "RewardCode" SET "grantId" = ${grantId}::uuid WHERE "campaignSlug" = ${campaignSlug} AND "code" = ${code}`;
  } else {
    for (let attempt = 0; attempt < GENERATED_CODE_ATTEMPTS && code === null; attempt += 1) {
      const candidate = source.next();
      const { count } = await tx.rewardCode.createMany({ data: [{ campaignSlug, rewardId, code: candidate, grantId }], skipDuplicates: true });
      if (count === 1) code = candidate;
    }
    if (code === null) throw new Error("Не удалось подобрать уникальный код награды");
  }
  await tx.rewardGrant.update({ where: { id: grantId }, data: { code } });
  return code;
}

/**
 * Сериализует подтверждения входа одного адреса в кампании: привязка email и слияние меняют сразу несколько строк,
 * и два параллельных подтверждения одного адреса обязаны идти по очереди (пара кампания+email остаётся уникальной).
 * Входы разных адресов друг друга не ждут: утренняя пачка писем-напоминаний не выстраивается в одну очередь.
 */
async function lockEmailLogin(tx: Tx, campaignSlug: string, normalizedEmail: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`advent-login:${campaignSlug}:${normalizedEmail}`}))`;
}

/** Момент для сырого SQL: столбцы `timestamp(3)` хранят UTC, поэтому переводим явно, не полагаясь на часовой пояс сессии. */
function utc(value: Date): Prisma.Sql {
  return Prisma.sql`(${value.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

/** Локальная календарная дата столбца `timestamp(3)` (UTC) в часовом поясе кампании. */
function localDate(column: string, timezone: string): Prisma.Sql {
  return Prisma.sql`((${Prisma.raw(column)} AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date`;
}

const num = (value: bigint | number | string | null | undefined): number => Number(value ?? 0);

type DeliveryRow = Omit<ReminderDeliveryRecord, "status"> & { status: string };

function mapDelivery(row: DeliveryRow): ReminderDeliveryRecord {
  return {
    id: row.id,
    participantId: row.participantId,
    day: Number(row.day),
    status: row.status as ReminderStatus,
    attempts: Number(row.attempts),
    lastError: row.lastError,
    claimedAt: row.claimedAt,
    lastAttemptAt: row.lastAttemptAt,
    sentAt: row.sentAt,
    clickedAt: row.clickedAt,
    unsubscribeHash: row.unsubscribeHash
  };
}

/** Блокирует строки участников в порядке id (одинаковый порядок исключает взаимные блокировки). */
async function lockParticipants(tx: Tx, ids: string[]): Promise<void> {
  const sorted = [...new Set(ids)].sort();
  for (const id of sorted) {
    await tx.$queryRaw`SELECT "id" FROM "Participant" WHERE "id" = ${id}::uuid FOR UPDATE`;
  }
}

/**
 * Слияние внутри транзакции; см. `AdventRepository.mergeParticipants`. `moveKeys: false` — ключи устройств
 * поглощённого не переносятся, а удаляются вместе с ним (вход подтвердили не с его устройства).
 */
async function mergeInTx(tx: Tx, fromId: string, intoId: string, moveKeys = true): Promise<void> {
  if (fromId === intoId) return;
  await lockParticipants(tx, [fromId, intoId]);
  const [from, into] = await Promise.all([
    tx.participant.findUnique({ where: { id: fromId } }),
    tx.participant.findUnique({ where: { id: intoId } })
  ]);
  if (!from || !into) throw participantMissing();
  if (from.campaignSlug !== into.campaignSlug) throw new DomainError("invalid", "Участники из разных кампаний.");
  if (from.normalizedEmail !== null) throw new DomainError("invalid", "Нельзя влить участника, привязанного к email.");
  // Команда поглощённого не пропадает, если итоговый свою ещё не выбрал.
  if (into.teamId === null && from.teamId !== null) await tx.participant.update({ where: { id: intoId }, data: { teamId: from.teamId } });

  // Совпавшие дни: самое раннее openedAt и onTime по ИЛИ. Остальное переносится обновлением владельца.
  await tx.$executeRaw`
    UPDATE "DayOpen" AS t
    SET "openedAt" = LEAST(t."openedAt", f."openedAt"), "onTime" = (t."onTime" OR f."onTime")
    FROM "DayOpen" AS f
    WHERE t."participantId" = ${intoId}::uuid AND f."participantId" = ${fromId}::uuid AND t."day" = f."day"`;
  await tx.$executeRaw`
    UPDATE "DayOpen" AS f SET "participantId" = ${intoId}::uuid
    WHERE f."participantId" = ${fromId}::uuid
      AND NOT EXISTS (SELECT 1 FROM "DayOpen" t WHERE t."participantId" = ${intoId}::uuid AND t."day" = f."day")`;
  await tx.$executeRaw`
    UPDATE "DayBlockResult" AS f SET "participantId" = ${intoId}::uuid
    WHERE f."participantId" = ${fromId}::uuid
      AND NOT EXISTS (SELECT 1 FROM "DayBlockResult" t WHERE t."participantId" = ${intoId}::uuid AND t."day" = f."day" AND t."blockIndex" = f."blockIndex")`;
  await tx.$executeRaw`
    UPDATE "RewardGrant" AS f SET "participantId" = ${intoId}::uuid
    WHERE f."participantId" = ${fromId}::uuid
      AND NOT EXISTS (SELECT 1 FROM "RewardGrant" t WHERE t."participantId" = ${intoId}::uuid AND t."source" = f."source" AND t."day" = f."day")`;
  await tx.$executeRaw`
    UPDATE "ReminderDelivery" AS f SET "participantId" = ${intoId}::uuid
    WHERE f."participantId" = ${fromId}::uuid
      AND NOT EXISTS (SELECT 1 FROM "ReminderDelivery" t WHERE t."participantId" = ${intoId}::uuid AND t."day" = f."day")`;
  if (moveKeys) {
    await tx.$executeRaw`UPDATE "ParticipantKey" SET "participantId" = ${intoId}::uuid WHERE "participantId" = ${fromId}::uuid`;
    await tx.participantKey.createMany({ data: [{ accessKeyHash: from.accessKeyHash, participantId: intoId }], skipDuplicates: true });
  }
  // Неиспользованные ссылки входа поглощённого не переходят к итоговому: иначе ссылка, запрошенная с чужого
  // устройства на свой адрес, после слияния сменила бы email итогового участника. Они удаляются каскадом.
  // Что не переехало (дубликаты), удаляется каскадом вместе с участником; коды дубликатов возвращаются в пул (SET NULL).
  await tx.participant.delete({ where: { id: fromId } });
}

export class PrismaAdventRepository implements AdventRepository, IdentityRepository, ReminderRepository, AnalyticsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createParticipant(participant: ParticipantRecord): Promise<ParticipantRecord> {
    return mapParticipant(await this.prisma.participant.create({ data: participant }));
  }

  async getParticipant(participantId: string): Promise<ParticipantRecord | null> {
    const found = await this.prisma.participant.findUnique({ where: { id: participantId } });
    return found ? mapParticipant(found) : null;
  }

  async findParticipantByAccessKeyHash(accessKeyHash: string): Promise<ParticipantRecord | null> {
    const found = await this.prisma.participant.findFirst({
      where: { OR: [{ accessKeyHash }, { keys: { some: { accessKeyHash } } }] }
    });
    return found ? mapParticipant(found) : null;
  }

  async findParticipantByIdentity(campaignSlug: string, platform: PlatformId, subjectHash: string): Promise<ParticipantRecord | null> {
    const found = await this.prisma.participantIdentity.findUnique({
      where: { campaignSlug_platform_subjectHash: { campaignSlug, platform, subjectHash } },
      include: { participant: true }
    });
    return found ? mapParticipant(found.participant) : null;
  }

  async createParticipantWithIdentity(
    participant: ParticipantRecord,
    identity: { campaignSlug: string; platform: PlatformId; subjectHash: string }
  ): Promise<{ participant: ParticipantRecord; created: boolean }> {
    try {
      // Участник и идентичность — одна транзакция: проигравший гонку откатывается целиком, лишнего участника не остаётся.
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.participant.create({ data: participant });
        await tx.participantIdentity.create({ data: { ...identity, participantId: participant.id } });
        return row;
      });
      return { participant: mapParticipant(created), created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Уникальный индекс identity сработал: параллельный запрос успел раньше. P2002 по ключу доступа невозможен (ключ случайный).
      const existing = await this.findParticipantByIdentity(identity.campaignSlug, identity.platform, identity.subjectHash);
      if (!existing) throw error;
      return { participant: existing, created: false };
    }
  }

  async recordSourceVisit(campaignSlug: string, source: string, date: string): Promise<void> {
    let label = source;
    const known = await this.prisma.adventSourceVisit.findFirst({ where: { campaignSlug, source }, select: { source: true } });
    if (!known) {
      const distinct = await this.prisma.adventSourceVisit.groupBy({ by: ["source"], where: { campaignSlug } });
      if (distinct.length >= MAX_SOURCE_LABELS) label = OTHER_SOURCE;
    }
    await this.prisma.adventSourceVisit.upsert({
      where: { campaignSlug_source_date: { campaignSlug, source: label, date } },
      create: { campaignSlug, source: label, date, opens: 1 },
      update: { opens: { increment: 1 } }
    });
  }

  async listSourceVisits(campaignSlug: string): Promise<SourceVisitRow[]> {
    const rows = await this.prisma.adventSourceVisit.findMany({ where: { campaignSlug }, orderBy: [{ date: "asc" }, { source: "asc" }] });
    return rows.map(({ source, date, opens }) => ({ source, date, opens }));
  }

  async openDayOnce(participantId: string, day: number, openedAt: Date, onTime: boolean): Promise<{ open: DayOpenRecord; created: boolean }> {
    try {
      // INSERT ... ON CONFLICT DO NOTHING атомарен: остаётся первая запись, остальные её читают.
      const { count } = await this.prisma.dayOpen.createMany({ data: [{ participantId, day, openedAt, onTime }], skipDuplicates: true });
      const open = await this.prisma.dayOpen.findUniqueOrThrow({ where: { participantId_day: { participantId, day } } });
      return { open, created: count === 1 };
    } catch (error) {
      if (isMissingParent(error)) throw participantMissing();
      throw error;
    }
  }

  async listDayOpens(participantId: string): Promise<DayOpenRecord[]> {
    return this.prisma.dayOpen.findMany({ where: { participantId }, orderBy: { day: "asc" } });
  }

  async recordBlockResultOnce(result: DayBlockResultRecord): Promise<{ result: DayBlockResultRecord; created: boolean }> {
    const { participantId, day, blockIndex } = result;
    try {
      const { count } = await this.prisma.dayBlockResult.createMany({
        data: [{ ...result, result: result.result as Prisma.InputJsonValue }],
        skipDuplicates: true
      });
      const stored = await this.prisma.dayBlockResult.findUniqueOrThrow({
        where: { participantId_day_blockIndex: { participantId, day, blockIndex } }
      });
      return { result: mapResult(stored), created: count === 1 };
    } catch (error) {
      if (isMissingParent(error)) throw participantMissing();
      throw error;
    }
  }

  async listBlockResults(participantId: string): Promise<DayBlockResultRecord[]> {
    const rows = await this.prisma.dayBlockResult.findMany({ where: { participantId }, orderBy: [{ day: "asc" }, { blockIndex: "asc" }] });
    return rows.map(mapResult);
  }

  async grantOnce(grant: RewardGrantRecord): Promise<{ grant: RewardGrantRecord; created: boolean }> {
    const { participantId, source, day } = grant;
    try {
      const { count } = await this.prisma.rewardGrant.createMany({ data: [grant], skipDuplicates: true });
      const stored = await this.prisma.rewardGrant.findUniqueOrThrow({
        where: { participantId_source_day: { participantId, source, day } }
      });
      return { grant: stored, created: count === 1 };
    } catch (error) {
      if (isMissingParent(error)) throw participantMissing();
      throw error;
    }
  }

  async listGrants(participantId: string): Promise<RewardGrantRecord[]> {
    return this.prisma.rewardGrant.findMany({ where: { participantId }, orderBy: [{ createdAt: "asc" }, { day: "asc" }] });
  }

  async issueGrant(input: IssueGrantInput, retry = true): Promise<IssueGrantResult> {
    const { grant, campaignSlug } = input;
    try {
      return await this.prisma.$transaction(async (tx): Promise<IssueGrantResult> => {
        const key = { participantId_source_day: { participantId: grant.participantId, source: grant.source, day: grant.day } };
        const existing = await tx.rewardGrant.findUnique({ where: key });
        if (existing) return { status: "existing", grant: mapGrant(existing), codeMissing: existing.code === null && input.code !== null };
        if (input.consumeStock) {
          const updated = await tx.$executeRaw`
            UPDATE "RewardStock" SET "left" = "left" - 1
            WHERE "campaignSlug" = ${campaignSlug} AND "rewardId" = ${grant.rewardId} AND "left" > 0`;
          if (updated === 0) return { status: "stock_exhausted" };
        }
        const { count } = await tx.rewardGrant.createMany({ data: [{ ...grant, code: null }], skipDuplicates: true });
        if (count === 0) throw new GrantRaceLost();
        let code: string | null = null;
        if (input.code) {
          code = await takeCode(tx, campaignSlug, grant.id, grant.rewardId, input.code);
          if (code === null && input.requireCode) throw new CodePoolEmpty();
        }
        return { status: "created", grant: { ...mapGrant(grant), code }, codeMissing: input.code !== null && code === null };
      });
    } catch (error) {
      if (error instanceof CodePoolEmpty) return { status: "pool_empty" };
      if (error instanceof GrantRaceLost && retry) return this.issueGrant(input, false);
      if (isMissingParent(error)) throw participantMissing();
      throw error;
    }
  }

  async assignGrantCode(grantId: string, source: CodeSource | null, expiresAt: Date | null): Promise<AssignCodeResult> {
    return this.prisma.$transaction(async (tx): Promise<AssignCodeResult> => {
      await tx.$queryRaw`SELECT "id" FROM "RewardGrant" WHERE "id" = ${grantId}::uuid FOR UPDATE`;
      const grant = await tx.rewardGrant.findUnique({ where: { id: grantId }, include: { participant: { select: { campaignSlug: true } } } });
      if (!grant) throw new DomainError("not_found", "Выдача не найдена.");
      if (source === null) {
        if (grant.expiresAt !== null || expiresAt === null) return { grant: mapGrant(grant), status: "existing" };
        const updated = await tx.rewardGrant.update({ where: { id: grantId }, data: { expiresAt } });
        return { grant: mapGrant(updated), status: "assigned" };
      }
      if (grant.code !== null) return { grant: mapGrant(grant), status: "existing" };
      const code = await takeCode(tx, grant.participant.campaignSlug, grant.id, grant.rewardId, source);
      if (code === null) return { grant: mapGrant(grant), status: "pool_empty" };
      const updated = expiresAt === null ? { ...grant, code } : await tx.rewardGrant.update({ where: { id: grantId }, data: { expiresAt } });
      return { grant: { ...mapGrant(updated), code }, status: "assigned" };
    });
  }

  async getGrant(grantId: string): Promise<GrantWithCampaign | null> {
    const grant = await this.prisma.rewardGrant.findUnique({ where: { id: grantId }, include: { participant: { select: { campaignSlug: true } } } });
    return grant ? { ...mapGrant(grant), campaignSlug: grant.participant.campaignSlug } : null;
  }

  async findGrantsByCode(campaignSlug: string, code: string): Promise<RewardGrantRecord[]> {
    const rows = await this.prisma.rewardGrant.findMany({
      where: { code: { equals: code, mode: "insensitive" }, participant: { campaignSlug } },
      orderBy: { createdAt: "asc" },
      take: 50
    });
    return rows.map(mapGrant);
  }

  async redeemGrant(campaignSlug: string, grantId: string, now: Date): Promise<RedeemOutcome> {
    // Одно условное UPDATE: из двух одновременных погашений успешно ровно одно.
    const { count } = await this.prisma.rewardGrant.updateMany({
      where: { id: grantId, status: "issued", participant: { campaignSlug }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      data: { status: "redeemed", redeemedAt: now }
    });
    const grant = await this.prisma.rewardGrant.findFirst({ where: { id: grantId, participant: { campaignSlug } } });
    if (!grant) return { status: "not_found" };
    if (count === 1) return { status: "redeemed", grant: mapGrant(grant) };
    return { status: grant.status === "redeemed" ? "already_redeemed" : "expired", grant: mapGrant(grant) };
  }

  async ensureStock(campaignSlug: string, items: ReadonlyArray<{ rewardId: string; left: number }>): Promise<void> {
    if (items.length === 0) return;
    await this.prisma.rewardStock.createMany({ data: items.map((item) => ({ campaignSlug, rewardId: item.rewardId, left: item.left })), skipDuplicates: true });
  }

  async stockLeft(campaignSlug: string): Promise<Record<string, number>> {
    const rows = await this.prisma.rewardStock.findMany({ where: { campaignSlug } });
    return Object.fromEntries(rows.map((row) => [row.rewardId, row.left]));
  }

  async importCodes(campaignSlug: string, rewardId: string, codes: readonly string[]): Promise<{ added: number; duplicates: number }> {
    let added = 0;
    for (let offset = 0; offset < codes.length; offset += 1000) {
      const chunk = codes.slice(offset, offset + 1000);
      const { count } = await this.prisma.rewardCode.createMany({ data: chunk.map((code) => ({ campaignSlug, rewardId, code })), skipDuplicates: true });
      added += count;
    }
    return { added, duplicates: codes.length - added };
  }

  async poolOverview(campaignSlug: string): Promise<Record<string, { total: number; free: number }>> {
    const rows = await this.prisma.$queryRaw<Array<{ rewardId: string; total: bigint; free: bigint }>>`
      SELECT "rewardId", COUNT(*) AS total, COUNT(*) FILTER (WHERE "grantId" IS NULL) AS free
      FROM "RewardCode" WHERE "campaignSlug" = ${campaignSlug} GROUP BY "rewardId"`;
    return Object.fromEntries(rows.map((row) => [row.rewardId, { total: Number(row.total), free: Number(row.free) }]));
  }

  async listCampaignGrants(campaignSlug: string): Promise<RewardGrantRecord[]> {
    const rows = await this.prisma.rewardGrant.findMany({ where: { participant: { campaignSlug } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return rows.map(mapGrant);
  }

  async grantTotals(campaignSlug: string): Promise<Array<{ rewardId: string; issued: number; redeemed: number }>> {
    const rows = await this.prisma.rewardGrant.groupBy({ by: ["rewardId", "status"], where: { participant: { campaignSlug } }, _count: { _all: true } });
    const totals = new Map<string, { rewardId: string; issued: number; redeemed: number }>();
    for (const row of rows) {
      const entry = totals.get(row.rewardId) ?? { rewardId: row.rewardId, issued: 0, redeemed: 0 };
      entry.issued += row._count._all;
      if (row.status === "redeemed") entry.redeemed += row._count._all;
      totals.set(row.rewardId, entry);
    }
    return [...totals.values()].sort((a, b) => a.rewardId.localeCompare(b.rewardId));
  }

  async mergeParticipants(fromId: string, intoId: string): Promise<void> {
    await this.prisma.$transaction((tx) => mergeInTx(tx, fromId, intoId));
  }

  async listReminderCandidates(query: ReminderCandidateQuery): Promise<ParticipantRecord[]> {
    const rows = await this.prisma.participant.findMany({
      where: {
        campaignSlug: query.campaignSlug,
        reminderOptIn: true,
        normalizedEmail: { not: null },
        NOT: { normalizedEmail: { endsWith: `@${SYNTHETIC_EMAIL_DOMAIN}` } },
        consentAt: { not: null },
        // Напоминание — рассылка: без согласия на неё (ст. 18 38-ФЗ) не шлём.
        marketingConsentAt: { not: null },
        dayOpens: { none: { day: query.day } },
        // Доставка есть и не подлежит повтору — не кандидат.
        reminders: {
          none: {
            day: query.day,
            NOT: { status: "failed", attempts: { lt: query.maxAttempts }, lastAttemptAt: { lt: query.retryBefore } }
          }
        }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: query.limit
    });
    return rows.map(mapParticipant);
  }

  async claimReminder(input: ReminderClaimInput): Promise<ReminderDeliveryRecord | null> {
    // Одна инструкция: условия кандидата, вставка и перевод failed → sending проверяются атомарно. Параллельный запуск
    // упирается в уникальный ключ (участник, день) и ждёт первого; его условие `status = 'failed'` уже не выполняется.
    const rows = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<DeliveryRow[]>`
        INSERT INTO "ReminderDelivery" ("id", "participantId", "day", "status", "attempts", "claimedAt", "lastAttemptAt", "unsubscribeHash")
        SELECT ${input.deliveryId}::uuid, p."id", ${input.day}, 'sending', 1, ${utc(input.now)}, ${utc(input.now)}, ${input.unsubscribeHash}
        FROM "Participant" p
        WHERE p."id" = ${input.participantId}::uuid
          AND p."reminderOptIn" AND p."normalizedEmail" IS NOT NULL AND p."consentAt" IS NOT NULL AND p."marketingConsentAt" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "DayOpen" o WHERE o."participantId" = p."id" AND o."day" = ${input.day})
        ON CONFLICT ("participantId", "day") DO UPDATE SET
          "id" = ${input.deliveryId}::uuid, "status" = 'sending', "attempts" = "ReminderDelivery"."attempts" + 1, "lastError" = NULL,
          "claimedAt" = ${utc(input.now)}, "lastAttemptAt" = ${utc(input.now)}, "unsubscribeHash" = ${input.unsubscribeHash}
        WHERE "ReminderDelivery"."status" = 'failed' AND "ReminderDelivery"."attempts" < ${input.maxAttempts}
          AND "ReminderDelivery"."lastAttemptAt" < ${utc(input.retryBefore)}
        RETURNING "id"::text AS "id", "participantId"::text AS "participantId", "day", "status", "attempts", "lastError",
          "claimedAt", "lastAttemptAt", "sentAt", "clickedAt", "unsubscribeHash"`;
      if (claimed.length === 1) {
        // Токен последнего письма — и на участнике (поле unsubscribeHash), старые остаются на своих доставках.
        await tx.participant.update({ where: { id: input.participantId }, data: { unsubscribeHash: input.unsubscribeHash } });
      }
      return claimed;
    });
    return rows.length === 1 ? mapDelivery(rows[0]) : null;
  }

  async markReminderSent(deliveryId: string, now: Date): Promise<void> {
    await this.prisma.reminderDelivery.updateMany({ where: { id: deliveryId, status: "sending" }, data: { status: "sent", sentAt: now, lastError: null } });
  }

  async markReminderFailed(deliveryId: string, errorCode: string): Promise<void> {
    await this.prisma.reminderDelivery.updateMany({ where: { id: deliveryId, status: "sending" }, data: { status: "failed", lastError: errorCode.slice(0, 64) } });
  }

  async getReminderDelivery(deliveryId: string): Promise<ReminderDeliveryRecord | null> {
    const found = await this.prisma.reminderDelivery.findUnique({ where: { id: deliveryId } });
    return found ? mapDelivery(found as DeliveryRow) : null;
  }

  async recordReminderClick(deliveryId: string, now: Date): Promise<ReminderDeliveryRecord | null> {
    await this.prisma.reminderDelivery.updateMany({ where: { id: deliveryId, clickedAt: null }, data: { clickedAt: now } });
    return this.getReminderDelivery(deliveryId);
  }

  async findParticipantByUnsubscribeHash(hash: string): Promise<ParticipantRecord | null> {
    const direct = await this.prisma.participant.findUnique({ where: { unsubscribeHash: hash } });
    if (direct) return mapParticipant(direct);
    const delivery = await this.prisma.reminderDelivery.findUnique({ where: { unsubscribeHash: hash }, include: { participant: true } });
    return delivery ? mapParticipant(delivery.participant) : null;
  }

  async setReminderOptIn(participantId: string, enabled: boolean, now: Date): Promise<ParticipantRecord | null> {
    // Условные UPDATE: повтор ничего не меняет, а первая отписка запоминает свой момент.
    if (enabled) {
      // Одна инструкция: согласие на рассылку — первое сохраняется (COALESCE), отметка ставится, прежняя отписка снимается.
      await this.prisma.$executeRaw`
        UPDATE "Participant" SET "reminderOptIn" = true, "unsubscribedAt" = NULL, "marketingConsentAt" = COALESCE("marketingConsentAt", ${utc(now)})
        WHERE "id" = ${participantId}::uuid AND (NOT "reminderOptIn" OR "unsubscribedAt" IS NOT NULL OR "marketingConsentAt" IS NULL)`;
    } else {
      // Отзыв согласия на рассылку вместе с отметкой; повтор не сдвигает момент первой отписки.
      await this.prisma.participant.updateMany({
        where: { id: participantId, OR: [{ reminderOptIn: true }, { marketingConsentAt: { not: null } }] },
        data: { reminderOptIn: false, marketingConsentAt: null, unsubscribedAt: now }
      });
    }
    return this.getParticipant(participantId);
  }

  async reminderStats(campaignSlug: string): Promise<ReminderStats> {
    const [days, subscribed, unsubscribed] = await Promise.all([
      this.prisma.$queryRaw<Array<{ day: number; sent: bigint; failed: bigint; clicked: bigint; opened: bigint }>>`
        SELECT r."day",
          COUNT(*) FILTER (WHERE r."status" = 'sent') AS sent,
          COUNT(*) FILTER (WHERE r."status" <> 'sent') AS failed,
          COUNT(r."clickedAt") AS clicked,
          COUNT(*) FILTER (WHERE r."status" = 'sent' AND EXISTS (
            SELECT 1 FROM "DayOpen" o WHERE o."participantId" = r."participantId" AND o."day" = r."day" AND o."openedAt" >= r."sentAt")) AS opened
        FROM "ReminderDelivery" r JOIN "Participant" p ON p."id" = r."participantId"
        WHERE p."campaignSlug" = ${campaignSlug}
        GROUP BY r."day" ORDER BY r."day"`,
      this.prisma.participant.count({ where: { campaignSlug, reminderOptIn: true, normalizedEmail: { not: null }, marketingConsentAt: { not: null } } }),
      this.prisma.participant.count({ where: { campaignSlug, reminderOptIn: false, unsubscribedAt: { not: null } } })
    ]);
    return {
      days: days.map((row) => ({ day: Number(row.day), sent: Number(row.sent), failed: Number(row.failed), clicked: Number(row.clicked), openedAfter: Number(row.opened) })),
      subscribed,
      unsubscribed
    };
  }

  async setParticipantTeam(participantId: string, teamId: string | null): Promise<ParticipantRecord | null> {
    try {
      return mapParticipant(await this.prisma.participant.update({ where: { id: participantId }, data: { teamId } }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return null;
      throw error;
    }
  }

  async analyticsRaw(query: AnalyticsQuery): Promise<AnalyticsRaw> {
    const { campaignSlug: slug, timezone, now } = query;
    const days = query.windows.map((window) => window.day);
    const blocks = query.windows.map((window) => window.blocks);
    const starts = query.windows.map((window) => window.start.toISOString());
    const ends = query.windows.map((window) => window.end.toISOString());
    const offsets = [...query.retentionOffsets];
    const [totals, opens, completed, active, doors, patterns, cohortSizes, returns, today, grants] = await Promise.all([
      this.prisma.$queryRaw<Array<Record<string, bigint>>>`
        SELECT COUNT(*) AS participants,
          COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "DayOpen" o WHERE o."participantId" = p."id")) AS players,
          COUNT(p."normalizedEmail") AS email, COUNT(p."consentAt") AS consent, COUNT(p."marketingConsentAt") AS marketing,
          COUNT(*) FILTER (WHERE p."reminderOptIn" AND p."normalizedEmail" IS NOT NULL AND p."marketingConsentAt" IS NOT NULL) AS reminders
        FROM "Participant" p WHERE p."campaignSlug" = ${slug}`,
      this.prisma.$queryRaw<Array<{ day: number; on_time: bigint; caught: bigint }>>`
        SELECT o."day", COUNT(*) FILTER (WHERE o."onTime") AS on_time, COUNT(*) FILTER (WHERE NOT o."onTime") AS caught
        FROM "DayOpen" o JOIN "Participant" p ON p."id" = o."participantId"
        WHERE p."campaignSlug" = ${slug} GROUP BY o."day" ORDER BY o."day"`,
      this.prisma.$queryRaw<Array<{ day: number; count: bigint }>>`
        SELECT r."day", COUNT(*) AS count FROM (
          SELECT b."participantId", b."day", COUNT(*) AS n
          FROM "DayBlockResult" b JOIN "Participant" p ON p."id" = b."participantId"
          WHERE p."campaignSlug" = ${slug} GROUP BY b."participantId", b."day") r
        JOIN unnest(${days}::int[], ${blocks}::int[]) AS w("day", "blocks") ON w."day" = r."day" AND w."blocks" = r.n
        GROUP BY r."day" ORDER BY r."day"`,
      this.prisma.$queryRaw<Array<{ day: number; active: bigint; opened: bigint; returning: bigint; returning_on_time: bigint }>>`
        WITH first_open AS (
          SELECT o."participantId" AS pid, MIN(o."openedAt") AS first_at
          FROM "DayOpen" o JOIN "Participant" p ON p."id" = o."participantId"
          WHERE p."campaignSlug" = ${slug} GROUP BY o."participantId"),
        w AS (SELECT * FROM unnest(${days}::int[], ${starts}::timestamptz[], ${ends}::timestamptz[]) AS t("day", "start_at", "end_at"))
        SELECT w."day", COUNT(f.pid) AS active, COUNT(o."participantId") AS opened,
          COUNT(f.pid) FILTER (WHERE f.first_at < (w."start_at" AT TIME ZONE 'UTC')) AS returning,
          COUNT(o."participantId") FILTER (WHERE f.first_at < (w."start_at" AT TIME ZONE 'UTC') AND o."onTime") AS returning_on_time
        FROM w
        LEFT JOIN first_open f ON f.first_at < (w."end_at" AT TIME ZONE 'UTC')
        LEFT JOIN "DayOpen" o ON o."participantId" = f.pid AND o."day" = w."day"
        GROUP BY w."day" ORDER BY w."day"`,
      this.prisma.$queryRaw<Array<{ doors: bigint; count: bigint }>>`
        SELECT d.n AS doors, COUNT(*) AS count FROM (
          SELECT o."participantId", COUNT(*) AS n
          FROM "DayOpen" o JOIN "Participant" p ON p."id" = o."participantId"
          WHERE p."campaignSlug" = ${slug} GROUP BY o."participantId") d
        GROUP BY d.n ORDER BY d.n`,
      this.prisma.$queryRaw<Array<{ days: number[]; count: bigint }>>`
        SELECT pat.days, COUNT(*) AS count FROM (
          SELECT COALESCE(array_agg(o."day" ORDER BY o."day") FILTER (WHERE o."onTime"), '{}') AS days
          FROM "DayOpen" o JOIN "Participant" p ON p."id" = o."participantId"
          WHERE p."campaignSlug" = ${slug} GROUP BY o."participantId") pat
        GROUP BY pat.days`,
      this.prisma.$queryRaw<Array<{ date: string; size: bigint }>>`
        SELECT to_char(${localDate('p."createdAt"', timezone)}, 'YYYY-MM-DD') AS date, COUNT(*) AS size
        FROM "Participant" p WHERE p."campaignSlug" = ${slug} GROUP BY 1 ORDER BY 1`,
      // Сначала уникальные пары «участник — локальная дата открытия», потом смещение от даты первого визита: соединение по
      // равенству id, без фильтра по вычисляемой дате на каждой паре (на 100 тыс. участников вдвое быстрее).
      this.prisma.$queryRaw<Array<{ date: string; offset: number; count: bigint }>>`
        WITH c AS (SELECT p."id", ${localDate('p."createdAt"', timezone)} AS d0 FROM "Participant" p WHERE p."campaignSlug" = ${slug}),
        od AS (SELECT DISTINCT o."participantId" AS pid, ${localDate('o."openedAt"', timezone)} AS d FROM "DayOpen" o JOIN c ON c."id" = o."participantId")
        SELECT to_char(c.d0, 'YYYY-MM-DD') AS date, (od.d - c.d0) AS "offset", COUNT(*) AS count
        FROM c JOIN od ON od.pid = c."id"
        WHERE (od.d - c.d0) = ANY(${offsets}::int[])
        GROUP BY 1, 2 ORDER BY 1, 2`,
      this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(DISTINCT o."participantId") AS count
        FROM "DayOpen" o JOIN "Participant" p ON p."id" = o."participantId"
        WHERE p."campaignSlug" = ${slug} AND ${localDate('o."openedAt"', timezone)} = ${query.today}::date`,
      this.prisma.$queryRaw<Array<{ rewardId: string; source: string; issued: bigint; redeemed: bigint; expired: bigint; no_code: bigint }>>`
        SELECT g."rewardId", g."source"::text AS source, COUNT(*) AS issued,
          COUNT(*) FILTER (WHERE g."status" = 'redeemed') AS redeemed,
          COUNT(*) FILTER (WHERE g."status" = 'issued' AND g."expiresAt" IS NOT NULL AND g."expiresAt" <= ${utc(now)}) AS expired,
          COUNT(*) FILTER (WHERE g."code" IS NULL) AS no_code
        FROM "RewardGrant" g JOIN "Participant" p ON p."id" = g."participantId"
        WHERE p."campaignSlug" = ${slug} GROUP BY g."rewardId", g."source" ORDER BY g."rewardId", g."source"::text`
    ]);
    const total = totals[0] ?? {};
    const returnsByDate = new Map<string, Array<{ offset: number; count: number }>>();
    for (const row of returns) returnsByDate.set(row.date, [...(returnsByDate.get(row.date) ?? []), { offset: Number(row.offset), count: num(row.count) }]);
    return {
      participants: num(total.participants),
      players: num(total.players),
      withEmail: num(total.email),
      withConsent: num(total.consent),
      withMarketing: num(total.marketing),
      withReminders: num(total.reminders),
      opens: opens.map((row) => ({ day: Number(row.day), onTime: num(row.on_time), caughtUp: num(row.caught) })),
      completed: completed.map((row) => ({ day: Number(row.day), count: num(row.count) })),
      activeByDay: active.map((row) => ({
        day: Number(row.day),
        active: num(row.active),
        opened: num(row.opened),
        returning: num(row.returning),
        returningOnTime: num(row.returning_on_time)
      })),
      doorsHistogram: doors.map((row) => ({ doors: num(row.doors), count: num(row.count) })),
      onTimePatterns: patterns.map((row) => ({ days: row.days.map(Number), count: num(row.count) })),
      cohorts: cohortSizes.map((row) => ({ date: row.date, size: num(row.size), returned: returnsByDate.get(row.date) ?? [] })),
      activeToday: num(today[0]?.count),
      grants: grants.map((row) => ({
        rewardId: row.rewardId,
        source: row.source as RewardGrantRecord["source"],
        issued: num(row.issued),
        redeemed: num(row.redeemed),
        expired: num(row.expired),
        withoutCode: num(row.no_code)
      }))
    };
  }

  async teamStats(campaignSlug: string): Promise<TeamRaw[]> {
    const rows = await this.prisma.$queryRaw<Array<{ teamId: string; members: bigint; players: bigint; doors: bigint; points: bigint }>>`
      SELECT p."teamId", COUNT(*) AS members, COUNT(*) FILTER (WHERE d.doors > 0) AS players,
        COALESCE(SUM(d.doors), 0) AS doors, COALESCE(SUM(s.points), 0) AS points
      FROM "Participant" p
      LEFT JOIN LATERAL (SELECT COUNT(*) AS doors FROM "DayOpen" o WHERE o."participantId" = p."id") d ON true
      LEFT JOIN LATERAL (SELECT SUM(b."points") AS points FROM "DayBlockResult" b WHERE b."participantId" = p."id") s ON true
      WHERE p."campaignSlug" = ${campaignSlug} AND p."teamId" IS NOT NULL
      GROUP BY p."teamId" ORDER BY p."teamId"`;
    return rows.map((row) => ({ teamId: row.teamId, members: num(row.members), players: num(row.players), doors: num(row.doors), points: num(row.points) }));
  }

  async createLoginToken(token: LoginTokenRecord): Promise<void> {
    try {
      await this.prisma.loginToken.create({ data: token });
    } catch (error) {
      if (isMissingParent(error)) throw participantMissing();
      throw error;
    }
  }

  async completeLogin(input: CompleteLoginInput, allowRaceRetry = true): Promise<CompleteLoginResult> {
    try {
      return await this.prisma.$transaction((tx) => this.completeLoginInTx(tx, input));
    } catch (error) {
      // Страховка: уникальность (кампания, email) нарушилась параллельной записью вне блокировки — повторяем уже с владельцем.
      if (isUniqueViolation(error) && allowRaceRetry) return this.completeLogin(input, false);
      throw error;
    }
  }

  async deleteStaleLoginTokens(now: Date): Promise<number> {
    const { count } = await this.prisma.loginToken.deleteMany({ where: { OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }] } });
    return count;
  }

  async anonymizeCampaignParticipants(campaignSlug: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await tx.loginToken.deleteMany({ where: { participant: { campaignSlug } } });
      await tx.participantIdentity.deleteMany({ where: { campaignSlug } });
      const { count } = await tx.participant.updateMany({
        where: {
          campaignSlug,
          OR: [
            { normalizedEmail: { not: null } },
            { consentAt: { not: null } },
            { marketingConsentAt: { not: null } },
            { reminderOptIn: true },
            { unsubscribeHash: { not: null } },
            { unsubscribedAt: { not: null } }
          ]
        },
        data: { normalizedEmail: null, consentAt: null, marketingConsentAt: null, reminderOptIn: false, unsubscribeHash: null, unsubscribedAt: null }
      });
      // Токены отписки прежних писем: по ним без email уже нечего отключать.
      await tx.reminderDelivery.updateMany({ where: { participant: { campaignSlug }, unsubscribeHash: { not: null } }, data: { unsubscribeHash: null } });
      return count;
    });
  }

  private async completeLoginInTx(tx: Tx, input: CompleteLoginInput): Promise<CompleteLoginResult> {
    // Адрес узнаём без блокировок, затем берём блокировку этого адреса и перечитываем ссылку уже под ней.
    const peek = await tx.loginToken.findUnique({ where: { tokenHash: input.tokenHash }, include: { participant: true } });
    if (!peek || peek.participant.campaignSlug !== input.campaignSlug) {
      throw new DomainError("invalid", "Ссылка входа недействительна.");
    }
    await lockEmailLogin(tx, input.campaignSlug, peek.normalizedEmail);
    const token = await tx.loginToken.findUnique({ where: { tokenHash: input.tokenHash } });
    if (!token) throw new DomainError("invalid", "Ссылка входа недействительна.");
    if (token.usedAt) throw new DomainError("conflict", "Ссылка входа уже использована.");
    if (input.now.getTime() > token.expiresAt.getTime()) throw new DomainError("expired", "Срок действия ссылки истёк.");
    const marked = await tx.loginToken.updateMany({ where: { tokenHash: input.tokenHash, usedAt: null }, data: { usedAt: input.now } });
    if (marked.count !== 1) throw new DomainError("conflict", "Ссылка входа уже использована.");

    const owner = await tx.participant.findUnique({
      where: { campaignSlug_normalizedEmail: { campaignSlug: input.campaignSlug, normalizedEmail: token.normalizedEmail } }
    });
    const targetId = owner?.id ?? token.participantId;
    // Блокировка адреса не защищает от входов с другими адресами, которые вливают тех же анонимов: блокируем строки участников
    // (в порядке id) и перечитываем их уже под блокировкой.
    await lockParticipants(tx, [targetId, token.participantId, ...(input.currentParticipantId ? [input.currentParticipantId] : [])]);
    const requester = await tx.participant.findUnique({ where: { id: token.participantId } });
    if (!requester) throw new DomainError("invalid", "Ссылка входа недействительна.");
    const target = owner ? await tx.participant.findUniqueOrThrow({ where: { id: owner.id } }) : requester;

    const mergedFrom: string[] = [];
    // Ссылку открыли не на устройстве, которое её запросило: устройства запросившего доступа не получают (см. контракт).
    const sameDevice = input.currentParticipantId === requester.id;
    const revokeRequesterKeys = !sameDevice && target.id === requester.id;
    // До слияния, чтобы не задеть ключи вливаемого устройства.
    if (revokeRequesterKeys) await tx.participantKey.deleteMany({ where: { participantId: target.id } });
    const current = input.currentParticipantId ? await tx.participant.findUnique({ where: { id: input.currentParticipantId } }) : null;
    for (const source of [requester, current]) {
      // Сливаем только анонимных той же кампании; участник с другим email остаётся отдельным.
      if (!source || source.id === target.id || source.normalizedEmail !== null || source.campaignSlug !== target.campaignSlug) continue;
      if (mergedFrom.includes(source.id)) continue;
      await mergeInTx(tx, source.id, target.id, source.id !== requester.id || sameDevice);
      mergedFrom.push(source.id);
    }

    const fresh = await tx.participant.findUniqueOrThrow({ where: { id: target.id } });
    const updated = await tx.participant.update({
      where: { id: target.id },
      data: {
        normalizedEmail: token.normalizedEmail,
        consentAt: fresh.consentAt ?? token.consentAt,
        marketingConsentAt: fresh.marketingConsentAt ?? token.marketingConsentAt,
        reminderOptIn: fresh.reminderOptIn || token.reminderOptIn,
        // Явное включение напоминаний при входе снимает прежнюю отписку.
        ...(token.reminderOptIn && !fresh.reminderOptIn ? { unsubscribedAt: null } : {}),
        // Ключ создателя заменяется ключом этого устройства: прежние cookie запросившего больше не действуют.
        ...(revokeRequesterKeys ? { accessKeyHash: input.newAccessKeyHash } : {})
      }
    });
    if (!revokeRequesterKeys) await tx.participantKey.create({ data: { accessKeyHash: input.newAccessKeyHash, participantId: target.id } });
    return { participant: mapParticipant(updated), mergedFrom };
  }
}
