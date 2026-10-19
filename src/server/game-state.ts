import type { CampaignConfig, Room } from "@/config/schema";
import { SCORING, nextCombo, summarizeRoom, totalScore, type RoomSummary } from "@/domain/scoring";
import { RUSH, secondsLeft } from "@/domain/rush";
import { correctIds } from "@/domain/tasks";
import type {
  RoomEntryRecord,
  RushAnswerRecord,
  RushRunRecord,
  TaskAnswerRecord,
  TaskShownRecord
} from "@/server/repositories/session-repository";
import type {
  FinalResult,
  RoomProgress,
  RushState,
  TaskOutcome,
  TaskReveal
} from "@/types/api";

/** Всё, что записано о ходе игры; из этого снимка выводятся все цифры и состояния. */
export type RawState = {
  answers: TaskAnswerRecord[];
  entries: RoomEntryRecord[];
  shown: TaskShownRecord[];
  run: RushRunRecord | null;
  rushAnswers: RushAnswerRecord[];
};

export function roomOfTask(campaign: CampaignConfig, taskId: string): Room | undefined {
  return campaign.rooms.find((room) => room.tasks.some((task) => task.id === taskId));
}

/** Ответы комнаты в порядке ответов; ответы на задания, убранные из конфигурации, пропускаются. */
export function answersOfRoom(campaign: CampaignConfig, answers: TaskAnswerRecord[], room: Room): TaskAnswerRecord[] {
  const taskIds = new Set(room.tasks.map((task) => task.id));
  return answers.filter((answer) => taskIds.has(answer.taskId));
}

/**
 * Время каждого ответа комнаты: от первой выдачи задания до ответа. Если отметки выдачи нет
 * (ответ пришёл, минуя запрос задания), отсчёт идёт от предыдущего ответа или от входа в комнату.
 */
function durationsOf(state: RawState, roomAnswers: TaskAnswerRecord[], roomId: string): number[] {
  const entered = state.entries.find((entry) => entry.roomId === roomId);
  let previous = entered?.enteredAt ?? null;
  return roomAnswers.map((answer) => {
    const shown = state.shown.find((record) => record.taskId === answer.taskId);
    // Отметка позже ответа (гонка «выдача задания» и «ответ») не считается: время берётся по запасному правилу.
    const shownAt = shown && shown.shownAt.getTime() <= answer.answeredAt.getTime() ? shown.shownAt : undefined;
    const start = shownAt ?? previous ?? answer.answeredAt;
    previous = answer.answeredAt;
    return Math.max(0, answer.answeredAt.getTime() - start.getTime());
  });
}

function summaryOf(campaign: CampaignConfig, state: RawState, room: Room, upToSeq = Infinity): RoomSummary {
  const roomAnswers = answersOfRoom(campaign, state.answers, room).filter((answer) => answer.seq <= upToSeq);
  const durations = durationsOf(state, roomAnswers, room.id);
  return summarizeRoom(
    room.id,
    roomAnswers.map((answer, index) => ({
      base: answer.basePoints,
      comboBonus: answer.comboBonus,
      durationMs: durations[index]
    })),
    room.tasks.length
  );
}

export function roomSummaries(campaign: CampaignConfig, state: RawState): RoomSummary[] {
  return campaign.rooms.map((room) => summaryOf(campaign, state, room));
}

export function rushHits(state: RawState): number {
  return state.rushAnswers.filter((answer) => answer.correct).length;
}

export function currentScore(campaign: CampaignConfig, state: RawState): number {
  return totalScore(roomSummaries(campaign, state), rushHits(state));
}

export function currentCombo(state: RawState): number {
  return state.answers.at(-1)?.combo ?? 0;
}

export function roomProgress(campaign: CampaignConfig, state: RawState, room: Room): RoomProgress {
  const entry = state.entries.find((candidate) => candidate.roomId === room.id);
  const summary = summaryOf(campaign, state, room);
  const roomAnswers = answersOfRoom(campaign, state.answers, room);
  const spentMs = durationsOf(state, roomAnswers, room.id).reduce((sum, value) => sum + value, 0);
  const currentTaskId = entry && !summary.completed ? (room.tasks[summary.answered]?.id ?? null) : null;
  const upcoming = summary.completed ? undefined : room.tasks[summary.answered];
  const shown = currentTaskId ? state.shown.find((record) => record.taskId === currentTaskId) : undefined;
  return {
    roomId: room.id,
    entered: Boolean(entry),
    enteredAt: entry?.enteredAt.toISOString() ?? null,
    spentMs,
    taskShownAt: shown?.shownAt.toISOString() ?? null,
    answered: summary.answered,
    completed: summary.completed,
    currentTaskId,
    next: upcoming ? { heroId: upcoming.heroId, say: upcoming.say } : null,
    fuses: summary.fuses,
    summary: summary.completed ? summary : null
  };
}

export function allRoomsCompleted(campaign: CampaignConfig, state: RawState): boolean {
  return campaign.rooms.every((room) => answersOfRoom(campaign, state.answers, room).length >= room.tasks.length);
}

function outcomeOf(base: number): TaskOutcome {
  return base === 100 ? "perfect" : base === 50 ? "partial" : "miss";
}

/** Разбор ответа. Предохранители считаются по ответам комнаты не позднее этого. */
export function revealOf(campaign: CampaignConfig, state: RawState, answer: TaskAnswerRecord): TaskReveal | null {
  const room = roomOfTask(campaign, answer.taskId);
  const task = room?.tasks.find((candidate) => candidate.id === answer.taskId);
  if (!room || !task) {
    return null;
  }
  const outcome = outcomeOf(answer.basePoints);
  const summary = summaryOf(campaign, state, room, answer.seq);
  return {
    taskId: task.id,
    roomId: room.id,
    type: task.type,
    payload: answer.payload,
    base: answer.basePoints,
    comboBonus: answer.comboBonus,
    combo: answer.combo,
    outcome,
    correctIds: correctIds(task),
    explanation: task.explanation,
    tip: task.tip,
    mood: outcome === "perfect" ? "happy" : outcome === "partial" ? "neutral" : "sad",
    line: outcome === "perfect" ? task.thanks : task.oops,
    fuses: summary.fuses,
    answeredAt: answer.answeredAt.toISOString()
  };
}

/** Длина серии для нового ответа по уже записанным. */
export function comboFor(state: Pick<RawState, "answers">, base: number): number {
  return nextCombo(state.answers.at(-1)?.combo ?? 0, base);
}

export function rushState(
  campaign: CampaignConfig,
  run: RushRunRecord,
  rushAnswers: RushAnswerRecord[],
  now: Date
): RushState {
  const answered = new Set(rushAnswers.map((answer) => answer.itemId));
  const currentIndex = run.poolOrder.findIndex((itemId) => !answered.has(itemId));
  const expired = now.getTime() > run.deadlineAt.getTime() + RUSH.graceMs;
  const finished = run.finishedAt !== null || expired || currentIndex < 0;
  const hits = rushAnswers.filter((answer) => answer.correct).length;
  const item = currentIndex >= 0 ? campaign.rush.pool.find((candidate) => candidate.id === run.poolOrder[currentIndex]) : undefined;
  return {
    status: finished ? "finished" : "running",
    startedAt: run.startedAt.toISOString(),
    deadlineAt: run.deadlineAt.toISOString(),
    serverNow: now.toISOString(),
    secondsLeft: secondsLeft(run.deadlineAt, now),
    answered: rushAnswers.length,
    hits,
    misses: rushAnswers.length - hits,
    points: hits * SCORING.rushHitPoints,
    total: run.poolOrder.length,
    current: !finished && item ? { itemId: item.id, prompt: item.prompt, index: currentIndex } : null
  };
}

export function finalResult(
  campaign: CampaignConfig,
  state: RawState,
  level: FinalResult["level"]
): FinalResult {
  const rooms = roomSummaries(campaign, state);
  const hits = rushHits(state);
  return {
    score: totalScore(rooms, hits),
    level,
    rooms,
    rushHits: hits,
    rushPoints: hits * SCORING.rushHitPoints,
    ornaments: campaign.rooms
      .filter((room) => rooms.find((summary) => summary.roomId === room.id)?.completed)
      .map((room) => ({ roomId: room.id, name: room.ornament }))
  };
}
