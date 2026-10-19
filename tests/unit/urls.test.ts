import { describe, expect, it, vi } from "vitest";

import { resetRuntimeEnvCache } from "@/server/env";
import { shareImageUrl, shareUrl, verificationEndpoint } from "@/server/urls";

describe("application URLs", () => {
  it("routes email tokens through the verification API", () => {
    expect(verificationEndpoint("https://quiz.example/campaign")).toBe(
      "https://quiz.example/api/claims/verify"
    );
  });
});

describe("share URLs", () => {
  const id = "6f1c2f4e-3b1d-4a53-9c1a-0a1b2c3d4e5f";

  it("builds the public result page and image from APP_URL, not from the request", () => {
    expect(shareUrl(id, "https://quiz.example")).toBe(`https://quiz.example/share/${id}`);
    expect(shareImageUrl(id, "https://quiz.example/campaign")).toBe(`https://quiz.example/share/${id}/image`);
  });

  it("encodes the id so it cannot change the path", () => {
    expect(shareUrl("../admin?x=1#y", "https://quiz.example")).toBe("https://quiz.example/share/..%2Fadmin%3Fx%3D1%23y");
  });

  it("falls back to APP_URL from the environment", () => {
    vi.stubEnv("APP_URL", "https://env.example");
    vi.stubEnv("DATABASE_URL", "postgresql://quiz:quiz@127.0.0.1:5432/quiz");
    vi.stubEnv("SMTP_HOST", "127.0.0.1");
    vi.stubEnv("SMTP_PORT", "1025");
    vi.stubEnv("SMTP_FROM", "quiz@example.test");
    vi.stubEnv("ADMIN_USERNAME", "operator");
    vi.stubEnv("ADMIN_PASSWORD", "local-password-at-least-16");
    resetRuntimeEnvCache();
    try {
      expect(shareUrl(id)).toBe(`https://env.example/share/${id}`);
    } finally {
      vi.unstubAllEnvs();
      resetRuntimeEnvCache();
    }
  });
});
