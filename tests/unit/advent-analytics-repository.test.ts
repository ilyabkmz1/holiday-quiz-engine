import { InMemoryAdventRepository } from "@/server/repositories/in-memory-advent-repository";

import { describeAnalyticsContract } from "../support/advent-analytics-contract";

describeAnalyticsContract("in-memory", async () => new InMemoryAdventRepository());
