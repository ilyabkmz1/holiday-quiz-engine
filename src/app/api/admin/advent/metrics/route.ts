import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/server/admin";
import { apiError } from "@/server/api";
import { loadAdventMetrics } from "@/server/advent-metrics";
import { getAdventServices, getNow } from "@/server/container";
import { adventTenantFromHeaders } from "@/server/tenants";

export const dynamic = "force-dynamic";

/** Метрики адвента для оператора (A5: напоминания по дням, подписанные и отписавшиеся). Только агрегаты, без email. */
export async function GET(request: NextRequest) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  try {
    const tenant = adventTenantFromHeaders(request.headers);
    const { repository } = getAdventServices(tenant);
    const metrics = await loadAdventMetrics(repository, tenant.advent, getNow());
    return NextResponse.json(metrics, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
