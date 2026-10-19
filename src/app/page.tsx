import "@/components/quest/quest.css";
import { QuizGame } from "@/components/game/QuizGame";
import { QuestGame } from "@/components/quest/QuestGame";
import { AdventPlaceholder } from "@/components/advent/AdventPlaceholder";
import { getNow } from "@/server/container";
import { anyTenantForPage } from "@/server/page-tenant";
import { resolveMode } from "@/server/play-mode";
import { publicCampaign } from "@/server/presentation";
import { isAdventTenant } from "@/server/tenants";
import { loadWorld } from "@/worlds/registry";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const tenant = await anyTenantForPage();
  if (isAdventTenant(tenant)) {
    // Настоящий интерфейс адвента появится на этапе A3; пока — заглушка в бренде с датой старта.
    const { advent } = tenant;
    return <AdventPlaceholder advent={advent} now={getNow()} />;
  }
  const { mode: requested } = await searchParams;
  // Публичный срез кампании без признаков правильности: тот же, что отдаёт API.
  const campaign = publicCampaign(tenant.campaign, tenant.worldId);
  // Мир пакета уходит клиенту вместе с кампанией: разметка и иллюстрации не содержат ответов и контента бизнеса.
  const world = loadWorld(tenant.worldId);
  return resolveMode(campaign.mode, requested) === "cards" ? <QuizGame campaign={campaign} world={world} /> : <QuestGame campaign={campaign} world={world} />;
}
