import { describe, expect, it } from "vitest";

import { maskEmail } from "@/server/mask";

describe("maskEmail", () => {
  it("keeps the first letter and the domain", () => {
    expect(maskEmail("anna@domain.ru")).toBe("a***@domain.ru");
    expect(maskEmail("ivan.petrov+promo@sub.company.ru")).toBe("i***@sub.company.ru");
  });

  it("masks one-letter and non-Latin local parts", () => {
    expect(maskEmail("a@x.io")).toBe("a***@x.io");
    expect(maskEmail("иван@почта.рф")).toBe("и***@почта.рф");
  });

  it("never reveals the local part, even after the last @ in odd input", () => {
    expect(maskEmail("quoted@name@domain.ru")).toBe("q***@domain.ru");
    expect(maskEmail("secret")).toBe("***");
    expect(maskEmail("@domain.ru")).toBe("***");
    expect(maskEmail("")).toBe("***");
    expect(maskEmail("secret@")).toBe("s***");
  });
});
