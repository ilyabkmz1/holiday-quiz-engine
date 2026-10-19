import { DomainError } from "@/domain/errors";
import type {
  ClaimRepository,
  PrizeClaimRecord,
  VerificationRecord
} from "@/server/repositories/claim-repository";

export class InMemoryClaimRepository implements ClaimRepository {
  private readonly claimsByEmail = new Map<string, PrizeClaimRecord>();
  private readonly claimsById = new Map<string, PrizeClaimRecord>();
  private readonly claimsBySession = new Map<string, PrizeClaimRecord>();
  private readonly verifications = new Map<string, VerificationRecord>();

  async prepareClaim(
    claim: PrizeClaimRecord,
    verification: VerificationRecord
  ): Promise<{ claim: PrizeClaimRecord; created: boolean; verificationPrepared: boolean }> {
    const key = `${claim.campaignSlug}:${claim.normalizedEmail}`;
    const existing = this.claimsBySession.get(claim.sessionId) ?? this.claimsByEmail.get(key);
    if (existing) {
      const retryingSamePendingClaim = existing.sessionId === claim.sessionId && existing.status === "claim_pending";
      if (retryingSamePendingClaim) {
        this.verifications.set(verification.tokenHash, structuredClone({ ...verification, claimId: existing.id }));
        for (const [tokenHash, saved] of this.verifications) {
          if (saved.claimId === existing.id && tokenHash !== verification.tokenHash) this.verifications.delete(tokenHash);
        }
      }
      return {
        claim: structuredClone(existing),
        created: false,
        verificationPrepared: retryingSamePendingClaim
      };
    }
    this.claimsByEmail.set(key, structuredClone(claim));
    this.claimsById.set(claim.id, structuredClone(claim));
    this.claimsBySession.set(claim.sessionId, structuredClone(claim));
    this.verifications.set(verification.tokenHash, structuredClone(verification));
    return { claim: structuredClone(claim), created: true, verificationPrepared: true };
  }

  async verifyByTokenHash(tokenHash: string, now: Date, campaignSlug?: string): Promise<PrizeClaimRecord> {
    const verification = this.verifications.get(tokenHash);
    if (!verification) {
      throw new DomainError("invalid", "Ссылка подтверждения недействительна.");
    }
    const claim = this.claimsById.get(verification.claimId);
    if (!claim) {
      throw new DomainError("not_found", "Заявка не найдена.");
    }
    if (campaignSlug !== undefined && claim.campaignSlug !== campaignSlug) {
      throw new DomainError("invalid", "Ссылка подтверждения недействительна.");
    }
    if (verification.usedAt) {
      return structuredClone(claim);
    }
    if (now.getTime() > verification.expiresAt.getTime()) {
      throw new DomainError("expired", "Срок действия ссылки истёк.");
    }
    verification.usedAt = now;
    claim.status = "email_verified";
    claim.verifiedAt = now;
    this.verifications.set(tokenHash, verification);
    this.claimsById.set(claim.id, claim);
    this.claimsByEmail.set(`${claim.campaignSlug}:${claim.normalizedEmail}`, claim);
    this.claimsBySession.set(claim.sessionId, claim);
    return structuredClone(claim);
  }
}
