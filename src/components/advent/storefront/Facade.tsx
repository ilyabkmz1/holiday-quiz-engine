"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

import { AdventIcon } from "@/components/advent/icons";
import { dayLabel, fill } from "@/components/advent/format";
import { WINDOW_ICON, WINDOW_SHAPE, openedWindowIcon, windowStatusLabel } from "@/components/advent/storefront/windows";
import { HeroSprite } from "@/components/quest/sprites";
import type { AdventCopy } from "@/config/advent-schema";
import type { Facade as FacadeTemplate, FacadeColors } from "@/config/facade";
import { facadeLayout, type FacadeCell } from "@/domain/advent";
import type { AdventDoor, AdventGrantView, AdventPhase } from "@/types/advent";
import type { PublicHero } from "@/types/api";

type Props = {
  template: FacadeTemplate;
  signText: string;
  host: PublicHero;
  doors: AdventDoor[];
  grants: AdventGrantView[];
  /** Номер сегодняшнего дня; окно занимает 2×2 ячейки. `null` до старта и после финала. */
  today: number | null;
  copy: AdventCopy;
  timezone: string;
  phase: AdventPhase;
  busy: number | null;
  /** Окно, которое только что загорелось (возврат с экрана дня). */
  lit: number | null;
  reduced: boolean;
  onOpen: (n: number) => void;
  /** Подсказка для окна, которое нельзя открыть. */
  onHint: (text: string) => void;
  /** Хозяин на улице (`StreetHost`): рисуется поверх стены, а в двери его уже нет. Без него хозяин стоит в двери. */
  street?: ReactNode;
  /** Действие окна идёт через ходьбу хозяина: `immediate` — с клавиатуры, без ожидания. Без него действие выполняется сразу. */
  walk?: (n: number, act: () => void, immediate: boolean) => void;
};

/** Цвета фасада: роли шаблона превращаются в CSS-переменные со ссылками на токены бренда (в компонентах нет ни одного hex). */
export function facadeVars(colors: FacadeColors): CSSProperties {
  const vars: Record<string, string> = {};
  for (const [role, token] of Object.entries(colors)) vars[`--fc-${role}`] = `var(--${token})`;
  return vars as CSSProperties;
}

const EAVE_LIGHTS = 13;
const EAVE_COLORS = ["var(--gold)", "var(--cyan)", "var(--coral)", "var(--green)"] as const;

function Roof({ template, signText }: { template: FacadeTemplate; signText: string }) {
  const clip = `awn-${useId().replace(/:/g, "")}`;
  return (
    <div className="adv-roof" data-roof={template.roof.shape} data-awning={template.roof.awning || undefined}>
      <svg className="adv-roof-svg" viewBox="0 0 400 96" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {template.roof.shape === "gable" && <path className="adv-roof-fill" d="M-6 96L200 6 406 96z" />}
        {template.roof.shape === "flat" && (
          <>
            <rect className="adv-roof-fill" x="-6" y="58" width="412" height="38" rx="4" />
            <rect className="adv-roof-trim" x="-6" y="52" width="412" height="9" rx="3" />
          </>
        )}
        {template.roof.shape === "dome" && <path className="adv-roof-fill" d="M-6 96C-6 36 96 4 200 4S406 36 406 96z" />}
        {template.decor.snow && template.roof.shape === "gable" && <path className="adv-roof-snow" d="M52 70.6L200 6 348 70.6 338 82 318 72 298 84 276 70 250 82 226 68 200 78 174 68 150 82 124 70 102 84 82 72 62 82z" />}
        {template.decor.snow && template.roof.shape !== "gable" && <path className="adv-roof-snow" d={template.roof.shape === "dome" ? "M86 28C120 10 160 4 200 4s80 6 114 24c-16 6-26-2-42 4-16-6-26 2-42-4-16 6-26-2-44 4-16-6-26 2-42-4-14 6-26-2-38 4z" : "M-6 52h412v8c-16 6-26-2-42 4-16-6-26 2-42-4-16 6-26-2-44 4-16-6-26 2-42-4-16 6-26-2-44 4-16-6-26 2-42-4-16 6-26-2-44 4-16-6-26 2-42-4z"} />}
      </svg>
      {template.decor.sign && (
        <div className="adv-sign" aria-hidden="true">
          <span className="adv-sign-text">{signText}</span>
        </div>
      )}
      {template.decor.garland && (
        <span className="adv-eave" aria-hidden="true">
          {Array.from({ length: EAVE_LIGHTS }, (_, index) => (
            <i key={index} style={{ background: EAVE_COLORS[index % EAVE_COLORS.length], animationDelay: `${(index % 5) * -0.55}s` }} />
          ))}
        </span>
      )}
      {template.roof.awning && (
        <svg className="adv-awning" viewBox="0 0 400 30" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <defs>
            <clipPath id={clip}>
              <path d="M0 0h400v14c0 14-25 16-25 16s-25-2-25-16c0 14-25 16-25 16s-25-2-25-16c0 14-25 16-25 16s-25-2-25-16c0 14-25 16-25 16s-25-2-25-16c0 14-25 16-25 16s-25-2-25-16c0 14-25 16-25 16s-25-2-25-16c0 14-25 16-25 16s-25-2-25-16z" />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clip})`}>
            {Array.from({ length: 8 }, (_, index) => (
              <rect key={index} className={index % 2 === 0 ? "adv-awning-a" : "adv-awning-b"} x={index * 50} y="0" width="50" height="30" />
            ))}
          </g>
        </svg>
      )}
    </div>
  );
}

/**
 * Фасад здания: крыша, стена с окнами по раскладке `facadeLayout`, дверь с героем-хозяином и снежная земля.
 * Каждое окно — кнопка со статусом, который читается формой и значком, а не только цветом.
 * Клавиатура: Tab заходит одной остановкой, стрелки двигают фокус по окнам в порядке дней, Home и End — к краям.
 */
export function Facade({ template, signText, host, doors, grants, today, copy, timezone, phase, busy, lit, reduced, onOpen, onHint, street, walk }: Props) {
  const layout = useMemo(() => facadeLayout(doors.length, today, template), [doors.length, today, template]);
  const wallRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayDoor = doors.find((door) => door.n === today) ?? doors.find((door) => door.status === "today") ?? doors.find((door) => door.status === "catchup") ?? doors[0];
  const [active, setActive] = useState<number | null>(null);
  // Enter и пробел на окне: действие выполняется сразу, а не после ходьбы хозяина (флаг снимает указатель или сам клик).
  const viaKeyRef = useRef(false);
  const tabStop = active ?? todayDoor?.n ?? 1;
  const doorByN = useMemo(() => new Map(doors.map((door) => [door.n, door])), [doors]);

  // Длинный фасад (много дней) прокручивается внутри своей области: к сегодняшнему окну прокручиваем сами.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 4 || today === null) return;
    const target = wallRef.current?.querySelector<HTMLElement>(`[data-door="${today}"]`);
    target?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  }, [today, reduced, layout.rows]);

  function focusDoor(n: number) {
    setActive(n);
    wallRef.current?.querySelector<HTMLElement>(`[data-door="${n}"]`)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") viaKeyRef.current = true;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const current = Number((event.target as HTMLElement).closest<HTMLElement>("[data-door]")?.dataset.door);
    if (!Number.isInteger(current)) return;
    const last = doors.length;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = Math.min(last, current + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = Math.max(1, current - 1);
    else if (event.key === "Home") next = 1;
    else if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    if (next !== current) focusDoor(next);
  }

  function activate(door: AdventDoor) {
    const immediate = viaKeyRef.current;
    viaKeyRef.current = false;
    const act = () => {
      if (door.status === "locked") onHint(fill(copy.doorLockedHint, { date: dayLabel(door.unlocksAt, timezone) }));
      else if (door.status === "missed") onHint(copy.doorMissedHint);
      else if (door.status !== "opened" && phase !== "running") onHint(copy.doorFinaleHint);
      else onOpen(door.n);
    };
    if (walk) walk(door.n, act, immediate);
    else act();
  }

  const windowNode = (cell: FacadeCell) => {
    const door = doorByN.get(cell.n!);
    if (!door) return null;
    const status = door.status;
    const label = windowStatusLabel(copy, status);
    const date = dayLabel(door.unlocksAt, timezone);
    const extra = status === "locked" ? fill(copy.doorLockedHint, { date }) : status === "missed" ? copy.doorMissedHint : status === "opened" ? door.title : door.teaser;
    const icon = status === "opened" ? openedWindowIcon(door.n, grants) : WINDOW_ICON[status];
    const finale = cell.kind === "attic";
    return (
      <div
        key={door.n}
        role="listitem"
        className="adv-cell"
        style={{ "--col": cell.col, "--row": cell.row, "--cs": cell.colSpan, "--rs": cell.rowSpan } as CSSProperties}
        data-cell={cell.kind}
      >
        <button
          type="button"
          className={`adv-window adv-window-${status}`}
          data-door={door.n}
          data-status={status}
          data-shape={WINDOW_SHAPE[status]}
          data-big={cell.big || undefined}
          data-finale={finale || undefined}
          data-done={door.completed || undefined}
          data-igniting={lit === door.n || undefined}
          tabIndex={door.n === tabStop ? 0 : -1}
          aria-label={`${fill(copy.windowAria, { n: door.n, status: label, date })}. ${finale ? `${copy.windowFinale}. ` : ""}${extra}`}
          aria-busy={busy === door.n || undefined}
          aria-disabled={status === "locked" || status === "missed" || undefined}
          onFocus={() => setActive(door.n)}
          onPointerDown={() => { viaKeyRef.current = false; }}
          onClick={() => activate(door)}
        >
          <span className="adv-window-glass" aria-hidden="true" />
          {status === "today" && <span className="adv-ribbon" aria-hidden="true"><i /><i /><b /></span>}
          <span className="adv-window-num" aria-hidden="true">{door.n}</span>
          {icon && <AdventIcon name={icon} size={finale ? 24 : 22} className="adv-window-icon" />}
          {(cell.big || finale) && <span className="adv-window-tag" aria-hidden="true">{cell.big ? copy.windowToday : copy.windowFinale}</span>}
          {finale && <AdventIcon name="star" size={16} className="adv-window-star" />}
          {status === "opened" && door.blocksTotal > 0 && !door.completed && (
            <span className="adv-window-pips" aria-hidden="true">
              {Array.from({ length: door.blocksTotal }, (_, index) => <i key={index} className={index < door.blocksDone ? "on" : ""} />)}
            </span>
          )}
        </button>
      </div>
    );
  };

  return (
    <div className="adv-facade-scroll" ref={scrollRef} data-fit={phase === "running" || undefined} data-scroll={layout.rows > 6 ? "true" : undefined}>
      <div className="adv-facade" data-roof={template.roof.shape} data-windows={template.windows.shape} data-panes={template.windows.panes} data-door-shape={template.door.shape} data-template={template.id} data-snow={template.decor.snow ? "on" : "off"} style={{ ...facadeVars(template.colors), "--rows": layout.rows } as CSSProperties}>
        <Roof template={template} signText={signText} />
        <div className="adv-wall" ref={wallRef}>
          <div className="adv-windows" role="list" aria-label={copy.windowsLabel} onKeyDown={onKeyDown}>
            {layout.cells.filter((cell) => cell.kind !== "door").map(windowNode)}
          </div>
          {layout.cells.filter((cell) => cell.kind === "door").map((cell) => (
            <div key="door" className="adv-cell" style={{ "--col": cell.col, "--row": cell.row, "--cs": cell.colSpan, "--rs": cell.rowSpan } as CSSProperties} data-cell="door">
              <div className="adv-front-door">
                <span className="adv-front-light" aria-hidden="true" />
                {!street && <span className="adv-host"><HeroSprite hero={host} mood="happy" pose="wave" facing={1} marker={null} /></span>}
              </div>
            </div>
          ))}
          {street}
        </div>
        <div className="adv-ground" aria-hidden="true"><i /><i /><i /></div>
      </div>
    </div>
  );
}
