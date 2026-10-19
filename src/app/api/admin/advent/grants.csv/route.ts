import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/server/admin";
import { apiError } from "@/server/api";
import { getAdventServices } from "@/server/container";
import { grantsToCsv } from "@/server/csv";
import { adventTenantFromHeaders } from "@/server/tenants";

export const dynamic = "force-dynamic";

/** Выгрузка выдач наград адвента (без email и кодов). Только читает, как `claims.csv`; доступна оператору. */
export async function GET(request: NextRequest) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  try {
    const tenant = adventTenantFromHeaders(request.headers);
    const { rewardService } = getAdventServices(tenant);
    const rows = await rewardService.exportGrants();
    const csv = grantsToCsv(
      rows.map((row) => ({
        id: row.id,
        rewardId: row.rewardId,
        rewardLabel: row.label,
        day: row.day,
        source: row.source,
        status: row.status,
        createdAt: row.createdAt,
        redeemedAt: row.redeemedAt,
        expiresAt: row.expiresAt
      }))
    );
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${tenant.tenant}-advent-grants.csv"`,
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    return apiError(error);
  }
}
