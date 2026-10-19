import { DomainError } from "@/domain/errors";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type {
  AdventRepository,
  CompleteLoginInput,
  CompleteLoginResult,
  DayBlockResultRecord,
  DayOpenRecord,
  IdentityRepository,
  LoginTokenRecord,
  ParticipantRecord,
  RewardGrantRecord
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
