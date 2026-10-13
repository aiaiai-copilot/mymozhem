### Task 2: EventEmitLimiter

**Files:**
- Create: `packages/core/src/realtime/event-emit-limiter.ts`
- Test: `packages/core/src/realtime/event-emit-limiter.spec.ts`

**Interfaces:**
- Consumes: `AppConfig.EVENT_EMIT_RATE_LIMIT_PER_MIN` (Task 1 — в factory, Task 4).
- Produces: `class EventEmitLimiter { constructor(limit: number, windowMs?: number, now?: () => number); tryAcquire(key: string): boolean }` — потребляется `EventLogService` (Task 4-5). Паттерн — точная копия дисциплины `packages/core/src/membership/join-rate-limiter.ts`.

- [ ] **Step 1: Write the failing tests**

Создать `packages/core/src/realtime/event-emit-limiter.spec.ts`:

```ts
import { EventEmitLimiter } from './event-emit-limiter';

describe('EventEmitLimiter', () => {
  it('allows up to limit attempts in the window, then rejects (REQ-RT-014)', () => {
    const now = { t: 1_000 };
    const limiter = new EventEmitLimiter(2, 60_000, () => now.t);
    expect(limiter.tryAcquire('room:actor')).toBe(true);
    expect(limiter.tryAcquire('room:actor')).toBe(true);
    expect(limiter.tryAcquire('room:actor')).toBe(false);
  });

  it('resets after the window', () => {
    const now = { t: 1_000 };
    const limiter = new EventEmitLimiter(1, 60_000, () => now.t);
    expect(limiter.tryAcquire('room:actor')).toBe(true);
    expect(limiter.tryAcquire('room:actor')).toBe(false);
    now.t += 61_000;
    expect(limiter.tryAcquire('room:actor')).toBe(true);
  });

  it('isolates keys: one actor\'s flood does not burn another\'s budget', () => {
    const limiter = new EventEmitLimiter(1, 60_000);
    expect(limiter.tryAcquire('room:a')).toBe(true);
    expect(limiter.tryAcquire('room:a')).toBe(false);
    expect(limiter.tryAcquire('room:b')).toBe(true);
    expect(limiter.tryAcquire('other-room:a')).toBe(true);
  });

  it('lazy sweep evicts expired entries at most once per window', () => {
    const now = { t: 1_000 };
    const limiter = new EventEmitLimiter(10, 60_000, () => now.t);
    limiter.tryAcquire('one-shot');
    now.t += 120_000; // два окна спустя sweep обязан вычистить ключ
    limiter.tryAcquire('trigger-sweep');
    expect((limiter as unknown as { attempts: Map<string, unknown> }).attempts.has('one-shot')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mymozhem/core test -t "EventEmitLimiter"`
Expected: FAIL — модуль `./event-emit-limiter` не существует. Фильтр матчит 4 теста.

- [ ] **Step 3: Implement the limiter**

Создать `packages/core/src/realtime/event-emit-limiter.ts`:

```ts
// Per-actor fixed-window limiter for app-event emission (REQ-RT-014,
// event_emit_rate_limit; объём фазы 1 по амендменту v1.3 — только хард per-actor,
// soft cap/алерты/режимы — фаза 4). Дисциплина состояния — как у JoinRateLimiter:
// поле экземпляра, не module-level (REQ-CORE-004); in-memory корректен при одной
// реплике (REQ-OPS-005); рестарт сбрасывает окно — принято. Ключ — `${roomId}:${actorId}`:
// флуд актора жжёт только его бюджет. Ленивый sweep не чаще раза в окно —
// one-shot ключи не копятся на жизнь процесса.
export class EventEmitLimiter {
  private readonly attempts = new Map<string, { windowStart: number; count: number }>();
  private lastSweep: number;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.lastSweep = this.now();
  }

  // Записывает попытку и возвращает, разрешена ли она. Лимитом считаются ПОПЫТКИ,
  // не только успешные commit (design §2 шаг 2): невалидные payload тоже жгут бюджет.
  tryAcquire(key: string): boolean {
    const now = this.now();
    if (now - this.lastSweep >= this.windowMs) {
      for (const [k, entry] of this.attempts) {
        if (now - entry.windowStart >= this.windowMs) this.attempts.delete(k);
      }
      this.lastSweep = now;
    }
    const entry = this.attempts.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.attempts.set(key, { windowStart: now, count: 1 });
      return true;
    }
    if (entry.count >= this.limit) {
      return false;
    }
    entry.count += 1;
    return true;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @mymozhem/core test -t "EventEmitLimiter"` → PASS (4 теста).
Run: `pnpm --filter @mymozhem/core lint` → зелёный.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/realtime/event-emit-limiter.ts packages/core/src/realtime/event-emit-limiter.spec.ts
git commit -m "feat(core): EventEmitLimiter — per-actor hard rate limit эмиссии (REQ-RT-014, объём v1.3)"
```

---

