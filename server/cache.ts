export class TtlCache {
  private readonly entries = new Map<string, { expires: number; value: unknown }>();
  private readonly activeLoads = new Map<string, number>();
  private readonly generations = new Map<string, number>();
  private readonly loads = new Map<string, { generation: number; promise: Promise<unknown> }>();

  constructor(private readonly capacity = 500) {}

  async getOrLoad<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const cached = this.entries.get(key);
    if (cached && cached.expires > Date.now()) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.value as T;
    }
    if (cached) this.entries.delete(key);

    const generation = this.generations.get(key) ?? 0;
    const existingLoad = this.loads.get(key);
    if (existingLoad?.generation === generation) return existingLoad.promise as Promise<T>;

    const promise = load().then((value) => {
      if ((this.generations.get(key) ?? 0) === generation) {
        this.entries.set(key, { expires: Date.now() + ttlSeconds * 1_000, value });
        while (this.entries.size > this.capacity) {
          const oldest = this.entries.keys().next().value;
          if (oldest === undefined) break;
          this.entries.delete(oldest);
        }
      }
      return value;
    });
    this.activeLoads.set(key, (this.activeLoads.get(key) ?? 0) + 1);
    this.loads.set(key, { generation, promise });
    try {
      return await promise;
    } finally {
      if (this.loads.get(key)?.promise === promise) this.loads.delete(key);
      const active = (this.activeLoads.get(key) ?? 1) - 1;
      if (active > 0) {
        this.activeLoads.set(key, active);
      } else {
        this.activeLoads.delete(key);
        this.generations.delete(key);
      }
    }
  }

  invalidate(key: string) {
    this.entries.delete(key);
    if (this.activeLoads.has(key)) {
      this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    } else {
      this.generations.delete(key);
    }
  }

  invalidatePrefix(prefix: string) {
    const keys = new Set([...this.entries.keys(), ...this.loads.keys()]);
    for (const key of keys) {
      if (key.startsWith(prefix)) this.invalidate(key);
    }
  }
}
