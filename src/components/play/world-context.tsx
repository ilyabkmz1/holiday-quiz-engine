"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { buildWorldModel, type WorldModel, type WorldRoom } from "@/worlds/model";
import type { World } from "@/worlds/world";

type WorldValue = { world: World; model: WorldModel };

const WorldContext = createContext<WorldValue | null>(null);

/** Мир пакета (по `worldId`) и его модель для зон кампании: общий для карточного режима и квеста. */
export function WorldProvider({ world, rooms, children }: { world: World; rooms: ReadonlyArray<WorldRoom>; children: ReactNode }) {
  // Модель зависит только от привязки зон к точкам: ключ стабилен, пока кампания (например, после ответа API) не сменила привязку,
  // поэтому игровой цикл мира не перезапускается от нового объекта `rooms`.
  const binding = rooms.map((room) => `${room.id}:${room.spotId ?? room.id}`).join("|");
  // Модель строится лениво, при первом `useWorldModel` (квест): карточному режиму нужен только мир, а зона cards без точки
  // мира допустима (`quiz:check` лишь предупреждает) — `buildWorldModel` на ней бросил бы и уронил страницу.
  const value = useMemo<WorldValue>(() => {
    let model: WorldModel | undefined;
    return { world, get model() { return (model ??= buildWorldModel(world, rooms)); } };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `rooms` читается только через `binding`
  }, [world, binding]);
  return <WorldContext.Provider value={value}>{children}</WorldContext.Provider>;
}

function useWorldValue(): WorldValue {
  const value = useContext(WorldContext);
  if (!value) throw new Error("WorldProvider не найден: мир приходит из пакета арендатора");
  return value;
}

/** Описание мира: иллюстрации, огни, кроп робота. */
export const useWorld = (): World => useWorldValue().world;

/** Расчётная модель мира: граф, точки зон, искорки. */
export const useWorldModel = (): WorldModel => useWorldValue().model;
