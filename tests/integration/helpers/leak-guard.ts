import { vi, type MockInstance } from "vitest";

const METHODS = ["log", "info", "warn", "error", "debug"] as const;

/** Значения, которые не должны появляться в console.* ни в одном тесте. */
export const sensitiveValues = new Set<string>();

let spies: MockInstance[] = [];
const lines: string[] = [];

export const consoleLog = {
  start(): void {
    lines.length = 0;
    spies = METHODS.map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
      })
    );
  },
  stop(): string {
    for (const spy of spies) spy.mockRestore();
    spies = [];
    return lines.join("\n");
  },
  /** Текущий вывод без остановки перехвата. */
  snapshot(): string {
    return lines.join("\n");
  },
  entries(): string[] {
    return [...lines];
  }
};
