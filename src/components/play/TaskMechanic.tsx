"use client";

import { AccessTask } from "@/components/game/tasks/AccessTask";
import { BuildTask } from "@/components/game/tasks/BuildTask";
import { OrderTask } from "@/components/game/tasks/OrderTask";
import { PhishTask } from "@/components/game/tasks/PhishTask";
import { PickTask } from "@/components/game/tasks/PickTask";
import type { TaskViewProps } from "@/components/game/room-ui";
import type { PublicTask } from "@/types/api";

/** Механика задания по его типу. Единственное место, где тип задания превращается в компонент. */
export function TaskMechanic({ task, ...view }: Omit<TaskViewProps, "task"> & { task: PublicTask }) {
  switch (task.type) {
    case "pick":
      return <PickTask {...view} task={task} />;
    case "build":
      return <BuildTask {...view} task={task} />;
    case "phish":
      return <PhishTask {...view} task={task} />;
    case "access":
      return <AccessTask {...view} task={task} />;
    case "order":
      return <OrderTask {...view} task={task} />;
  }
}
