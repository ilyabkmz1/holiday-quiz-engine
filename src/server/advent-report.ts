import { loadAdventAnalytics } from "@/server/advent-metrics";
import { getAdventServices, getNow } from "@/server/container";
import type { AdventTenant } from "@/server/tenants";
import type { AdventAnalytics } from "@/types/advent-analytics";

/** Метрики кампании «сейчас» для панели, отчёта и CSV: один путь, чтобы цифры везде совпадали. */
export async function loadTenantAnalytics(tenant: AdventTenant, now: Date = getNow()): Promise<AdventAnalytics> {
  const { rewardService, repository } = getAdventServices(tenant);
  return loadAdventAnalytics(repository, tenant.advent, now, await rewardService.overview());
}
