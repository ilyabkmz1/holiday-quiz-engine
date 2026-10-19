type CampaignWindow = {
  startsAt: string;
  claimEndsAt: string;
  verificationEndsAt: string;
};

export type CampaignPhase = "upcoming" | "open" | "claim_closed" | "verification_closed";

export function campaignPhase(now: Date, campaign: CampaignWindow): CampaignPhase {
  const timestamp = now.getTime();
  if (timestamp < new Date(campaign.startsAt).getTime()) {
    return "upcoming";
  }
  if (timestamp <= new Date(campaign.claimEndsAt).getTime()) {
    return "open";
  }
  if (timestamp <= new Date(campaign.verificationEndsAt).getTime()) {
    return "claim_closed";
  }
  return "verification_closed";
}

export function verificationTokenExpiresAt(now: Date, campaign: CampaignWindow): Date {
  const twentyFourHours = now.getTime() + 24 * 60 * 60 * 1000;
  const campaignDeadline = new Date(campaign.verificationEndsAt).getTime();
  return new Date(Math.min(twentyFourHours, campaignDeadline));
}
