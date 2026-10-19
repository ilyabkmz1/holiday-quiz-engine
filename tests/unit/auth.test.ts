// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { compare } = vi.hoisted(() => ({ compare: vi.fn() }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  compare.mockImplementation((a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => actual.timingSafeEqual(a, b));
  return { ...actual, timingSafeEqual: compare };
});

import { verifyBasicAuth } from "@/server/auth";

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

describe("verifyBasicAuth", () => {
  beforeEach(() => {
    compare.mockClear();
  });

  it("принимает верную пару и отклоняет неверную", () => {
    expect(verifyBasicAuth(basic("op", "secret"), "op", "secret")).toBe(true);
    expect(verifyBasicAuth(basic("op", "nope"), "op", "secret")).toBe(false);
    expect(verifyBasicAuth(basic("x", "secret"), "op", "secret")).toBe(false);
    expect(verifyBasicAuth(basic("x", "nope"), "op", "secret")).toBe(false);
    expect(verifyBasicAuth(null, "op", "secret")).toBe(false);
  });

  it("сравнивает и логин, и пароль всегда, даже если логин неверный", () => {
    compare.mockClear();
    expect(verifyBasicAuth(basic("intruder", "secret"), "op", "secret")).toBe(false);
    expect(compare).toHaveBeenCalledTimes(2);
  });
});
