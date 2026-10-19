import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { DomainError, type DomainErrorCode } from "@/domain/errors";
import { apiError, DOMAIN_ERROR_STATUS } from "@/server/api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("apiError", () => {
  it.each<[DomainErrorCode, number]>([
    ["not_found", 404],
    ["conflict", 409],
    ["invalid", 400],
    ["expired", 400]
  ])("maps %s to HTTP %i and keeps the user message", async (code, status) => {
    const response = apiError(new DomainError(code, "Сообщение для пользователя."));

    expect(response.status).toBe(status);
    expect(DOMAIN_ERROR_STATUS[code]).toBe(status);
    expect(await response.json()).toEqual({ error: "Сообщение для пользователя." });
  });

  it("maps validation errors to 400 with a generic message", async () => {
    const response = apiError(new ZodError([]));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Проверьте заполнение полей." });
  });

  it("never derives the status from message text and never echoes unexpected messages", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const message of ["Session not found", "token is invalid", "connection closed for user@example.com"]) {
      const response = apiError(new Error(message));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Не удалось выполнить запрос." });
    }
    expect(spy.mock.calls.flat().join(" ")).not.toMatch(/user@example\.com/);
  });
});
