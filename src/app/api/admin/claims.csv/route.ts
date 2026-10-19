import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/server/admin";
import { apiError } from "@/server/api";
import { claimsToCsv } from "@/server/csv";
import { getPrisma } from "@/server/db";
import { tenantFromHeaders } from "@/server/tenants";

export const dynamic = "force-dynamic";

/** Только читает: статус заявок меняет отдельный POST /api/admin/claims/export (защита от CSRF через GET). */
export async function GET(request: NextRequest) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  try {
    const { campaign, tenant: tenantSlug } = tenantFromHeaders(request.headers);
    const prisma = getPrisma();
    const rows = await prisma.prizeClaim.findMany({
      where: {
        campaignSlug: campaign.slug,
        status: { in: ["email_verified", "exported", "fulfilled"] },
        verifiedAt: { not: null }
      },
      include: { session: true },
      orderBy: { verifiedAt: "asc" }
    });
    const csv = claimsToCsv(rows.map((row) => ({
      name: row.name,
      normalizedEmail: row.normalizedEmail,
      company: row.company,
      score: row.session.score ?? 0,
      rewardTierTitle: row.session.rewardTierTitle ?? "",
      verifiedAt: row.verifiedAt!
    })));
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${tenantSlug}-quiz-claims.csv"`,
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    return apiError(error);
  }
}
