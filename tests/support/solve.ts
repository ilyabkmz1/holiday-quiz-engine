import { campaign } from "@tenants/demo-office/campaign";

export { correctPayload, partialPayload, wrongPayload } from "@/domain/solve";

export const allTasks = campaign.rooms.flatMap((room) => room.tasks);
