import { NextResponse } from "next/server";

import { appVersion } from "@/server/version";

// Версия читается при запросе, а не на этапе сборки: образ собирают один раз, APP_VERSION может прийти из окружения.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok", version: appVersion() }, { headers: { "cache-control": "no-store" } });
}
