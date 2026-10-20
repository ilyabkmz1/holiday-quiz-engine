import type { AdventConfig } from "@/config/advent-schema";
import {
  MIN_GROUP,
  MIN_PUBLIC_TEAM,
  adventPhase,
  bestStreakHistogram,
  buildInsights,
  dayIndexAt,
  dayLocalDate,
  dayUnlockAt,
  histogramStats,
  localDateAt,
  rankTeams,
  retentionRate,
  share
} from "@/domain/advent";
import type { AnalyticsRepository, GrantSource, ReminderRepository } from "@/server/repositories/advent-repository";
import type { RewardOverviewRow } from "@/server/services/reward-service";
import type {
  AdventAnalytics,
  AnalyticsCohort,
  AnalyticsDay,
  AnalyticsReward,
  AnalyticsRewardGroup,
  AnalyticsTeam,
  TeamLeaderboard
} from "@/types/advent-analytics";

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

/** Смещения возврата в когортной таблице: на следующие сутки, на третьи и на седьмые. */
export const RETENTION_OFFSETS = [1, 3, 7] as const;

const GROUP_LABELS: Record<GrantSource, string> = {
  day: "Подарок дня",
  luck: "Удача",
  goal: "Цель серии",
  comeback: "Возвращение",
  endowed: "Подарок за старт"
};
const KIND_LABELS = { promo: "Промокод", gift: "Подарок", points: "Баллы", finalEntry: "Участие в финале" } as const;

type AnalyticsSource = AnalyticsRepository & ReminderRepository;
type AnalyticsConfig = Pick<AdventConfig, "slug" | "title" | "days" | "schedule" | "streak" | "rewards" | "reminders" | "audience">;

function groupRow(key: string, label: string, parts: Array<{ issued: number; redeemed: number; expired: number; redeemable: boolean }>): AnalyticsRewardGroup {
  const issued = parts.reduce((sum, row) => sum + row.issued, 0);
  const redeemed = parts.reduce((sum, row) => sum + row.redeemed, 0);
  const expired = parts.reduce((sum, row) => sum + row.expired, 0);
  // Доля погашения — только по наградам, которые вообще можно погасить: баллы и участие в финале «не погашаются».
  const base = parts.filter((row) => row.redeemable).reduce((sum, row) => sum + row.issued, 0);
  const done = parts.filter((row) => row.redeemable).reduce((sum, row) => sum + row.redeemed, 0);
  return { key, label, issued, redeemed, expired, redeemShare: share(done, base) };
}

/**
 * Метрики кампании для панели оператора и отчёта клиенту. Данные — SQL-агрегаты (`analyticsRaw`), без email и идентификаторов
 * участников. Сутки делятся в часовом поясе кампании. Подробно о подсчёте — «Методика» в `docs/engine/ADVENT_PLAN.md`.
 */
export async function loadAdventAnalytics(
  repository: AnalyticsSource,
  advent: AnalyticsConfig,
  now: Date,
  overview: readonly RewardOverviewRow[]
): Promise<AdventAnalytics> {
  const { schedule } = advent;
  const today = dayIndexAt(now, schedule);
  const todayLocal = localDateAt(now, schedule.timezone);
  const finale = new Date(schedule.finaleAt);
  const windows = advent.days.map((day) => ({
    day: day.n,
    end: day.n < schedule.days ? dayUnlockAt(day.n + 1, schedule) : finale,
    blocks: day.blocks.length
  }));
  const [raw, reminderStats, teamRaw] = await Promise.all([
    repository.analyticsRaw({ campaignSlug: advent.slug, timezone: schedule.timezone, today: todayLocal, now, windows, retentionOffsets: RETENTION_OFFSETS }),
    advent.reminders.channel === "email" ? repository.reminderStats(advent.slug) : Promise.resolve(null),
    advent.audience.leaderboard === "teams" ? repository.teamStats(advent.slug) : Promise.resolve([])
  ]);

  const opens = new Map(raw.opens.map((row) => [row.day, row]));
  const completed = new Map(raw.completed.map((row) => [row.day, row.count]));
  const active = new Map(raw.activeByDay.map((row) => [row.day, row]));
  const days: AnalyticsDay[] = advent.days.map((day) => {
    const window = windows.find((candidate) => candidate.day === day.n)!;
    const status = now.getTime() < dayUnlockAt(day.n, schedule).getTime() ? "future" : now.getTime() < window.end.getTime() ? "running" : "closed";
    const row = opens.get(day.n) ?? { onTime: 0, caughtUp: 0 };
    const base = active.get(day.n) ?? { active: 0, opened: 0 };
    return {
      day: day.n,
      title: day.title,
      date: dayLocalDate(day.n, schedule),
      status,
      onTime: row.onTime,
      caughtUp: row.caughtUp,
      opened: row.onTime + row.caughtUp,
      active: status === "future" ? 0 : base.active,
      missed: status === "future" ? null : base.active - base.opened,
      completed: completed.get(day.n) ?? 0,
      onTimeShare: status === "future" ? null : share(row.onTime, base.active)
    };
  });

  const doorsStats = histogramStats(raw.doorsHistogram.map((row) => ({ value: row.doors, count: row.count })));
  const streakHistogram = bestStreakHistogram(raw.onTimePatterns, today, { endowedDay: advent.streak.endowedDay, freezes: advent.streak.freezes, goals: advent.streak.goals });
  const streakStats = histogramStats(streakHistogram);
  const d1 = retentionRate(raw.cohorts, 1, todayLocal);
  const d7 = retentionRate(raw.cohorts, 7, todayLocal);

  const cohortRows: AnalyticsCohort[] = raw.cohorts.map((cohort) => {
    const hidden = cohort.size < MIN_GROUP;
    return {
      date: cohort.date,
      size: hidden ? null : cohort.size,
      hidden,
      cells: RETENTION_OFFSETS.map((offset) => {
        const matured = retentionRate([cohort], offset, todayLocal).base > 0;
        const count = cohort.returned.find((entry) => entry.offset === offset)?.count ?? 0;
        return { offset, count: hidden || !matured ? null : count, share: hidden || !matured ? null : share(count, cohort.size) };
      })
    };
  });

  const rewardById = new Map(advent.rewards.map((reward) => [reward.id, reward]));
  const grantRows = new Map<string, { expired: number }>();
  for (const row of raw.grants) grantRows.set(row.rewardId, { expired: (grantRows.get(row.rewardId)?.expired ?? 0) + row.expired });
  const rewards: AnalyticsReward[] = overview.map((row) => {
    const reward = rewardById.get(row.rewardId)!;
    const redeemable = reward.redeem !== "none";
    return {
      rewardId: row.rewardId,
      label: row.label,
      kind: reward.kind,
      issued: row.issued,
      redeemed: row.redeemed,
      expired: grantRows.get(row.rewardId)?.expired ?? 0,
      redeemable,
      redeemShare: redeemable ? share(row.redeemed, row.issued) : null,
      stockLeft: row.stockLeft,
      stockTotal: row.stockTotal,
      codesFree: row.codesFree,
      codesTotal: row.codesTotal
    };
  });
  const sources = [...new Set(raw.grants.map((row) => row.source))];
  const rewardsBySource = (Object.keys(GROUP_LABELS) as GrantSource[])
    .filter((source) => sources.includes(source))
    .map((source) =>
      groupRow(source, GROUP_LABELS[source], raw.grants.filter((row) => row.source === source).map((row) => ({ ...row, redeemable: rewardById.get(row.rewardId)?.redeem !== undefined && rewardById.get(row.rewardId)!.redeem !== "none" })))
    );
  const rewardsByKind = (Object.keys(KIND_LABELS) as Array<keyof typeof KIND_LABELS>)
    .map((kind) => groupRow(kind, KIND_LABELS[kind], rewards.filter((reward) => reward.kind === kind)))
    .filter((group) => group.issued > 0);

  const goals = advent.streak.goals.map((goal) => {
    const reached = raw.doorsHistogram.filter((row) => row.doors + (advent.streak.endowedDay ? 1 : 0) >= goal.opened).reduce((sum, row) => sum + row.count, 0);
    return { opened: goal.opened, rewardId: goal.rewardId, label: rewardById.get(goal.rewardId)?.label ?? goal.rewardId, reached, share: share(reached, raw.players) };
  });

  const registration = [
    { key: "participants", label: "Все участники", count: raw.participants },
    { key: "player", label: "Открыли дверь", count: raw.players },
    { key: "email", label: "Подтвердили email", count: raw.withEmail },
    { key: "marketing", label: "Согласились на рассылку", count: raw.withMarketing },
    { key: "reminders", label: "Напоминания включены", count: raw.withReminders }
  ].map((step) => ({ ...step, share: share(step.count, raw.participants) }));

  let teams: AnalyticsTeam[] | null = null;
  if (advent.audience.leaderboard === "teams") {
    const byId = new Map(teamRaw.map((row) => [row.teamId, row]));
    const ranked = rankTeams(
      (advent.audience.teams ?? []).map((team) => ({ id: team.id, title: team.title, members: byId.get(team.id)?.members ?? 0, players: byId.get(team.id)?.players ?? 0, doors: byId.get(team.id)?.doors ?? 0, points: byId.get(team.id)?.points ?? 0 })),
      MIN_GROUP
    );
    teams = ranked.map((team) => ({
      id: team.id,
      title: team.title,
      hidden: team.hidden,
      members: team.hidden ? null : team.members,
      players: team.hidden ? null : team.players,
      avgDoors: team.avgDoors,
      activeShare: team.activeShare,
      points: team.hidden ? null : team.points,
      avgPoints: team.avgPoints,
      rank: team.rank
    }));
  }

  const measured = days.filter((day) => day.status === "closed" && day.onTimeShare !== null && day.active >= MIN_GROUP);
  const byShare = [...measured].sort((a, b) => b.onTimeShare! - a.onTimeShare! || a.day - b.day);
  const bestDays = byShare.slice(0, 3);
  const weakDays = [...byShare].reverse().filter((day) => !bestDays.includes(day)).slice(0, 3);

  const reminderDays = reminderStats?.days ?? [];
  const data: AdventAnalytics = {
    generatedAt: now.toISOString(),
    timezone: schedule.timezone,
    phase: adventPhase(now, schedule),
    today,
    totalDays: schedule.days,
    minGroup: MIN_GROUP,
    kpis: {
      participants: raw.participants,
      players: raw.players,
      activeToday: raw.activeToday,
      d1: { ...d1, share: share(d1.count, d1.base) },
      d7: { ...d7, share: share(d7.count, d7.base) },
      doorsAvg: doorsStats.avg,
      redeemed: overview.reduce((sum, row) => sum + row.redeemed, 0),
      subscribers: reminderStats?.subscribed ?? raw.withReminders
    },
    days,
    doors: { avg: doorsStats.avg, median: doorsStats.median, zero: raw.participants - raw.players, buckets: raw.doorsHistogram.map((row) => ({ value: row.doors, count: row.count })) },
    streaks: { avg: streakStats.avg, median: streakStats.median, buckets: streakHistogram.map((row) => ({ value: row.value, count: row.count })) },
    goals,
    registration,
    rewards,
    rewardsBySource,
    rewardsByKind,
    cohorts: { offsets: [...RETENTION_OFFSETS], rows: cohortRows },
    reminders: reminderStats
      ? {
          channel: advent.reminders.channel,
          subscribed: reminderStats.subscribed,
          unsubscribed: reminderStats.unsubscribed,
          sent: reminderDays.reduce((sum, row) => sum + row.sent, 0),
          failed: reminderDays.reduce((sum, row) => sum + row.failed, 0),
          clicked: reminderDays.reduce((sum, row) => sum + row.clicked, 0),
          openedAfter: reminderDays.reduce((sum, row) => sum + row.openedAfter, 0)
        }
      : null,
    teams,
    bestDays,
    weakDays,
    insights: []
  };
  data.insights = buildInsights(data);
  return data;
}

/** Сколько секунд публичный рейтинг команд живёт в кэше процесса. */
export const LEADERBOARD_TTL_MS = 3 * 60 * 1000;

const leaderboardCache = new Map<string, { at: number; teams: TeamLeaderboard["teams"] }>();

/** Сбросить кэш рейтинга (тесты). */
export function clearLeaderboardCache(): void {
  leaderboardCache.clear();
}

/**
 * Публичный рейтинг команд: среднее число открытых дверей на участника команды и доля участников, открывших хотя бы одну дверь.
 * Имён и идентификаторов людей нет; команда меньше `MIN_PUBLIC_TEAM` участников — без цифр и вне рейтинга.
 * Кэшируется в процессе на `LEADERBOARD_TTL_MS`: тяжёлый запрос не выполняется на каждый открытый лист серии.
 */
export async function loadTeamLeaderboard(
  repository: Pick<AnalyticsRepository, "teamStats">,
  advent: Pick<AdventConfig, "slug" | "audience">,
  now: Date,
  mine: string | null
): Promise<TeamLeaderboard | null> {
  if (advent.audience.leaderboard !== "teams") return null;
  const cached = leaderboardCache.get(advent.slug);
  let teams = cached && now.getTime() - cached.at < LEADERBOARD_TTL_MS && now.getTime() >= cached.at ? cached.teams : null;
  if (!teams) {
    const rows = new Map((await repository.teamStats(advent.slug)).map((row) => [row.teamId, row]));
    teams = rankTeams(
      (advent.audience.teams ?? []).map((team) => ({ id: team.id, title: team.title, members: rows.get(team.id)?.members ?? 0, players: rows.get(team.id)?.players ?? 0, doors: rows.get(team.id)?.doors ?? 0, points: 0 })),
      MIN_PUBLIC_TEAM
    ).map((team) => ({ id: team.id, title: team.title, rank: team.rank, hidden: team.hidden, members: team.hidden ? null : team.members, avgDoors: team.avgDoors, activeShare: team.activeShare }));
    leaderboardCache.set(advent.slug, { at: now.getTime(), teams });
  }
  return { generatedAt: now.toISOString(), teams, mine };
}
