import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { campaignPhase } from "@/domain/window";
import { apiError, guardSessionCreation, SESSION_COOKIE } from "@/server/api";
import { getNow, getServices } from "@/server/container";
import { getRuntimeEnv, isForceOpenAllowed } from "@/server/env";
import { publicCampaign } from "@/server/presentation";
import type { CreateSessionResponse } from "@/types/api";
import { tenantFromHeaders } from "@/server/tenants";

export async function POST(request: NextRequest) {
  const blocked = guardSessionCreation(request);
  if (blocked) return blocked;

  try {
    const tenant = tenantFromHeaders(request.headers);
    const { campaign } = tenant;
    const env = getRuntimeEnv();
    if (!isForceOpenAllowed(env) && campaignPhase(getNow(), campaign) !== "open") {
      return NextResponse.json({ error: "Квиз пока закрыт." }, { status: 403 });
    }
    const { prisma, sessionService } = getServices(tenant);
    await prisma.campaign.upsert({
      where: { slug: campaign.slug },
      update: { title: campaign.title },
      create: { slug: campaign.slug, title: campaign.title }
    });
    const created = await sessionService.create();
    const body: CreateSessionResponse = {
      sessionId: created.session.id,
      campaign: publicCampaign(tenant.campaign, tenant.worldId),
      session: await sessionService.progress(created.session.id)
    };
    const response = NextResponse.json(body);
    response.cookies.set(SESSION_COOKIE, created.accessKey, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      path: "/",
      expires: new Date(campaign.verificationEndsAt)
    });
    console.info(JSON.stringify({ event: "session_started", sessionId: created.session.id }));
    return response;
  } catch (error) {
    return apiError(error);
  }
}
