/** Небольшой LRU-кэш на Map: порядок вставки = порядок использования, вытесняется самая давняя запись. */
export class LruCache<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly maxSize: number) {
    if (!Number.isInteger(maxSize) || maxSize < 1) throw new Error("LruCache: maxSize must be a positive integer");
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxSize) {
      this.entries.delete(this.entries.keys().next().value as K);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
