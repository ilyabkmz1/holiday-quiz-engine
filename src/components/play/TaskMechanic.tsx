"use client";

import type { ComponentType } from "react";

import { AccessTask } from "@/components/game/tasks/AccessTask";
import { BuildTask } from "@/components/game/tasks/BuildTask";
import { OrderTask } from "@/components/game/tasks/OrderTask";
import { PhishTask } from "@/components/game/tasks/PhishTask";
import { PickTask } from "@/components/game/tasks/PickTask";
import type { TaskViewProps } from "@/components/game/room-ui";
import type { PublicTask } from "@/types/api";

type Of<T extends PublicTask["type"]> = Extract<PublicTask, { type: T }>;

/**
 * Обложка механик: подменяет только вид (компонент получает те же свойства, что и штатная механика, и так же сообщает ответ
 * через `onSubmit`), логика заданий и серверная проверка не меняются. Не заданный тип остаётся штатным.
 */
export type TaskSkin = {
  pick?: ComponentType<TaskViewProps<Of<"pick">>>;
  build?: ComponentType<TaskViewProps<Of<"build">>>;
  order?: ComponentType<TaskViewProps<Of<"order">>>;
};

/** Механика задания по его типу. Единственное место, где тип задания превращается в компонент. */
export function TaskMechanic({ task, skin, ...view }: Omit<TaskViewProps, "task"> & { task: PublicTask; skin?: TaskSkin }) {
  switch (task.type) {
    case "pick": {
      const View = skin?.pick ?? PickTask;
      return <View {...view} task={task} />;
    }
    case "build": {
      const View = skin?.build ?? BuildTask;
      return <View {...view} task={task} />;
    }
    case "phish":
      return <PhishTask {...view} task={task} />;
    case "access":
      return <AccessTask {...view} task={task} />;
    case "order": {
      const View = skin?.order ?? OrderTask;
      return <View {...view} task={task} />;
    }
  }
}
