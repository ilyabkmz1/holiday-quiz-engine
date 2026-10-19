import { describe, expect, it } from "vitest";

import { isQuestEnabled } from "@/server/quest-flag";

describe("доступность /quest", () => {
  it("вне production открыт", () => {
    expect(isQuestEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isQuestEnabled({ NODE_ENV: "test" })).toBe(true);
  });

  it("в production закрыт без явного флага", () => {
    expect(isQuestEnabled({ NODE_ENV: "production", APP_URL: "https://quiz.example" })).toBe(false);
    // QUIZ_FORCE_OPEN на публичном адресе не открывает ни квиз, ни прототип
    expect(isQuestEnabled({ NODE_ENV: "production", APP_URL: "https://quiz.example", QUIZ_FORCE_OPEN: "true", QUIZ_LOCAL_STACK: "true" })).toBe(false);
  });

  it("в production открывается QUEST_PROTOTYPE=true или локальным контуром force-open", () => {
    expect(isQuestEnabled({ NODE_ENV: "production", APP_URL: "https://stage.example", QUEST_PROTOTYPE: "true" })).toBe(true);
    expect(isQuestEnabled({ NODE_ENV: "production", APP_URL: "http://localhost:3000", QUIZ_FORCE_OPEN: "true", QUIZ_LOCAL_STACK: "true" })).toBe(true);
  });
});
