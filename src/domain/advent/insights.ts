import type { AdventAnalytics, AnalyticsInsight } from "@/types/advent-analytics";

import { MIN_GROUP } from "./analytics";

/** Пороги простых правил выводов; меняются здесь и в методике отчёта. */
export const INSIGHT_THRESHOLDS = {
  /** Возврат на следующий день: ниже — слабо, выше — хорошо. */
  d1Low: 0.2,
  d1High: 0.4,
  /** Падение доли открывших в свой день к концу кампании (в долях, 0.15 = 15 п. п.). */
  dropOff: 0.15,
  /** Доля подтвердивших email среди открывших дверь. */
  signupLow: 0.1,
  /** Погашение наград с кодом. */
  redeemLow: 0.3,
  redeemHigh: 0.6,
  /** Доля догнавших среди всех открытий. */
  catchUpHigh: 0.25,
  /** Открыли день после письма от отправленных. */
  reminderLow: 0.1
} as const;

const percent = (value: number): string => `${Math.round(value * 100)}%`;
const plural = (n: number, one: string, few: string, many: string): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Автоматические выводы по простым правилам (без нейросетей): каждое правило смотрит на числа метрик и пишет одну фразу.
 * Правила молчат, пока основание меньше порога малых групп (`MIN_GROUP`): выводы по горстке людей вводят в заблуждение.
 */
export function buildInsights(data: AdventAnalytics): AnalyticsInsight[] {
  const out: AnalyticsInsight[] = [];
  const { kpis } = data;
  const T = INSIGHT_THRESHOLDS;

  if (kpis.players < MIN_GROUP) {
    return [{ key: "few-data", tone: "info", text: "Пока данных слишком мало для выводов: нужно хотя бы 5 человек, открывших дверь." }];
  }

  out.push({
    key: "reach",
    tone: "info",
    text: `В кампании ${kpis.participants} ${plural(kpis.participants, "участник", "участника", "участников")}, дверь открыли ${kpis.players} (${percent(kpis.players / kpis.participants)}). В среднем открыто ${kpis.doorsAvg?.toFixed(1).replace(".", ",") ?? "—"} из ${data.totalDays}.`
  });

  // Тренд и лучшие дни — по тем, кто играл и до этого дня: новички дня почти всегда открывают текущую дверь и завышают начало.
  const measured = data.days.filter((day) => day.status === "closed" && day.returningShare !== null && day.returning >= MIN_GROUP);
  if (measured.length >= 3) {
    const third = Math.max(1, Math.floor(measured.length / 3));
    const first = mean(measured.slice(0, third).map((day) => day.returningShare!));
    const last = mean(measured.slice(-third).map((day) => day.returningShare!));
    if (first - last >= T.dropOff) {
      out.push({ key: "trend", tone: "watch", text: `К концу кампании интерес снизился: из тех, кто уже играл, в тот же день дверь открывали ${percent(first)} в начале и ${percent(last)} в конце. Напоминания и более яркие призы во второй половине могут помочь удержать людей.` });
    } else if (last - first >= -0.05) {
      out.push({ key: "trend", tone: "good", text: `Интерес держался всю кампанию: из тех, кто уже играл, в тот же день дверь открывали ${percent(first)} в начале и ${percent(last)} в конце.` });
    }
  }
  if (data.bestDays[0]?.returningShare != null) {
    const best = data.bestDays[0];
    out.push({ key: "best-day", tone: "good", text: `Лучший день — ${best.day}-й «${best.title}»: в тот же день его открыли ${percent(best.returningShare!)} людей, игравших до этого.` });
  }
  if (data.weakDays[0]?.returningShare != null && data.weakDays[0].day !== data.bestDays[0]?.day) {
    const weak = data.weakDays[0];
    out.push({ key: "weak-day", tone: "watch", text: `Слабее всего прошёл ${weak.day}-й день «${weak.title}»: в тот же день его открыли ${percent(weak.returningShare!)} людей, игравших до этого. Проверьте анонс и сложность задания.` });
  }

  if (kpis.d1.share !== null && kpis.d1.base >= MIN_GROUP) {
    if (kpis.d1.share < T.d1Low) {
      out.push({ key: "d1", tone: "watch", text: `На следующий день возвращаются ${percent(kpis.d1.share)} новых участников. Это немного: стоит предложить сохранить прогресс по email и включить напоминания сразу после первой двери.` });
    } else if (kpis.d1.share >= T.d1High) {
      out.push({ key: "d1", tone: "good", text: `На следующий день возвращаются ${percent(kpis.d1.share)} новых участников — это хороший показатель.` });
    }
  }

  const signup = data.registration.find((step) => step.key === "email");
  if (signup && kpis.players > 0 && signup.count / kpis.players < T.signupLow) {
    out.push({ key: "signup", tone: "watch", text: `Email подтвердили ${percent(signup.count / kpis.players)} игроков. Чтобы собрать больше контактов, сделайте награду, которую нужно получить после входа (код или подарок), заметнее.` });
  }

  const redeemable = data.rewards.filter((reward) => reward.redeemable);
  const issued = redeemable.reduce((sum, reward) => sum + reward.issued, 0);
  const redeemed = redeemable.reduce((sum, reward) => sum + reward.redeemed, 0);
  if (issued >= MIN_GROUP) {
    const rate = redeemed / issued;
    if (rate < T.redeemLow) {
      out.push({ key: "redeem", tone: "watch", text: `Погашено ${percent(rate)} выданных наград с кодом (${redeemed} из ${issued}). Проверьте, что кассиры знают про акцию, а срок действия кодов достаточен.` });
    } else if (rate >= T.redeemHigh) {
      out.push({ key: "redeem", tone: "good", text: `Погашено ${percent(rate)} выданных наград с кодом (${redeemed} из ${issued}): подарки доходят до кассы.` });
    }
    const expired = redeemable.reduce((sum, reward) => sum + reward.expired, 0);
    if (expired / issued >= 0.2) {
      out.push({ key: "expired", tone: "watch", text: `У ${expired} ${plural(expired, "награды", "наград", "наград")} истёк срок, они не погашены. Возможно, срок действия слишком короткий.` });
    }
  }

  for (const reward of data.rewards) {
    if (reward.stockLeft === 0 && reward.stockTotal) {
      out.push({ key: `stock-${reward.rewardId}`, tone: "info", text: `Приз «${reward.label}» разыгран полностью (${reward.stockTotal}). Дальше удача разыгрывает остальные призы пула.` });
    }
    if (reward.codesTotal !== null && reward.codesFree === 0 && reward.codesTotal > 0) {
      out.push({ key: `pool-${reward.rewardId}`, tone: "watch", text: `Коды награды «${reward.label}» закончились. Загрузите ещё, иначе участники получат пустую выдачу.` });
    }
  }

  const opened = data.days.reduce((sum, day) => sum + day.opened, 0);
  const caught = data.days.reduce((sum, day) => sum + day.caughtUp, 0);
  if (opened >= MIN_GROUP && caught / opened >= T.catchUpHigh) {
    out.push({ key: "catch-up", tone: "info", text: `${percent(caught / opened)} дверей открыты с опозданием: люди возвращаются к пропущенному. Догнанные двери засчитываются в прогресс, но не в серию.` });
  }

  if (data.reminders && data.reminders.channel === "email" && data.reminders.sent >= MIN_GROUP) {
    const rate = data.reminders.openedAfter / data.reminders.sent;
    out.push({
      key: "reminders",
      tone: rate < T.reminderLow ? "watch" : "good",
      text: `После письма-напоминания день открыли в ${percent(rate)} случаев (${data.reminders.openedAfter} из ${data.reminders.sent} писем).${rate < T.reminderLow ? " Попробуйте другую тему письма или время отправки." : ""}`
    });
  }

  const ranked = data.teams?.filter((team) => !team.hidden && team.rank !== null) ?? [];
  if (ranked.length >= 2) {
    const leader = ranked[0];
    const last = ranked[ranked.length - 1];
    out.push({ key: "teams", tone: "info", text: `Впереди — ${leader.title}: в среднем ${leader.avgDoors!.toFixed(1).replace(".", ",")} открытых дверей на участника, у замыкающей, ${last.title}, — ${last.avgDoors!.toFixed(1).replace(".", ",")}.` });
  }
  return out;
}
