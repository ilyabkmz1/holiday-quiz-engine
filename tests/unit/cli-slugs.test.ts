import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const run = (script: string, ...args: string[]) =>
  spawnSync("npx", ["tsx", `scripts/${script}.ts`, ...args], { encoding: "utf8", timeout: 60_000 });

describe("CLI: slug проверяется до любой работы с файлами и браузером", () => {
  for (const [script, extra] of [["quiz-brand", ["https://example.test"]], ["quiz-shots", []]] as const) {
    it(`${script} отвергает путь и недопустимые символы кодом 2`, () => {
      for (const slug of ["../evil", "Bad Slug"]) {
        const result = run(script, slug, ...extra);
        expect(result.status, `${script} ${slug}: ${result.stderr}`).toBe(2);
        expect(result.stderr).toMatch(/slug|Использование/);
      }
    }, 60_000);
  }

  it("quiz-shots по-прежнему сообщает о неизвестном, но корректном slug", () => {
    const result = run("quiz-shots", "no-such-pack");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("не найден");
  }, 60_000);
});
