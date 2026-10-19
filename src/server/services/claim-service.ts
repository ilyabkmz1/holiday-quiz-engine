import type { CampaignConfig } from "@/config/schema";
import { DomainError } from "@/domain/errors";
import { campaignPhase, verificationTokenExpiresAt } from "@/domain/window";
import { createId, createOpaqueToken, hashToken } from "@/server/crypto";
import { normalizeEmail } from "@/server/email";
import type { ClaimRepository, PrizeClaimRecord } from "@/server/repositories/claim-repository";
import type { SessionRepository } from "@/server/repositories/session-repository";

type ClaimInput = {
  name: string;
  email: string;
  company: string;
  consent: boolean;
};

type ClaimServiceDependencies = {
  claims: ClaimRepository;
  sessions: SessionRepository;
  campaign: CampaignConfig;
  now?: () => Date;
  sendVerification: (email: string, link: string) => Promise<void>;
  recordDeliveryFailure?: (claimId: string) => Promise<void>;
  verificationBaseUrl: string;
};

export class ClaimService {
  private readonly now: () => Date;

  constructor(private readonly dependencies: ClaimServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async create(
    sessionId: string,
    input: ClaimInput
  ): Promise<{ claim: PrizeClaimRecord; created: boolean }> {
    const now = this.now();
    if (campaignPhase(now, this.dependencies.campaign) !== "open") {
      throw new DomainError("conflict", "Приём заявок на приз закрыт.");
    }
    if (!input.consent) {
      throw new DomainError("conflict", "Нужно согласие на обработку данных.");
    }
    const session = await this.dependencies.sessions.getSession(sessionId);
    if (!session || session.campaignSlug !== this.dependencies.campaign.slug || session.status !== "completed") {
      throw new DomainError("conflict", "Сначала завершите квиз.");
    }

    const normalizedEmail = normalizeEmail(input.email);
    const claimId = createId();
    const token = createOpaqueToken();
    const result = await this.dependencies.claims.prepareClaim({
      id: claimId,
      campaignSlug: this.dependencies.campaign.slug,
      sessionId,
      normalizedEmail,
      name: input.name.trim(),
      company: input.company.trim(),
      consentAt: now,
      status: "claim_pending",
      createdAt: now,
      verifiedAt: null
    }, {
      claimId,
      tokenHash: hashToken(token),
      expiresAt: verificationTokenExpiresAt(now, this.dependencies.campaign),
      usedAt: null
    });

    if (result.verificationPrepared) {
      const url = new URL(this.dependencies.verificationBaseUrl);
      url.searchParams.set("token", token);
      try {
        await this.dependencies.sendVerification(result.claim.normalizedEmail, url.toString());
      } catch (error) {
        await this.dependencies.recordDeliveryFailure?.(result.claim.id);
        throw error;
      }
    }

    return result;
  }

  async verify(token: string): Promise<PrizeClaimRecord> {
    const now = this.now();
    if (campaignPhase(now, this.dependencies.campaign) === "verification_closed") {
      throw new DomainError("conflict", "Период подтверждения завершён.");
    }
    return this.dependencies.claims.verifyByTokenHash(hashToken(token), now, this.dependencies.campaign.slug);
  }
}
