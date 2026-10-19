import { describe, expect, it } from "vitest";

import { resolveMode } from "@/server/play-mode";

describe("режим игры на главной", () => {
  it("без параметра берёт режим из кампании", () => {
    expect(resolveMode("quest", undefined)).toBe("quest");
    expect(resolveMode("cards", undefined)).toBe("cards");
  });

  it("?mode=cards и ?mode=quest переопределяют кампанию", () => {
    expect(resolveMode("quest", "cards")).toBe("cards");
    expect(resolveMode("cards", "quest")).toBe("quest");
    expect(resolveMode("quest", ["cards", "quest"])).toBe("cards");
  });

  it("неизвестное значение игнорируется", () => {
    expect(resolveMode("quest", "arcade")).toBe("quest");
    expect(resolveMode("cards", "")).toBe("cards");
  });
});
