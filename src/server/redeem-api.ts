import type { RedeemInspection, RedeemResult } from "@/server/services/reward-service";

/** Код ответа по исходу: успех — 200, остальное различимо и для клиента, и в журнале прокси. */
export function redeemHttpStatus(status: string): number {
  switch (status) {
    case "redeemed":
      return 200;
    case "not_found":
      return 404;
    case "invalid":
      return 400;
    default:
      return 409;
  }
}

/** Сериализация для JSON: даты — ISO. Код награды в ответ не попадает. */
export function redeemBody(result: RedeemResult | RedeemInspection): Record<string, unknown> {
  if (!("grantId" in result)) return { ...result };
  return { ...result, expiresAt: result.expiresAt?.toISOString() ?? null, redeemedAt: result.redeemedAt?.toISOString() ?? null };
}

