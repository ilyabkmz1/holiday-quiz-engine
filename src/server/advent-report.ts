import { cachedPerTenant, loadAdventAnalytics, type CacheEntry } from "@/server/advent-metrics";
import { getAdventServices, getNow } from "@/server/container";
import type { AdventTenant } from "@/server/tenants";
import type { AdventAnalytics } from "@/types/advent-analytics";

/** Сколько миллисекунд метрики панели живут в кэше процесса. */
export const ANALYTICS_TTL_MS = 60 * 1000;

const analyticsCache = new Map<string, CacheEntry<AdventAnalytics>>();

/** Сбросить кэш метрик панели (тесты). */
export function clearAnalyticsCache(): void {
  analyticsCache.clear();
}

/**
 * Метрики кампании для панели, отчёта и CSV: один путь, чтобы цифры везде совпадали. Кэш на арендатора на `ANALYTICS_TTL_MS`:
 * `analyticsRaw` и `teamStats` на 100 тыс. участников — секунды, а оператор открывает панель, отчёт и три CSV подряд.
 * Метрики считаются на момент пересчёта: `generatedAt` — «данные на».
 */
export async function loadTenantAnalytics(tenant: AdventTenant, now: Date = getNow()): Promise<AdventAnalytics> {
  const entry = cachedPerTenant(analyticsCache, `${tenant.tenant}:${tenant.advent.slug}`, now, ANALYTICS_TTL_MS, async (at) => {
    const { rewardService, repository } = getAdventServices(tenant);
    return loadAdventAnalytics(repository, tenant.advent, at, await rewardService.overview());
  });
  return entry.value;
}
