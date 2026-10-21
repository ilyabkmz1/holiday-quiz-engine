import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { participantFromRequest } from "@/server/advent-api";
import { loadTeamLeaderboard } from "@/server/advent-metrics";
import { resolveNow } from "@/server/advent-time";
import { apiError, guardPublicRequest } from "@/server/api";
import { getAdventServices } from "@/server/container";
import { DomainError } from "@/domain/errors";
import { adventTenantFromHeaders } from "@/server/tenants";

export const dynamic = "force-dynamic";

/**
 * Публичный рейтинг команд (`audience.leaderboard = "teams"`): только округлённые агрегаты по командам, без имён людей и точного
 * числа участников; у команды меньше `MIN_GROUP` участников цифр и места нет. Кэш в процессе на несколько минут. Выбранную команду участника подсвечивает клиент.
 */
export async function GET(request: NextRequest) {
  const blocked = guardPublicRequest(request);
  if (blocked) return blocked;
  try {
    const tenant = adventTenantFromHeaders(request.headers);
    const now = resolveNow(request, tenant);
    const { adventService, repository } = getAdventServices(tenant);
    const participant = await participantFromRequest(request, adventService, tenant);
    const board = await loadTeamLeaderboard(repository, tenant.advent, now, participant?.teamId ?? null);
    if (!board) throw new DomainError("not_found", "Рейтинга команд в этой кампании нет.");
    return NextResponse.json(board, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
