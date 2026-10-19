import { DomainError } from "@/domain/errors";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  GENERATED_CODE_ATTEMPTS,
  type AdventRepository,
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
  type RewardGrantRecord
} from "@/server/repositories/advent-repository";

type Tx = Prisma.TransactionClient;

function mapParticipant(participant: ParticipantRecord): ParticipantRecord {
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
 * Сериализует подтверждения входа одной кампании: слияние участников и привязка email меняют сразу несколько строк,
 * а входы редки (клик по письму), поэтому одна блокировка на кампанию проще и надёжнее построчных.
 */
async function lockCampaignLogins(tx: Tx, campaignSlug: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`advent-login:${campaignSlug}`}))`;
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

export class PrismaAdventRepository implements AdventRepository, IdentityRepository {
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
      const { count } = await tx.participant.updateMany({
        where: {
          campaignSlug,
          OR: [{ normalizedEmail: { not: null } }, { consentAt: { not: null } }, { marketingConsentAt: { not: null } }, { reminderOptIn: true }, { unsubscribeHash: { not: null } }]
        },
        data: { normalizedEmail: null, consentAt: null, marketingConsentAt: null, reminderOptIn: false, unsubscribeHash: null }
      });
      return count;
    });
  }

  private async completeLoginInTx(tx: Tx, input: CompleteLoginInput): Promise<CompleteLoginResult> {
    await lockCampaignLogins(tx, input.campaignSlug);
    const token = await tx.loginToken.findUnique({ where: { tokenHash: input.tokenHash }, include: { participant: true } });
    if (!token || token.participant.campaignSlug !== input.campaignSlug) {
      throw new DomainError("invalid", "Ссылка входа недействительна.");
    }
    if (token.usedAt) throw new DomainError("conflict", "Ссылка входа уже использована.");
    if (input.now.getTime() > token.expiresAt.getTime()) throw new DomainError("expired", "Срок действия ссылки истёк.");
    await tx.loginToken.update({ where: { tokenHash: input.tokenHash }, data: { usedAt: input.now } });

    const requester = token.participant;
    const owner = await tx.participant.findUnique({
      where: { campaignSlug_normalizedEmail: { campaignSlug: input.campaignSlug, normalizedEmail: token.normalizedEmail } }
    });
    const target = owner ?? requester;
    await lockParticipants(tx, [target.id, requester.id, ...(input.currentParticipantId ? [input.currentParticipantId] : [])]);

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
        // Ключ создателя заменяется ключом этого устройства: прежние cookie запросившего больше не действуют.
        ...(revokeRequesterKeys ? { accessKeyHash: input.newAccessKeyHash } : {})
      }
    });
    if (!revokeRequesterKeys) await tx.participantKey.create({ data: { accessKeyHash: input.newAccessKeyHash, participantId: target.id } });
    return { participant: mapParticipant(updated), mergedFrom };
  }
}
