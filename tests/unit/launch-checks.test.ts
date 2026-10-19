import { describe, expect, it } from "vitest";

import { LEGAL_PLACEHOLDER } from "@/config/legal";
import { isPreviewEnvironment } from "@/server/env";
import { assertLaunchReady } from "@/server/launch-checks";

const draft = { operatorName: "Оператор", policyText: `${LEGAL_PLACEHOLDER} политика`, consentText: "Согласие" };
const approved = { operatorName: "Оператор", policyText: "Политика", consentText: "Согласие" };
const production = { APP_URL: "https://quiz.example.com", NODE_ENV: "production" as const, QUIZ_LOCAL_STACK: false };
const staging = { STAGING_USERNAME: "preview", STAGING_PASSWORD: "staging-password-16+chars" };

describe("assertLaunchReady", () => {
  it("запрещает маркер «на согласовании юриста» в настоящем production", () => {
    expect(() => assertLaunchReady(production, draft)).toThrow(/campaign\.legal/);
    expect(() => assertLaunchReady(production, draft, "demo")).toThrow("кампании «demo» (campaign.legal) содержат маркер «на согласовании юриста»: в production замените");
    expect(() => assertLaunchReady({ ...production, QUIZ_LOCAL_STACK: true }, draft)).toThrow(/campaign\.legal/);
  });

  it("пропускает утверждённые тексты в production", () => {
    expect(() => assertLaunchReady(production, approved)).not.toThrow();
  });

  it("допускает черновик на staging, в локальном контуре и вне production", () => {
    expect(() => assertLaunchReady({ ...production, ...staging }, draft)).not.toThrow();
    expect(() => assertLaunchReady({ ...production, APP_URL: "http://127.0.0.1:3000", QUIZ_LOCAL_STACK: true }, draft)).not.toThrow();
    expect(() => assertLaunchReady({ ...production, NODE_ENV: "development" }, draft)).not.toThrow();
  });

  it("не принимает за staging половину креденшелов", () => {
    expect(isPreviewEnvironment({ ...production, STAGING_USERNAME: "preview" })).toBe(false);
  });
});
