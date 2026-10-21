import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/server/admin";
import { apiError } from "@/server/api";
import { loadAdventMetrics } from "@/server/advent-metrics";
import { resolveNow } from "@/server/advent-time";
import { getAdventServices } from "@/server/container";
import { loadTenantAnalytics } from "@/server/advent-report";
import { adventTenantFromHeaders } from "@/server/tenants";

export const dynamic = "force-dynamic";

/** Метрики адвента для оператора: напоминания по дням (A5) и сводка кампании `analytics` (A7). Только агрегаты, без email. */
export async function GET(request: NextRequest) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  try {
    const tenant = adventTenantFromHeaders(request.headers);
    const { repository } = getAdventServices(tenant);
    const now = resolveNow(request, tenant);
    const [metrics, analytics] = await Promise.all([loadAdventMetrics(repository, tenant.advent, now), loadTenantAnalytics(tenant, now)]);
    return NextResponse.json({ ...metrics, analytics }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
