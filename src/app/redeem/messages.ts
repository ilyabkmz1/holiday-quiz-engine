/** Результат проверки или погашения в том виде, в каком его отдаёт `/api/advent/redeem` (даты — ISO). */
export type RedeemView = {
  status: "ready" | "redeemed" | "already_redeemed" | "expired" | "not_found" | "invalid" | "not_redeemable" | "needs_qr" | "pending";
  label?: string;
  description?: string;
  expiresAt?: string | null;
  redeemedAt?: string | null;
  day?: number;
};

export function formatMoment(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** Тон сообщения для оформления: зелёный — можно или погашено, жёлтый — нельзя по понятной причине, красный — не найдено. */
export function tone(status: RedeemView["status"]): "ok" | "warn" | "bad" {
  if (status === "ready" || status === "redeemed") return "ok";
  return status === "not_found" || status === "invalid" ? "bad" : "warn";
}

/**
 * Заголовок и пояснение для кассира. Статус `redeemed` у предпросмотра означает «уже погашен», а у ответа на погашение —
 * «только что погашен»; поэтому для погашения передаётся `justRedeemed`.
 */
export function describeRedeem(view: RedeemView, timeZone: string, justRedeemed = false): { title: string; text: string } {
  const when = (iso?: string | null) => (iso ? formatMoment(iso, timeZone) : "");
  switch (view.status) {
    case "ready":
      return { title: "Можно погасить", text: view.expiresAt ? `Действует до ${when(view.expiresAt)}.` : "Срок не ограничен." };
    case "redeemed":
      return justRedeemed ? { title: "Погашено", text: "Выдайте награду гостю." } : { title: `Уже погашен ${when(view.redeemedAt)}`, text: "Повторно выдавать награду нельзя." };
    case "already_redeemed":
      return { title: `Уже погашен ${when(view.redeemedAt)}`, text: "Повторно выдавать награду нельзя." };
    case "expired":
      return { title: "Срок истёк", text: view.expiresAt ? `Действовал до ${when(view.expiresAt)}.` : "" };
    case "not_found":
      return { title: "Не найден", text: "Проверьте код или попросите гостя показать QR ещё раз." };
    case "invalid":
      return { title: "QR не распознан", text: "Код повреждён или не принадлежит этой акции." };
    case "not_redeemable":
      return { title: "Не гасится на кассе", text: "Эта награда используется другим способом." };
    case "needs_qr":
      return { title: "Нужен личный QR", text: "Общий код на кассе не гасится: попросите гостя открыть награду и показать QR." };
    case "pending":
      return { title: "Код ещё не назначен", text: "Гость увидит код позже. Попросите зайти в приложение ещё раз." };
  }
}
