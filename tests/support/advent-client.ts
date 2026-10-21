import { ApiError, type AdventApi } from "@/components/advent/api";
import type { AdventConfig } from "@/config/advent-schema";
import { DomainError, isDomainError } from "@/domain/errors";
import { clearLeaderboardCache, loadTeamLeaderboard } from "@/server/advent-metrics";
import { IdentityService } from "@/server/services/identity-service";
import type { AdventState } from "@/types/advent";

import { adventConfig, newAdventService } from "./advent";

const STATUS = { not_found: 404, conflict: 409, invalid: 400, expired: 410, unauthorized: 401 } as const;

/**
 * Клиент адвента поверх настоящих сервисов в памяти (без HTTP): компоненты проходят тот же код, что и API, включая
 * `identity_required`, остатки удачи и коды. Время задаёт `clock.now` — так «сегодня» для теста любой день.
 */
export function memoryAdventApi(options: { advent?: AdventConfig; start?: Date } = {}) {
  clearLeaderboardCache();
  const ctx = newAdventService(options.advent ?? adventConfig());
  const clock = { now: options.start ?? new Date("2026-12-22T12:00:00+03:00") };
  let participantId: string | null = null;
  let loginToken = "";
  const identity = new IdentityService({
    repository: ctx.repository,
    advent: ctx.advent,
    verifyEndpoint: "https://advent.test/api/advent/identity/verify",
    sendLoginLink: async (_email, link) => {
      loginToken = new URL(link).searchParams.get("token")!;
    },
    onVerified: (id, at) => ctx.service.ensureCodes(id, at)
  });

  async function call<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (isDomainError(error)) throw new ApiError(STATUS[error.code], error.message);
      throw error;
    }
  }
  const require = () => {
    if (!participantId) throw new ApiError(401, "Участник недоступен.");
    return participantId;
  };
  const timed = <T extends object>(value: T) => ({ ...value, serverDate: clock.now.getTime() });

  const api: AdventApi = {
    getState: () => call(async () => timed(await ctx.service.state(require(), clock.now))),
    createParticipant: () =>
      call(async () => {
        const created = await ctx.service.createParticipant(clock.now);
        participantId = created.participant.id;
        return timed({ participantId, state: await ctx.service.state(participantId, clock.now) });
      }),
    openDay: (n) => call(async () => timed({ state: await ctx.service.openDay(require(), n, clock.now) })),
    submitBlock: (n, index, payload) => call(async () => timed(await ctx.service.submitBlock(require(), n, index, payload ?? {}, clock.now))),
    setReminders: (input) => call(async () => timed({ state: await ctx.service.setReminders(require(), input, clock.now) })),
    setTeam: (teamId) => call(async () => timed({ state: await ctx.service.setTeam(require(), teamId, clock.now) })),
    getLeaderboard: () =>
      call(async () => {
        const board = await loadTeamLeaderboard(ctx.repository, ctx.advent, clock.now, (await ctx.repository.getParticipant(require()))?.teamId ?? null);
        if (!board) throw new DomainError("not_found", "Рейтинга команд в этой кампании нет.");
        return timed(board);
      }),
    requestLink: (input) =>
      call(async () => {
        await identity.requestLink(require(), input, clock.now);
        return timed({ sent: true as const });
      })
  };

  return {
    api,
    clock,
    ctx,
    /** Подтвердить последнюю отправленную ссылку на этом устройстве (как кнопка «Войти»). */
    async confirmLogin(): Promise<AdventState> {
      const current = await ctx.repository.getParticipant(require());
      const { participant } = await identity.verify(loginToken, current, clock.now);
      participantId = participant.id;
      return ctx.service.state(participantId, clock.now);
    },
    /** Создать участника без интерфейса. */
    async ensureParticipant(): Promise<string> {
      if (!participantId) participantId = (await ctx.service.createParticipant(clock.now)).participant.id;
      return participantId;
    }
  };
}
