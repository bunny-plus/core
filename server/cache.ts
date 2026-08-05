export class TtlCache {
  private readonly entries = new Map<string, { expires: number; value: unknown }>();

  constructor(private readonly capacity = 500) {}

  async getOrLoad<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const cached = this.entries.get(key);
    if (cached && cached.expires > Date.now()) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.value as T;
    }
    if (cached) this.entries.delete(key);

    const value = await load();
    this.entries.set(key, { expires: Date.now() + ttlSeconds * 1_000, value });
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return value;
  }
}
