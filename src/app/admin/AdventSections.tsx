import type { AdventAnalytics, AnalyticsFunnelStep, AnalyticsRewardGroup } from "@/types/advent-analytics";

import { formatCount, formatDay, formatPercent } from "./format";

/** Блоки метрик адвента, общие для панели `/admin` и отчёта `/admin/report`. Только числа и агрегаты. */

const decimal = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const formatDecimal = (value: number | null): string => (value === null ? "—" : decimal.format(value));

export function KpiTiles({ data }: { data: AdventAnalytics }) {
  const { kpis } = data;
  const tiles: Array<{ label: string; value: string; note?: string }> = [
    { label: "Участники", value: formatCount(kpis.participants), note: `открыли дверь: ${formatCount(kpis.players)}` },
    { label: "Активные сегодня", value: formatCount(kpis.activeToday), note: "открыли дверь за сегодня" },
    { label: "Возврат D1", value: formatPercent(kpis.d1.share), note: kpis.d1.base ? `${formatCount(kpis.d1.count)} из ${formatCount(kpis.d1.base)}` : "ещё нет данных" },
    { label: "Возврат D7", value: formatPercent(kpis.d7.share), note: kpis.d7.base ? `${formatCount(kpis.d7.count)} из ${formatCount(kpis.d7.base)}` : "ещё нет данных" },
    { label: "Дверей на игрока", value: formatDecimal(kpis.doorsAvg), note: `из ${data.totalDays}` },
    { label: "Погашения", value: formatCount(kpis.redeemed), note: "наград на кассе и онлайн" },
    { label: "Подписчики", value: formatCount(kpis.subscribers), note: "напоминания с согласием" }
  ];
  return (
    <dl className="kpis">
      {tiles.map((tile) => (
        <div key={tile.label} className="kpi">
          <dt>{tile.label}</dt>
          <dd>{tile.value}<small>{tile.note}</small></dd>
        </div>
      ))}
    </dl>
  );
}

export function FunnelList({ steps, base, caption }: { steps: AnalyticsFunnelStep[]; base: number; caption: string }) {
  return (
    <ol className="funnel" aria-label={caption}>
      {steps.map((step) => (
        <li key={step.key}>
          <span className="funnel-label">{step.label}</span>
          <span className="a-bar" aria-hidden="true"><span className="a-fill" style={{ width: `${base ? Math.max(step.count ? 2 : 0, (step.count / base) * 100) : 0}%` }} /></span>
          <span className="funnel-count">{formatCount(step.count)}<small>{step.share !== null ? ` · ${formatPercent(step.share)}` : ""}</small></span>
        </li>
      ))}
    </ol>
  );
}

export function CohortTable({ data }: { data: AdventAnalytics }) {
  const { rows, offsets } = data.cohorts;
  if (rows.length === 0) return <p className="admin-empty">Пока нет данных.</p>;
  return (
    <div className="table-scroll">
      <table className="cohort">
        <caption className="sr-only">Возврат участников по дню первого визита</caption>
        <thead>
          <tr>
            <th scope="col">Первый визит</th>
            <th scope="col">Участников</th>
            {offsets.map((offset) => <th key={offset} scope="col">D{offset}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.date}>
              <th scope="row">{formatDay(row.date)}</th>
              <td>{row.hidden ? <span className="cohort-mute">меньше {data.minGroup}</span> : formatCount(row.size ?? 0)}</td>
              {row.cells.map((cell) => (
                <td key={cell.offset} {...(cell.share !== null ? { "data-share": "", style: { "--share": cell.share } as React.CSSProperties } : {})}>
                  {cell.share === null ? <span className="cohort-mute">—</span> : <>{formatPercent(cell.share)}<small className="cohort-mute"> {formatCount(cell.count ?? 0)}</small></>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RewardGroups({ groups, caption }: { groups: AnalyticsRewardGroup[]; caption: string }) {
  if (groups.length === 0) return <p className="admin-empty">Наград пока не выдавали.</p>;
  return (
    <div className="table-scroll">
      <table className="left">
        <caption className="sr-only">{caption}</caption>
        <thead><tr><th scope="col">{caption}</th><th scope="col">Выдано</th><th scope="col">Погашено</th><th scope="col">Доля</th><th scope="col">Истекли</th></tr></thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.key}>
              <th scope="row">{group.label}</th>
              <td>{formatCount(group.issued)}</td>
              <td>{formatCount(group.redeemed)}</td>
              <td>{formatPercent(group.redeemShare)}</td>
              <td>{formatCount(group.expired)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TeamsTable({ data }: { data: AdventAnalytics }) {
  if (!data.teams) return null;
  return (
    <div className="table-scroll">
      <table className="left">
        <caption className="sr-only">Участие и очки по командам</caption>
        <thead>
          <tr><th scope="col">Место</th><th scope="col">Команда</th><th scope="col">Участников</th><th scope="col">Играют</th><th scope="col">Дверей на участника</th><th scope="col">Очки, всего</th><th scope="col">Очки на участника</th></tr>
        </thead>
        <tbody>
          {data.teams.map((team) => (
            <tr key={team.id}>
              <td>{team.rank ?? "—"}</td>
              <th scope="row">{team.title}</th>
              {team.hidden ? (
                <td colSpan={5} className="cohort-mute">меньше {data.minGroup} участников — цифры скрыты</td>
              ) : (
                <>
                  <td>{formatCount(team.members ?? 0)}</td>
                  <td>{formatPercent(team.activeShare)}</td>
                  <td>{formatDecimal(team.avgDoors)}</td>
                  <td>{formatCount(team.points ?? 0)}</td>
                  <td>{formatDecimal(team.avgPoints)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
