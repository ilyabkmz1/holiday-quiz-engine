import { describe, expect, it } from "vitest";

import { LruCache } from "@/server/lru";

describe("LruCache", () => {
  it("хранит не больше maxSize записей и вытесняет самую давнюю", () => {
    const cache = new LruCache<string, number>(3);
    for (const [index, key] of ["a", "b", "c", "d"].entries()) cache.set(key, index);

    expect(cache.size).toBe(3);
    expect(cache.get("a")).toBeUndefined();
    expect(["b", "c", "d"].map((key) => cache.get(key))).toEqual([1, 2, 3]);
  });

  it("чтение освежает запись, повторная запись не увеличивает размер", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);

    expect(cache.get("b")).toBeUndefined();
    cache.set("a", 10);
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBe(10);
  });

  it("при 500 записях и 1000 вставках остаётся ровно 500 последних", () => {
    const cache = new LruCache<number, number>(500);
    for (let index = 0; index < 1000; index += 1) cache.set(index, index);

    expect(cache.size).toBe(500);
    expect(cache.get(499)).toBeUndefined();
    expect(cache.get(500)).toBe(500);
    expect(cache.get(999)).toBe(999);
  });

  it("отвергает неверный размер", () => {
    expect(() => new LruCache(0)).toThrow();
    expect(() => new LruCache(1.5)).toThrow();
  });
});
