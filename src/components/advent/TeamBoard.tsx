"use client";

import { useEffect, useId, useState } from "react";

import { fill } from "@/components/advent/format";
import type { AdventApi } from "@/components/advent/api";
import type { AdventCopy } from "@/config/advent-schema";
import type { AdventState } from "@/types/advent";
import type { TeamLeaderboard } from "@/types/advent-analytics";

type Props = {
  copy: AdventCopy;
  state: AdventState;
  api: Pick<AdventApi, "getLeaderboard" | "setTeam">;
  onState: (state: AdventState) => void;
};

const decimal = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Командный зачёт (`audience.leaderboard = "teams"`): выбор команды и публичный рейтинг. В рейтинге нет имён людей: среднее число
 * открытых дверей на участника и доля играющих; у команды меньше трёх участников цифр нет. Выбор — группа радиокнопок (стрелки,
 * Tab), рейтинг — нумерованный список; полоски статичны, поэтому `prefers-reduced-motion` ничего не меняет.
 */
export function TeamBoard({ copy, state, api, onState }: Props) {
  const team = state.team;
  const legendId = useId();
  const [board, setBoard] = useState<TeamLeaderboard | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const selected = team?.selected ?? null;

  useEffect(() => {
    let alive = true;
    api
      .getLeaderboard()
      .then((next) => {
        if (!alive) return;
        setBoard(next);
        setLoadFailed(false);
      })
      .catch(() => {
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [api, selected]);

  if (!team) return null;

  async function choose(teamId: string | null) {
    if (busy || teamId === selected) return;
    setBusy(true);
    setSaveFailed(false);
    try {
      onState((await api.setTeam(teamId)).state);
    } catch {
      setSaveFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const visible = board?.teams.filter((row) => !row.hidden) ?? [];
  const best = Math.max(0, ...visible.map((row) => row.avgDoors ?? 0));

  return (
    <section className="adv-team" aria-labelledby={`${legendId}-title`}>
      <h3 id={`${legendId}-title`} className="adv-team-title">{copy.teamTitle}</h3>

      {team.canChange && (
        <fieldset className="adv-team-pick" disabled={busy}>
          <legend id={legendId}>{copy.teamPickLegend}</legend>
          <p className="adv-muted-small">{copy.teamPickHint}</p>
          <div className="adv-team-options">
            {team.options.map((option) => (
              <label key={option.id} className="adv-team-option" data-checked={selected === option.id}>
                <input type="radio" name={`${legendId}-team`} checked={selected === option.id} onChange={() => void choose(option.id)} />
                <span>{option.title}</span>
              </label>
            ))}
          </div>
          {selected !== null && (
            <button type="button" className="adv-btn adv-btn-ghost adv-team-leave" onClick={() => void choose(null)}>{copy.teamLeave}</button>
          )}
        </fieldset>
      )}
      {saveFailed && <p className="adv-error" role="alert">{copy.teamSaveError}</p>}

      {loadFailed && <p className="adv-error" role="alert">{copy.teamLoadError}</p>}
      {board && (visible.length === 0 ? (
        <p className="adv-muted">{copy.teamEmpty}</p>
      ) : null)}
      {board && (
        <ol className="adv-team-list" aria-label={copy.teamTableLabel}>
          {board.teams.map((row) => (
            <li key={row.id} className="adv-team-row" data-mine={row.id === selected} data-hidden={row.hidden}>
              <div className="adv-team-head">
                <span className="adv-team-rank" aria-hidden="true">{row.rank ?? "–"}</span>
                <span className="adv-team-name">
                  {row.title}
                  {row.id === selected && <span className="adv-tag adv-team-mine">{copy.teamMine}</span>}
                </span>
              </div>
              {row.hidden ? (
                <p className="adv-muted-small">{copy.teamHidden}</p>
              ) : (
                <>
                  <span className="adv-team-bar" aria-hidden="true"><span style={{ width: `${best > 0 ? Math.max(3, ((row.avgDoors ?? 0) / best) * 100) : 0}%` }} /></span>
                  <p className="adv-team-stats">
                    <span className="sr-only">{fill(copy.teamRank, { rank: row.rank ?? 0 })}. </span>
                    <b>{fill(copy.teamAvg, { avg: decimal.format(row.avgDoors ?? 0) })}</b>
                    <span>{fill(copy.teamActive, { p: Math.round((row.activeShare ?? 0) * 100) })}</span>
                    <span>{fill(copy.teamMembers, { k: row.members ?? 0 })}</span>
                  </p>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="adv-muted-small">{copy.teamNote}</p>
    </section>
  );
}
