import type { CampaignConfig } from "@/config/schema";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { maskEmail } from "@/server/mask";

/** Часовой пояс отчётов: кампания идёт по Москве, дни считаем по ней. */
export const REPORT_TIME_ZONE = "Europe/Moscow";

export type FunnelStep = { key: string; label: string; count: number };

export type DailyRow = {
  /** YYYY-MM-DD по московскому времени. */
  date: string;
  started: number;
  roomsEntered: number;
  roomsCompleted: number;
  rushStarted: number;
  rushFinished: number;
  completed: number;
  claimsCreated: number;
  verified: number;
  exported: number;
};

export type TaskStat = {
  taskId: string;
  roomTitle: string;
  type: string;
  answers: number;
  /** Ответы на 100 / 50 / 0 по базе задания (комбо и бонусы не учитываются). */
  full: number;
  partial: number;
  wrong: number;
  /** Доля ответов на 100; null, пока нет ответов. */
  fullShare: number | null;
};

export type LevelStat = { title: string; count: number; share: number | null };

export type TimingStat = { completedCount: number; avgSeconds: number | null; medianSeconds: number | null };

export type DashboardMetrics = {
  generatedAt: string;
  funnel: FunnelStep[];
  daily: DailyRow[];
  tasks: TaskStat[];
  levels: LevelStat[];
  timing: TimingStat;
};

type StageRow = { stage: string; room_id: string | null; day: string; n: number };
type TaskRow = { task_id: string; answers: number; full: number; partial: number; wrong: number };
type LevelRow = { title: string | null; n: number };
type TimingRow = { n: number; avg_seconds: number | null; median_seconds: number | null };

const DAILY_FIELD: Record<string, keyof Omit<DailyRow, "date">> = {
  started: "started",
  room_entered: "roomsEntered",
  room_completed: "roomsCompleted",
  rush_started: "rushStarted",
  rush_finished: "rushFinished",
  completed: "completed",
  claim_created: "claimsCreated",
  verified: "verified",
  exported: "exported"
};

/** День события по московскому времени: колонки Prisma — это UTC без пояса. */
const localDay = (column: Prisma.Sql) =>
  Prisma.sql`to_char(((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${REPORT_TIME_ZONE})::date, 'YYYY-MM-DD')`;

/**
 * Агрегаты для дашборда оператора. Только счётчики и распределения из SQL: ни email, ни имён,
 * ни идентификаторов сессий в результат не попадает.
 */
export async function loadDashboardMetrics(
  prisma: PrismaClient,
  campaign: CampaignConfig,
  now: Date = new Date()
): Promise<DashboardMetrics> {
  const slug = campaign.slug;
  const taskRooms = campaign.rooms.flatMap((room) =>
    room.tasks.map((task) => ({ taskId: task.id, roomId: room.id, roomSize: room.tasks.length }))
  );
  const taskIds = taskRooms.map((item) => item.taskId);
  const roomIds = taskRooms.map((item) => item.roomId);
  const roomSizes = taskRooms.map((item) => item.roomSize);

  const stagesQuery = prisma.$queryRaw<StageRow[]>`
    SELECT 'started' AS stage, NULL::text AS room_id, ${localDay(Prisma.sql`s."startedAt"`)} AS day, count(*)::int AS n
      FROM "GameSession" s WHERE s."campaignSlug" = ${slug} GROUP BY 3
    UNION ALL
    SELECT 'room_entered', e."roomId", ${localDay(Prisma.sql`e."enteredAt"`)}, count(*)::int
      FROM "RoomEntry" e JOIN "GameSession" s ON s."id" = e."sessionId"
      WHERE s."campaignSlug" = ${slug} GROUP BY 2, 3
    UNION ALL
    SELECT 'room_completed', t.room_id, ${localDay(Prisma.sql`t.finished_at`)}, count(*)::int
      FROM (
        SELECT m.room_id, max(a."answeredAt") AS finished_at
          FROM "TaskAnswer" a
          JOIN "GameSession" s ON s."id" = a."sessionId"
          JOIN unnest(${taskIds}::text[], ${roomIds}::text[], ${roomSizes}::int[]) AS m(task_id, room_id, room_size)
            ON m.task_id = a."taskId"
          WHERE s."campaignSlug" = ${slug}
          GROUP BY a."sessionId", m.room_id, m.room_size
          HAVING count(*) = m.room_size
      ) t GROUP BY 2, 3
    UNION ALL
    SELECT 'rush_started', NULL, ${localDay(Prisma.sql`r."startedAt"`)}, count(*)::int
      FROM "RushRun" r JOIN "GameSession" s ON s."id" = r."sessionId"
      WHERE s."campaignSlug" = ${slug} GROUP BY 3
    UNION ALL
    SELECT 'rush_finished', NULL, ${localDay(Prisma.sql`r."finishedAt"`)}, count(*)::int
      FROM "RushRun" r JOIN "GameSession" s ON s."id" = r."sessionId"
      WHERE s."campaignSlug" = ${slug} AND r."finishedAt" IS NOT NULL GROUP BY 3
    UNION ALL
    SELECT 'completed', NULL, ${localDay(Prisma.sql`s."completedAt"`)}, count(*)::int
      FROM "GameSession" s
      WHERE s."campaignSlug" = ${slug} AND s."status" = 'completed' AND s."completedAt" IS NOT NULL GROUP BY 3
    UNION ALL
    SELECT 'claim_created', NULL, ${localDay(Prisma.sql`c."createdAt"`)}, count(*)::int
      FROM "PrizeClaim" c WHERE c."campaignSlug" = ${slug} GROUP BY 3
    UNION ALL
    SELECT 'verified', NULL, ${localDay(Prisma.sql`c."verifiedAt"`)}, count(*)::int
      FROM "PrizeClaim" c WHERE c."campaignSlug" = ${slug} AND c."verifiedAt" IS NOT NULL GROUP BY 3
    UNION ALL
    SELECT 'exported', NULL, ${localDay(Prisma.sql`c."exportedAt"`)}, count(*)::int
      FROM "PrizeClaim" c WHERE c."campaignSlug" = ${slug} AND c."exportedAt" IS NOT NULL GROUP BY 3`;

  // Выгруженных без даты (экспорт до появления exportedAt) в «по дням» нет, но в итог воронки они входят.
  const exportedTotalQuery = prisma.prizeClaim.count({
    where: { campaignSlug: slug, status: { in: ["exported", "fulfilled"] } }
  });

  const tasksQuery = prisma.$queryRaw<TaskRow[]>`
    SELECT a."taskId" AS task_id,
           count(*)::int AS answers,
           (count(*) FILTER (WHERE a."basePoints" = 100))::int AS "full",
           (count(*) FILTER (WHERE a."basePoints" = 50))::int AS partial,
           (count(*) FILTER (WHERE a."basePoints" = 0))::int AS wrong
      FROM "TaskAnswer" a JOIN "GameSession" s ON s."id" = a."sessionId"
      WHERE s."campaignSlug" = ${slug}
      GROUP BY a."taskId"`;

  const levelsQuery = prisma.$queryRaw<LevelRow[]>`
    SELECT s."rewardTierTitle" AS title, count(*)::int AS n
      FROM "GameSession" s WHERE s."campaignSlug" = ${slug} AND s."status" = 'completed'
      GROUP BY 1`;

  const timingQuery = prisma.$queryRaw<TimingRow[]>`
    SELECT count(*)::int AS n,
           (avg(extract(epoch FROM (s."completedAt" - s."startedAt"))))::float8 AS avg_seconds,
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (s."completedAt" - s."startedAt"))))::float8 AS median_seconds
      FROM "GameSession" s
      WHERE s."campaignSlug" = ${slug} AND s."status" = 'completed' AND s."completedAt" IS NOT NULL`;

  const [stageRows, exportedTotal, taskRows, levelRows, [timingRow]] = await Promise.all([
    stagesQuery,
    exportedTotalQuery,
    tasksQuery,
    levelsQuery,
    timingQuery
  ]);

  return {
    generatedAt: now.toISOString(),
    funnel: buildFunnel(campaign, stageRows, exportedTotal),
    daily: buildDaily(stageRows),
    tasks: buildTaskStats(campaign, taskRows),
    levels: buildLevels(campaign, levelRows),
    timing: {
      completedCount: timingRow?.n ?? 0,
      avgSeconds: timingRow?.avg_seconds ?? null,
      medianSeconds: timingRow?.median_seconds ?? null
    }
  };
}

function totalOf(rows: StageRow[], stage: string, roomId?: string): number {
  return rows
    .filter((row) => row.stage === stage && (roomId === undefined || row.room_id === roomId))
    .reduce((sum, row) => sum + row.n, 0);
}

function buildFunnel(campaign: CampaignConfig, rows: StageRow[], exportedTotal: number): FunnelStep[] {
  const steps: FunnelStep[] = [{ key: "started", label: "Сессии начаты", count: totalOf(rows, "started") }];
  for (const room of campaign.rooms) {
    steps.push({ key: `room_entered:${room.id}`, label: `Вход в комнату «${room.title}»`, count: totalOf(rows, "room_entered", room.id) });
    steps.push({ key: `room_completed:${room.id}`, label: `Комната «${room.title}» завершена`, count: totalOf(rows, "room_completed", room.id) });
  }
  steps.push(
    { key: "rush_started", label: "Рывок начат", count: totalOf(rows, "rush_started") },
    { key: "rush_finished", label: "Рывок завершён", count: totalOf(rows, "rush_finished") },
    { key: "completed", label: "Игра завершена", count: totalOf(rows, "completed") },
    { key: "claim_created", label: "Заявка создана", count: totalOf(rows, "claim_created") },
    { key: "verified", label: "Email подтверждён", count: totalOf(rows, "verified") },
    { key: "exported", label: "Выгружено", count: exportedTotal }
  );
  return steps;
}

function buildDaily(rows: StageRow[]): DailyRow[] {
  const byDate = new Map<string, DailyRow>();
  for (const row of rows) {
    const field = DAILY_FIELD[row.stage];
    if (!field) continue;
    let entry = byDate.get(row.day);
    if (!entry) {
      entry = {
        date: row.day, started: 0, roomsEntered: 0, roomsCompleted: 0, rushStarted: 0, rushFinished: 0,
        completed: 0, claimsCreated: 0, verified: 0, exported: 0
      };
      byDate.set(row.day, entry);
    }
    entry[field] += row.n;
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function buildTaskStats(campaign: CampaignConfig, rows: TaskRow[]): TaskStat[] {
  const byTask = new Map(rows.map((row) => [row.task_id, row]));
  return campaign.rooms.flatMap((room) =>
    room.tasks.map((task) => {
      const row = byTask.get(task.id);
      const answers = row?.answers ?? 0;
      const full = row?.full ?? 0;
      return {
        taskId: task.id,
        roomTitle: room.title,
        type: task.type,
        answers,
        full,
        partial: row?.partial ?? 0,
        wrong: row?.wrong ?? 0,
        fullShare: answers ? full / answers : null
      };
    })
  );
}

function buildLevels(campaign: CampaignConfig, rows: LevelRow[]): LevelStat[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.title ?? "Без уровня", (counts.get(row.title ?? "Без уровня") ?? 0) + row.n);
  const known = campaign.rewardTiers.map((tier) => tier.title);
  const titles = [...known, ...[...counts.keys()].filter((title) => !known.includes(title))];
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  return titles.map((title) => {
    const count = counts.get(title) ?? 0;
    return { title, count, share: total ? count / total : null };
  });
}

export type ClaimStatusKey = "claim_pending" | "email_verified" | "exported" | "fulfilled";

export type AdminClaimRow = {
  maskedEmail: string;
  status: ClaimStatusKey;
  level: string | null;
  createdAt: string;
};

export type AdminClaims = {
  total: number;
  byStatus: Record<ClaimStatusKey, number>;
  rows: AdminClaimRow[];
  /** Сколько строк показано из всех (таблица ограничена). */
  limit: number;
};

export const ADMIN_CLAIMS_LIMIT = 200;

/**
 * Заявки для таблицы оператора: email сразу маскируется на сервере, полного адреса, имени и компании
 * в результате нет. Полные данные — только в CSV (`/api/admin/claims.csv`).
 */
export async function loadAdminClaims(
  prisma: PrismaClient,
  campaign: CampaignConfig,
  limit: number = ADMIN_CLAIMS_LIMIT
): Promise<AdminClaims> {
  const [grouped, claims] = await Promise.all([
    prisma.prizeClaim.groupBy({ by: ["status"], where: { campaignSlug: campaign.slug }, _count: { _all: true } }),
    prisma.prizeClaim.findMany({
      where: { campaignSlug: campaign.slug },
      select: { normalizedEmail: true, status: true, createdAt: true, session: { select: { rewardTierTitle: true } } },
      orderBy: { createdAt: "desc" },
      take: limit
    })
  ]);
  const byStatus: Record<ClaimStatusKey, number> = { claim_pending: 0, email_verified: 0, exported: 0, fulfilled: 0 };
  for (const group of grouped) byStatus[group.status] = group._count._all;
  return {
    total: Object.values(byStatus).reduce((sum, value) => sum + value, 0),
    byStatus,
    limit,
    rows: claims.map((claim) => ({
      maskedEmail: maskEmail(claim.normalizedEmail),
      status: claim.status,
      level: claim.session.rewardTierTitle,
      createdAt: claim.createdAt.toISOString()
    }))
  };
}
