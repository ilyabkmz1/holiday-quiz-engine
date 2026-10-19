import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { adminAuthorized } from "@/server/admin";
import { adminGate } from "@/server/admin-gate";
import { getRuntimeEnv } from "@/server/env";
import { authRealm } from "@/server/realm";
import { shareGate } from "@/server/share-gate";
import { stagingGate } from "@/server/staging-gate";

// Proxy (бывший middleware в Next.js 16) работает в Node.js runtime. Здесь два замка:
// закрытый стенд (staging: без STAGING_USERNAME/STAGING_PASSWORD пропускает без изменений) и страницы
// оператора /admin (всегда ADMIN_*); плюс лимит по IP на публичные /share/*. У /admin staging-пароль не действует: заголовок Authorization один.
export async function proxy(request: NextRequest) {
  const env = getRuntimeEnv();
  const host = request.headers.get("host");
  return stagingGate(request, env, authRealm(host, "staging")) ?? (await adminGate(request, adminAuthorized, authRealm(host))) ?? shareGate(request) ?? NextResponse.next();
}
