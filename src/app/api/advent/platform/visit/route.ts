import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { unauthorized } from "@/server/advent-api";
import { apiError, guardPublicRequest } from "@/server/api";
import { getAdventServices, getNow } from "@/server/container";
import { telegramCaller } from "@/server/telegram-auth";
import { adventTenantFromHeaders } from "@/server/tenants";

/**
 * Открытие мини-приложения: учитывает метку источника из подписанного `start_param` (`s_<метка>`). Только счётчик по дням,
 * без участника и персональных данных. Метка берётся из проверенных данных запуска, а не из тела запроса.
 */
export async function POST(request: NextRequest) {
  const blocked = guardPublicRequest(request, true);
  if (blocked) return blocked;
  try {
    const tenant = adventTenantFromHeaders(request.headers);
    const caller = telegramCaller(request.headers, tenant);
    if (!caller) return unauthorized();
    if (caller.start.source) {
      const { prisma, adventService } = getAdventServices(tenant);
      await prisma.campaign.upsert({ where: { slug: tenant.advent.slug }, update: {}, create: { slug: tenant.advent.slug, title: tenant.advent.title } });
      await adventService.recordSourceVisit(caller.start.source, getNow());
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
