import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { guardPublicRequest } from "@/server/api";
import { getServices } from "@/server/container";
import { getRuntimeEnv } from "@/server/env";
import { findTenant, tenantBaseUrl } from "@/server/tenants";
import { publicUrl } from "@/server/urls";

const tokenSchema = z.string().min(20).max(200);

export async function GET(request: NextRequest) {
  const blocked = guardPublicRequest(request);
  if (blocked) return blocked;
  // Неизвестный Host — не 500, а та же страница ошибки на общем адресе.
  const found = findTenant(request.headers.get("host"));
  // На адвент-арендаторе заявок на приз квиза нет: маршрута для него не существует.
  if (found?.experience === "advent") return NextResponse.json({ error: "Квиз по этому адресу не найден." }, { status: 404 });
  const tenant = found;
  const baseUrl = tenant ? tenantBaseUrl(tenant, getRuntimeEnv().APP_URL) : getRuntimeEnv().APP_URL;
  try {
    if (!tenant) throw new Error("tenant_not_found");
    const token = tokenSchema.parse(request.nextUrl.searchParams.get("token"));
    const claim = await getServices(tenant).claimService.verify(token);
    console.info(JSON.stringify({ event: "claim_verified", claimId: claim.id }));
    return NextResponse.redirect(publicUrl(baseUrl, "/verify?status=success"));
  } catch {
    console.info(JSON.stringify({ event: "claim_verification_failed", category: "invalid_or_expired" }));
    return NextResponse.redirect(publicUrl(baseUrl, "/verify?status=error"));
  }
}
