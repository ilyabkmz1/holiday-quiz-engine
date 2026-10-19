import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/server/admin";
import { apiError } from "@/server/api";
import { getPrisma } from "@/server/db";
import { tenantFromHeaders } from "@/server/tenants";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  try {
    const { campaign } = tenantFromHeaders(request.headers);
    const prisma = getPrisma();
    const [started, completed, verified, emailFailures] = await Promise.all([
      prisma.gameSession.count({ where: { campaignSlug: campaign.slug } }),
      prisma.gameSession.count({ where: { campaignSlug: campaign.slug, status: "completed" } }),
      prisma.prizeClaim.count({
        where: {
          campaignSlug: campaign.slug,
          status: { in: ["email_verified", "exported", "fulfilled"] }
        }
      }),
      prisma.auditEvent.count({ where: { eventType: "verification_email_failed" } })
    ]);
    return NextResponse.json(
      { campaign: campaign.slug, started, completed, verified, emailFailures },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return apiError(error);
  }
}
