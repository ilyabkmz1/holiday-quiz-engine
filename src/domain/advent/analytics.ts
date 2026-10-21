import { streakState, type StreakPolicy } from "./streak";

/** Группы меньше этого числа участников в клиентских срезах (панель, отчёт, CSV) не детализируются: по ним можно узнать человека. */
export const MIN_GROUP = 5;
/** Команда меньше этого размера в публичном рейтинге показывается без цифр. */
export const MIN_PUBLIC_TEAM = 3;

/** Доля `count / base`; `null`, пока основание нулевое. */
export function share(count: number, base: number): number | null {
  return base > 0 ? count / base : null;
}

/** Дата `YYYY-MM-DD` плюс `days` суток (без часовых поясов). */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

type Histogram = ReadonlyArray<{ value: number; count: number }>;

/** Среднее и медиана по гистограмме «значение → сколько участников». Пустая гистограмма — `null`. */
export function histogramStats(histogram: Histogram): { total: number; avg: number | null; median: number | null } {
  const rows = histogram.filter((row) => row.count > 0).sort((a, b) => a.value - b.value);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (total === 0) return { total: 0, avg: null, median: null };
  const avg = rows.reduce((sum, row) => sum + row.value * row.count, 0) / total;
  // Медиана: среднее двух центральных значений при чётном числе.
  const at = (position: number): number => {
    let seen = 0;
    for (const row of rows) {
      seen += row.count;
      if (position < seen) return row.value;
    }
    return rows[rows.length - 1].value;
  };
  const median = total % 2 === 1 ? at((total - 1) / 2) : (at(total / 2 - 1) + at(total / 2)) / 2;
  return { total, avg, median };
}

/**
 * Распределение лучшей серии: рисунок открытых вовремя дней → `best` по тем же правилам, что у участника (`streakState`:
 * заморозки, пропуски). `today` — номер текущего дня (`dayIndexAt`).
 */
export function bestStreakHistogram(
  patterns: ReadonlyArray<{ days: readonly number[]; count: number }>,
  today: number | null,
  policy: StreakPolicy
): Array<{ value: number; count: number }> {
  const counts = new Map<number, number>();
  for (const pattern of patterns) {
    const best = streakState(pattern.days.map((day) => ({ day, onTime: true })), today, policy).best;
    counts.set(best, (counts.get(best) ?? 0) + pattern.count);
  }
  return [...counts].sort((a, b) => a[0] - b[0]).map(([value, count]) => ({ value, count }));
}

export type CohortRaw = { date: string; size: number; returned: ReadonlyArray<{ offset: number; count: number }> };

/** Локальные даты, в которые дверь вообще можно открыть: от даты первого дня до последней даты перед финалом. */
export type OpenableDates = { first: string; last: string };

/**
 * Возврат на день `offset`: доля участников, вернувшихся (открывших дверь) через `offset` суток после первого визита.
 * В основание входят только созревшие когорты, у которых этот день уже наступил (`дата + offset ≤ today`): недождавшиеся
 * не считаются «не вернувшимися». Если день возврата выпадает на дату, когда двери не открываются (до первого дня или после
 * финала), когорта тоже не входит в основание: вернуться ей было некуда.
 */
export function retentionRate(cohorts: readonly CohortRaw[], offset: number, today: string, openable?: OpenableDates): { count: number; base: number } {
  let count = 0;
  let base = 0;
  for (const cohort of cohorts) {
    const target = addDays(cohort.date, offset);
    if (target > today) continue;
    if (openable && (target < openable.first || target > openable.last)) continue;
    base += cohort.size;
    count += cohort.returned.find((row) => row.offset === offset)?.count ?? 0;
  }
  return { count, base };
}

export type TeamInput = { id: string; title: string; members: number; players: number; doors: number; points: number };
export type RankedTeam = TeamInput & { hidden: boolean; rank: number | null; avgDoors: number | null; activeShare: number | null; avgPoints: number | null };

/**
 * Рейтинг команд: среднее число открытых дверей на участника (не сумма, чтобы большая команда не выигрывала числом), при равенстве —
 * доля активных, затем название. Команда меньше `minMembers` без цифр и вне рейтинга (в конце списка).
 */
export function rankTeams(teams: readonly TeamInput[], minMembers: number): RankedTeam[] {
  const rows: RankedTeam[] = teams.map((team) => {
    const hidden = team.members < minMembers;
    return {
      ...team,
      hidden,
      rank: null,
      avgDoors: hidden ? null : team.doors / team.members,
      activeShare: hidden ? null : team.players / team.members,
      avgPoints: hidden ? null : team.points / team.members
    };
  });
  const visible = rows
    .filter((row) => !row.hidden)
    .sort((a, b) => b.avgDoors! - a.avgDoors! || b.activeShare! - a.activeShare! || a.title.localeCompare(b.title, "ru"));
  // Равные по среднему и доле делят место (1, 1, 3), чтобы порядок названий не выглядел преимуществом.
  visible.forEach((row, index) => {
    const prev = visible[index - 1];
    row.rank = prev && prev.avgDoors === row.avgDoors && prev.activeShare === row.activeShare ? prev.rank : index + 1;
  });
  const hidden = rows.filter((row) => row.hidden).sort((a, b) => a.title.localeCompare(b.title, "ru"));
  return [...visible, ...hidden];
}
