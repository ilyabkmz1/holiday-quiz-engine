/**
 * Симуляция адвента для `quiz:check`: три игрока проходят пакет через настоящие сервисы на in-memory репозитории
 * (часы задаёт симуляция, как `asOf`): идеальный (каждый день вовремя), с пропусками (каждый третий день мимо) и догоняющий
 * (пришёл в последний день и открывает всё, что позволяют правила догоняния). Все игроки уже вошли по ссылке: награды с кодами
 * выдаются только им.
 */
import type { AdventConfig } from "@/config/advent-schema";
import { isDomainError } from "@/domain/errors";
import { correctPayload } from "@/domain/solve";
import { InMemoryAdventRepository } from "@/server/repositories/in-memory-advent-repository";
import { AdventService } from "@/server/services/advent-service";
import { IdentityService } from "@/server/services/identity-service";
import { RewardService } from "@/server/services/reward-service";
import { asOfForDay } from "@/tools/advent-asof";
import type { AdventState } from "@/types/advent";

export type SimRun = {
  /** Открыто дверей. */
  opened: number;
  /** Пройдено дней целиком (все блоки). */
  completed: number;
  bestStreak: number;
  goalsReached: number;
  goalsTotal: number;
  grants: number;
  /** Выдачи без кода: пул из списка пуст (коды в симуляции не загружены) или награда не требует кода. */
  grantsWithoutCode: number;
  /** Ошибки, которых быть не должно (сервис бросил исключение там, где игрок вправе действовать). */
  errors: string[];
};

export type AdventSimulation = { perfect: SimRun; skipping: SimRun; catchUp: SimRun };

const SIM_QR_SECRET = "simulation-only-qr-secret-0123456789abcdef";

async function newWorld(advent: AdventConfig) {
  const repository = new InMemoryAdventRepository();
  // Случайность детерминирована: одна и та же проверка даёт один и тот же отчёт.
  let seed = 12345;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const rewards = new RewardService(repository, advent, { qrSecret: SIM_QR_SECRET, baseUrl: "https://simulation.test", rng });
  const service = new AdventService(repository, advent, rewards);
  let token = "";
  const identity = new IdentityService({
    repository,
    advent,
    verifyEndpoint: "https://simulation.test/api/advent/identity/verify",
    sendLoginLink: async (_email, link) => {
      token = new URL(link).searchParams.get("token")!;
    },
    onVerified: (id, at) => service.ensureCodes(id, at)
  });
  async function player(now: Date): Promise<string> {
    const created = await service.createParticipant(now);
    const id = created.participant.id;
    await identity.requestLink(id, { email: `${id}@simulation.test`, consent: true, marketingConsent: false, reminderOptIn: false }, now);
    await identity.verify(token, await repository.getParticipant(id), now);
    return id;
  }
  return { service, player };
}

type World = Awaited<ReturnType<typeof newWorld>>;

async function playDay(world: World, advent: AdventConfig, participant: string, n: number, now: Date): Promise<void> {
  const day = advent.days.find((candidate) => candidate.n === n)!;
  await world.service.openDay(participant, n, now);
  for (const [index, block] of day.blocks.entries()) {
    const payload = block.type === "task" ? correctPayload(block.task) : block.type === "luck" ? { choice: 0 } : {};
    const result = await world.service.submitBlock(participant, n, index, payload, now);
    if (result.status !== "ok") throw new Error(`день ${n}, блок ${index} (${block.type}): ответ ${result.status} у вошедшего участника`);
  }
}

function summarize(advent: AdventConfig, state: AdventState, errors: string[]): SimRun {
  return {
    opened: state.doors.filter((door) => door.status === "opened").length,
    completed: state.doors.filter((door) => door.completed).length,
    bestStreak: state.streak.best,
    goalsReached: state.goals.filter((goal) => goal.reached).length,
    goalsTotal: advent.streak.goals.length,
    grants: state.grants.length,
    grantsWithoutCode: state.grants.filter((grant) => grant.code === null).length,
    errors
  };
}

const message = (error: unknown) => (isDomainError(error) ? error.message : error instanceof Error ? error.message : String(error));

export async function simulateAdvent(advent: AdventConfig): Promise<AdventSimulation> {
  const at = (n: number) => new Date(asOfForDay(advent.schedule, n, advent.schedule.unlockHour));
  const days = advent.schedule.days;

  async function run(visit: (world: World, participant: string, errors: string[]) => Promise<void>): Promise<SimRun> {
    const world = await newWorld(advent);
    const errors: string[] = [];
    const participant = await world.player(at(1));
    try {
      await visit(world, participant, errors);
    } catch (error) {
      errors.push(message(error));
    }
    return summarize(advent, await world.service.state(participant, at(days)), errors);
  }

  const perfect = await run(async (world, participant) => {
    for (let n = 1; n <= days; n += 1) await playDay(world, advent, participant, n, at(n));
  });

  const skipping = await run(async (world, participant) => {
    for (let n = 1; n <= days; n += 1) if (n % 3 !== 0) await playDay(world, advent, participant, n, at(n));
  });

  const catchUp = await run(async (world, participant) => {
    const now = at(days);
    // Пришёл в последний день: открывает всё, что открывается, от последнего к первому (как игрок, листающий назад).
    for (let n = days; n >= 1; n -= 1) {
      const state = await world.service.state(participant, now);
      const status = state.doors.find((door) => door.n === n)!.status;
      if (status === "today" || status === "catchup") await playDay(world, advent, participant, n, now);
    }
  });

  return { perfect, skipping, catchUp };
}
