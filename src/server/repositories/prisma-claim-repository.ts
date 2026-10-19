import { DomainError } from "@/domain/errors";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type {
  ClaimRepository,
  PrizeClaimRecord,
  VerificationRecord
} from "@/server/repositories/claim-repository";

function mapClaim(claim: {
  id: string;
  campaignSlug: string;
  sessionId: string;
  normalizedEmail: string;
  name: string;
  company: string;
  consentAt: Date;
  status: "claim_pending" | "email_verified" | "exported" | "fulfilled";
  createdAt: Date;
  verifiedAt: Date | null;
}): PrizeClaimRecord {
  return claim;
}

export class PrismaClaimRepository implements ClaimRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async prepareClaim(
    claim: PrizeClaimRecord,
    verification: VerificationRecord,
    allowRaceRetry = true
  ): Promise<{ claim: PrizeClaimRecord; created: boolean; verificationPrepared: boolean }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.prizeClaim.findFirst({
          where: {
            OR: [
              { sessionId: claim.sessionId },
              { campaignSlug: claim.campaignSlug, normalizedEmail: claim.normalizedEmail }
            ]
          }
        });
        if (existing) {
          const retryingSamePendingClaim = existing.sessionId === claim.sessionId && existing.status === "claim_pending";
          if (retryingSamePendingClaim) {
            await tx.emailVerification.upsert({
              where: { claimId: existing.id },
              update: {
                tokenHash: verification.tokenHash,
                expiresAt: verification.expiresAt,
                usedAt: null
              },
              create: { ...verification, claimId: existing.id }
            });
          }
          return {
            claim: mapClaim(existing),
            created: false,
            verificationPrepared: retryingSamePendingClaim
          };
        }
        const created = await tx.prizeClaim.create({ data: claim });
        await tx.emailVerification.create({ data: verification });
        return { claim: mapClaim(created), created: true, verificationPrepared: true };
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
      if (!allowRaceRetry) throw error;
      return this.prepareClaim(claim, verification, false);
    }
  }

  async verifyByTokenHash(tokenHash: string, now: Date, campaignSlug?: string): Promise<PrizeClaimRecord> {
    return this.prisma.$transaction(async (tx) => {
      const verification = await tx.emailVerification.findUnique({
        where: { tokenHash },
        include: { claim: true }
      });
      if (!verification || (campaignSlug !== undefined && verification.claim.campaignSlug !== campaignSlug)) {
        throw new DomainError("invalid", "Ссылка подтверждения недействительна.");
      }
      if (verification.usedAt) {
        return mapClaim(verification.claim);
      }
      if (now.getTime() > verification.expiresAt.getTime()) {
        throw new DomainError("expired", "Срок действия ссылки истёк.");
      }
      // Условное обновление: параллельный клик ждёт блокировку строки и после коммита первого
      // видит usedAt уже заполненным. Тогда он возвращает подтверждённую заявку как есть,
      // не перезаписывая verifiedAt и не сбрасывая статус (например, exported).
      const marked = await tx.emailVerification.updateMany({
        where: { claimId: verification.claimId, usedAt: null },
        data: { usedAt: now }
      });
      if (marked.count === 0) {
        return mapClaim(await tx.prizeClaim.findUniqueOrThrow({ where: { id: verification.claimId } }));
      }
      const claim = await tx.prizeClaim.update({
        where: { id: verification.claimId },
        data: { status: "email_verified", verifiedAt: now }
      });
      return mapClaim(claim);
    });
  }
}
