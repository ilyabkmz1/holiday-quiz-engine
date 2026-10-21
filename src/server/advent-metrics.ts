import type { AdventConfig } from "@/config/advent-schema";
import type { ReminderRepository } from "@/server/repositories/advent-repository";

export type AdventReminderMetrics = {
  channel: "email" | "off";
  /** Подписаны на напоминания (подтверждённый email). */
  subscribed: number;
  /** Отписались и не включили снова. */
  unsubscribed: number;
  /** По дням кампании от 1 до N; дни без писем — нули. */
  days: Array<{
    day: number;
    title: string;
    sent: number;
    /** Не ушли (в очереди на повтор или попытки исчерпаны) и заявленные, но не подтверждённые отправкой. */
    failed: number;
    /** Нажали кнопку в письме. */
    clicked: number;
    /** Открыли этот день уже после отправки письма. */
    openedAfter: number;
  }>;
};

export type AdventMetrics = { generatedAt: string; reminders: AdventReminderMetrics };

/** Метрики адвента для оператора: только агрегаты, без email и токенов. */
export async function loadAdventMetrics(repository: ReminderRepository, advent: Pick<AdventConfig, "slug" | "days" | "reminders">, now: Date): Promise<AdventMetrics> {
  const stats = await repository.reminderStats(advent.slug);
  const byDay = new Map(stats.days.map((row) => [row.day, row]));
  return {
    generatedAt: now.toISOString(),
    reminders: {
      channel: advent.reminders.channel,
      subscribed: stats.subscribed,
      unsubscribed: stats.unsubscribed,
      days: advent.days.map((day) => ({
        day: day.n,
        title: day.title,
        sent: byDay.get(day.n)?.sent ?? 0,
        failed: byDay.get(day.n)?.failed ?? 0,
        clicked: byDay.get(day.n)?.clicked ?? 0,
        openedAfter: byDay.get(day.n)?.openedAfter ?? 0
      }))
    }
  };
}
