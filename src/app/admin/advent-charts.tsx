import { formatCount, formatDay, formatPercent } from "./format";
import type { AnalyticsBucket, AnalyticsDay } from "@/types/advent-analytics";

/**
 * Графики панели и отчёта: инлайн-SVG без библиотек, рисуются на сервере. Доступность: у каждого графика есть подпись, подписи осей,
 * краткое описание для скринридера (`role="img"`) и таблица с теми же числами; серии различаются не только цветом, но и
 * светлотой (один оттенок в трёх шагах) и штриховкой. Цвета — токены бренда клиента (`--a-*`), без жёстких hex.
 */

const W = 640;
const H = 240;
const PAD = { left: 44, right: 8, top: 10, bottom: 38 };

/** «Красивый» верх оси: 1, 2, 5 × 10ⁿ не меньше значения. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const mantissa = value / exp;
  const step = mantissa <= 1 ? 1 : mantissa <= 2 ? 2 : mantissa <= 5 ? 5 : 10;
  return step * exp;
}

function Axes({ max, ticks = 4, yLabel, xLabel }: { max: number; ticks?: number; yLabel: string; xLabel: string }) {
  const plotH = H - PAD.top - PAD.bottom;
  return (
    <g className="ac-axes">
      {Array.from({ length: ticks + 1 }, (_, index) => {
        const value = (max / ticks) * index;
        const y = PAD.top + plotH - (value / max) * plotH;
        return (
          <g key={index}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} className={index === 0 ? "ac-base" : "ac-grid"} />
            <text x={PAD.left - 6} y={y + 4} textAnchor="end" className="ac-tick">{formatCount(Math.round(value))}</text>
          </g>
        );
      })}
      <text x={PAD.left + (W - PAD.left - PAD.right) / 2} y={H - 4} textAnchor="middle" className="ac-title">{xLabel}</text>
      <text transform={`translate(11 ${PAD.top + plotH / 2}) rotate(-90)`} textAnchor="middle" className="ac-title">{yLabel}</text>
    </g>
  );
}

const Defs = ({ id }: { id: string }) => (
  <defs>
    <pattern id={`${id}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="6" height="6" className="ac-hatch-bg" />
      <line x1="0" y1="0" x2="0" y2="6" className="ac-hatch-line" />
    </pattern>
  </defs>
);

/** Столбик с закруглением сверху (4 px) от базовой линии. */
function Column({ x, y, w, h, className, fill }: { x: number; y: number; w: number; h: number; className?: string; fill?: string }) {
  if (h <= 0) return null;
  const r = Math.min(4, w / 2, h);
  return <path className={className} fill={fill} d={`M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`} />;
}

function Legend({ items }: { items: Array<{ label: string; className: string; hatch?: string }> }) {
  return (
    <ul className="ac-legend">
      {items.map((item) => (
        <li key={item.label}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect width="14" height="14" rx="3" className={item.className} fill={item.hatch} />
          </svg>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Кривая по дням: столбец дня = открыли в свой день + догнали + пропустили из активных. */
export function DaysChart({ days, id = "days", open = false }: { days: AnalyticsDay[]; id?: string; open?: boolean }) {
  const rows = days.map((day) => ({ ...day, missedN: day.missed ?? 0 }));
  const max = niceMax(Math.max(1, ...rows.map((day) => day.onTime + day.caughtUp + day.missedN)));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, rows.length);
  const barW = Math.min(28, slot - 4);
  const yOf = (value: number) => (value / max) * plotH;
  const summary = rows
    .filter((day) => day.status !== "future")
    .map((day) => `день ${day.day}: в свой день ${day.onTime}, догнали ${day.caughtUp}, пропустили ${day.missed ?? 0}`)
    .join("; ");
  return (
    <figure className="ac-figure">
      <figcaption>Двери по дням: открыли в свой день, догнали, пропустили</figcaption>
      <Legend
        items={[
          { label: "Открыли в свой день", className: "ac-s1" },
          { label: "Догнали позже", className: "ac-s2" },
          { label: "Пропустили (из активных)", className: "ac-s3", hatch: `url(#${id}-hatch)` }
        ]}
      />
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Столбчатая диаграмма по дням кампании. ${summary || "Данных пока нет."}`} className="ac-svg">
        <Defs id={id} />
        <Axes max={max} yLabel="Участников" xLabel="День кампании" />
        {rows.map((day, index) => {
          const x = PAD.left + slot * index + (slot - barW) / 2;
          const base = PAD.top + plotH;
          const hOn = yOf(day.onTime);
          const hCatch = yOf(day.caughtUp);
          const hMiss = yOf(day.missedN);
          const gap = 2;
          return (
            <g key={day.day} className="ac-bar">
              <title>{`День ${day.day} «${day.title}», ${formatDay(day.date)}: в свой день ${day.onTime}, догнали ${day.caughtUp}${day.missed === null ? "" : `, пропустили ${day.missed}`}`}</title>
              <Column x={x} y={base - hOn} w={barW} h={hOn} className="ac-s1" />
              <Column x={x} y={base - hOn - hCatch - (hCatch ? gap : 0)} w={barW} h={hCatch} className="ac-s2" />
              <Column x={x} y={base - hOn - hCatch - hMiss - (hCatch ? gap : 0) - (hMiss ? gap : 0)} w={barW} h={hMiss} className="ac-s3" fill={`url(#${id}-hatch)`} />
              <text x={x + barW / 2} y={base + 14} textAnchor="middle" className="ac-tick">{day.day}</text>
            </g>
          );
        })}
      </svg>
      <details className="ac-table" open={open}>
        <summary>Таблица к графику</summary>
        <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">День</th><th scope="col">Дата</th><th scope="col">В свой день</th><th scope="col">Догнали</th><th scope="col">Пропустили</th><th scope="col">Активных</th><th scope="col">Закрыли день целиком</th></tr></thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.day}>
                  <th scope="row">{day.day}. {day.title}</th>
                  <td>{formatDay(day.date)}</td>
                  <td>{formatCount(day.onTime)}</td>
                  <td>{formatCount(day.caughtUp)}</td>
                  <td>{day.missed === null ? "—" : formatCount(day.missed)}</td>
                  <td>{day.status === "future" ? "—" : formatCount(day.active)}</td>
                  <td>{formatCount(day.completed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** Столбчатая гистограмма «значение → участников» (двери на участника, лучшая серия). */
export function ColumnChart({
  buckets,
  caption,
  xLabel,
  yLabel = "Участников",
  valueHeader,
  id,
  open = false
}: {
  buckets: AnalyticsBucket[];
  caption: string;
  xLabel: string;
  yLabel?: string;
  valueHeader: string;
  id: string;
  open?: boolean;
}) {
  const max = niceMax(Math.max(1, ...buckets.map((bucket) => bucket.count)));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, buckets.length);
  const barW = Math.min(36, slot - 4);
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const summary = buckets.map((bucket) => `${bucket.value}: ${bucket.count}`).join("; ");
  return (
    <figure className="ac-figure">
      <figcaption>{caption}</figcaption>
      {buckets.length === 0 ? (
        <p className="admin-empty">Пока нет данных.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${caption}. ${xLabel} — число участников. ${summary}`} className="ac-svg" id={id}>
            <Axes max={max} yLabel={yLabel} xLabel={xLabel} />
            {buckets.map((bucket, index) => {
              const x = PAD.left + slot * index + (slot - barW) / 2;
              const h = (bucket.count / max) * plotH;
              return (
                <g key={bucket.value}>
                  <title>{`${bucket.value}: ${bucket.count} (${formatPercent(total ? bucket.count / total : null)})`}</title>
                  <Column x={x} y={PAD.top + plotH - h} w={barW} h={h} className="ac-s1" />
                  <text x={x + barW / 2} y={PAD.top + plotH + 14} textAnchor="middle" className="ac-tick">{bucket.value}</text>
                </g>
              );
            })}
          </svg>
          <details className="ac-table" open={open}>
            <summary>Таблица к графику</summary>
            <div className="table-scroll">
              <table>
                <thead><tr><th scope="col">{valueHeader}</th><th scope="col">Участников</th><th scope="col">Доля</th></tr></thead>
                <tbody>
                  {buckets.map((bucket) => (
                    <tr key={bucket.value}><th scope="row">{bucket.value}</th><td>{formatCount(bucket.count)}</td><td>{formatPercent(total ? bucket.count / total : null)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </figure>
  );
}
