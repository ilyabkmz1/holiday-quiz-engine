import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getRuntimeEnv } from "@/server/env";
import { tlsAskDecision } from "@/server/tls-ask";

export const dynamic = "force-dynamic";

/** Вызывает только Caddy из сети Compose (`ask` в Caddyfile.shared); снаружи путь закрыт самим Caddy. Домен в ответе не эхом, в журнал ничего не пишется. */
export function GET(request: NextRequest) {
  const { TLS_ASK_TOKEN, TENANT_BASE_DOMAIN } = getRuntimeEnv();
  const params = request.nextUrl.searchParams;
  const status = tlsAskDecision(params.get("domain"), params.get("token"), { TLS_ASK_TOKEN, TENANT_BASE_DOMAIN });
  return new NextResponse(null, { status, headers: { "cache-control": "no-store" } });
}
