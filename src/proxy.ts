import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { adminAuthorized, redeemAuthorized } from "@/server/admin";
import { adminGate, redeemGate } from "@/server/admin-gate";
import { getRuntimeEnv } from "@/server/env";
import { frameHeaders } from "@/server/frame-policy";
import { authRealm } from "@/server/realm";
import { shareGate } from "@/server/share-gate";
import { stagingGate } from "@/server/staging-gate";

// Proxy (бывший middleware в Next.js 16) работает в Node.js runtime. Здесь два замка:
// закрытый стенд (staging: без STAGING_USERNAME/STAGING_PASSWORD пропускает без изменений) и страницы
// оператора /admin (всегда ADMIN_*); плюс лимит по IP на публичные /share/*. У /admin staging-пароль не действует: заголовок Authorization один.
export async function proxy(request: NextRequest) {
  const env = getRuntimeEnv();
  const host = request.headers.get("host");
  const response =
    stagingGate(request, env, authRealm(host, "staging")) ??
    (await adminGate(request, adminAuthorized, authRealm(host))) ??
    (await redeemGate(request, redeemAuthorized, authRealm(host))) ??
    shareGate(request) ??
    NextResponse.next();
  // Защита от встраивания во фрейм ставится здесь, а не в next.config: для адвента с Telegram она пускает фреймы Telegram Web.
  for (const [name, value] of Object.entries(frameHeaders(host, request.nextUrl.pathname))) response.headers.set(name, value);
  return response;
}
