import { InMemoryAdventRepository } from "@/server/repositories/in-memory-advent-repository";

import { describeAdventRepositoryContract } from "../support/advent-repository-contract";

describeAdventRepositoryContract("in-memory", async () => new InMemoryAdventRepository());
