export type ClaimStatus = "claim_pending" | "email_verified" | "exported" | "fulfilled";

export type PrizeClaimRecord = {
  id: string;
  campaignSlug: string;
  sessionId: string;
  normalizedEmail: string;
  name: string;
  company: string;
  consentAt: Date;
  status: ClaimStatus;
  createdAt: Date;
  verifiedAt: Date | null;
};

export type VerificationRecord = {
  claimId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
};

export interface ClaimRepository {
  prepareClaim(
    claim: PrizeClaimRecord,
    verification: VerificationRecord
  ): Promise<{ claim: PrizeClaimRecord; created: boolean; verificationPrepared: boolean }>;
  /** С `campaignSlug` ссылка чужой кампании недействительна: подтверждение идёт только через своего арендатора. */
  verifyByTokenHash(tokenHash: string, now: Date, campaignSlug?: string): Promise<PrizeClaimRecord>;
}
