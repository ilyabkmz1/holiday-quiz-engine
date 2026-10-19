import type { Metadata } from "next";
import { notFound } from "next/navigation";

import "@/components/quest/quest.css";
import { QuestGame } from "@/components/quest/QuestGame";
import { publicCampaign } from "@/server/presentation";
import { isQuestEnabled } from "@/server/quest-flag";
import { quizTenantForPage } from "@/server/page-tenant";
import { loadWorld } from "@/worlds/registry";

export async function generateMetadata(): Promise<Metadata> {
  const { campaign } = await quizTenantForPage();
  return { title: `Квест: ${campaign.story.placeTitle} · ${campaign.brand.name}`, robots: { index: false, follow: false } };
}

// Флаг читается при запросе: прототип включается окружением, а не сборкой.
export const dynamic = "force-dynamic";

export default async function QuestPage() {
  if (!isQuestEnabled()) notFound();
  const tenant = await quizTenantForPage();
  return <QuestGame campaign={{ ...publicCampaign(tenant.campaign, tenant.worldId), mode: "quest" }} world={loadWorld(tenant.worldId)} />;
}
