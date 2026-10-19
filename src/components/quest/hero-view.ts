import type { Mood } from "@/components/game/characters";
import type { RoomProgress } from "@/types/api";

export type HeroView = { heroId: string; mood: Mood };

/**
 * Кто стоит у комнаты и в каком он настроении. Пока карточка открыта и после того, как комната пройдена,
 * действует герой последнего задания (`view`). У незавершённой комнаты вне карточки герой и реплика всегда
 * берутся из следующей заявки (`progress.next`): имя на кнопке «Помочь» не расходится со словами героя.
 */
export function resolveRoomHero(options: {
  view: HeroView | undefined;
  progress: Pick<RoomProgress, "completed" | "next"> | undefined;
  /** Карточка именно этой комнаты открыта. */
  playing: boolean;
  /** Герой-«хозяин» комнаты: до выдачи первой заявки и у комнат без данных. */
  host: string;
}): { heroId: string; mood: Mood | null } {
  const { view, progress, playing, host } = options;
  if (view && (playing || progress?.completed)) return { heroId: view.heroId, mood: view.mood };
  return { heroId: progress?.next?.heroId ?? host, mood: null };
}
