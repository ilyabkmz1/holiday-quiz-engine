import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/server/admin";
import { apiError } from "@/server/api";
import { cohortsMetricsToCsv, daysMetricsToCsv, rewardsMetricsToCsv } from "@/server/csv";
import { loadTenantAnalytics } from "@/server/advent-report";
import { resolveNow } from "@/server/advent-time";
import { adventTenantFromHeaders } from "@/server/tenants";
import type { AdventAnalytics } from "@/types/advent-analytics";

export const dynamic = "force-dynamic";

const EXPORTS: Record<string, (data: AdventAnalytics) => string> = {
  "days.csv": (data) => daysMetricsToCsv(data.days),
  "rewards.csv": (data) => rewardsMetricsToCsv(data.rewards),
  "cohorts.csv": (data) => cohortsMetricsToCsv(data.cohorts)
};

/** CSV-выгрузки агрегатов адвента (`days.csv`, `rewards.csv`, `cohorts.csv`): без email и кодов, текст защищён от формул. Только оператор. */
export async function GET(request: NextRequest, context: { params: Promise<{ name: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  try {
    const { name } = await context.params;
    const build = Object.hasOwn(EXPORTS, name) ? EXPORTS[name] : undefined;
    if (!build) return NextResponse.json({ error: "Такой выгрузки нет." }, { status: 404 });
    const tenant = adventTenantFromHeaders(request.headers);
    const csv = build(await loadTenantAnalytics(tenant, resolveNow(request, tenant)));
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${tenant.tenant}-advent-${name}"`,
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    return apiError(error);
  }
}
