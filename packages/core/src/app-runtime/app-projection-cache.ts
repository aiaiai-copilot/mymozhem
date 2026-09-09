import type { AppLogEvent } from '@mymozhem/sdk';

interface CacheEntry<S> {
  state: S;
  lastSeq: number;
}

// In-memory кэш проекций, key = roomId (комната пинится к одному app). Не источник
// истины: холодный промах пересоздаётся replay'ем лога (ADR-005). invalidate —
// точка для тестов пересоздания (design §7.6) и будущей эвикции.
export class AppProjectionCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  get<S>(roomId: string): CacheEntry<S> | undefined {
    return this.entries.get(roomId) as CacheEntry<S> | undefined;
  }

  set<S>(roomId: string, entry: CacheEntry<S>): void {
    this.entries.set(roomId, entry);
  }

  invalidate(roomId: string): void {
    this.entries.delete(roomId);
  }
}

export type { AppLogEvent };
