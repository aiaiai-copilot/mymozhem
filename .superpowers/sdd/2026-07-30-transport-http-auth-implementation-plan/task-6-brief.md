### Task 6: JoinRateLimiter — eviction протухших записей (parked minor)

**REQ:** REQ-ID-006 (лимитер — носитель); parked minor из handoff: Map растёт по одной записи на one-shot IP за жизнь процесса.

**Files:**
- Modify: `packages/core/src/membership/join-rate-limiter.ts`
- Modify: `packages/core/src/membership/join-rate-limiter.spec.ts`

- [ ] **Step 1: Падающий тест**

```ts
it('sweeps expired entries so the map does not grow per one-shot IP', () => {
  let now = 1_000_000;
  const limiter = new JoinRateLimiter(10, 60_000, () => now);
  for (let i = 0; i < 100; i++) limiter.tryAcquire(`10.0.0.${i}`);
  expect((limiter as unknown as { attempts: Map<string, unknown> }).attempts.size).toBe(100);
  now += 61_000; // все окна протухли
  limiter.tryAcquire('10.1.0.1'); // триггер sweep
  expect((limiter as unknown as { attempts: Map<string, unknown> }).attempts.size).toBe(1);
});

it('does not sweep within the same window (amortized)', () => {
  let now = 1_000_000;
  const limiter = new JoinRateLimiter(10, 60_000, () => now);
  limiter.tryAcquire('10.0.0.1');
  now += 30_000; // внутри окна
  limiter.tryAcquire('10.0.0.2');
  expect((limiter as unknown as { attempts: Map<string, unknown> }).attempts.size).toBe(2);
});
```

- [ ] **Step 2: Прогнать — падает** (`pnpm --filter @mymozhem/core test -t JoinRateLimiter`)

- [ ] **Step 3: Реализация**

```ts
export class JoinRateLimiter {
  private readonly attempts = new Map<string, { windowStart: number; count: number }>();
  private lastSweep: number;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.lastSweep = this.now();
  }

  tryAcquire(ip: string): boolean {
    const now = this.now();
    // Ленивый sweep не чаще раза в окно: one-shot IP не копятся на жизнь процесса
    // (parked minor membership-среза; амортизировано O(n) раз в windowMs).
    if (now - this.lastSweep >= this.windowMs) {
      for (const [key, entry] of this.attempts) {
        if (now - entry.windowStart >= this.windowMs) this.attempts.delete(key);
      }
      this.lastSweep = now;
    }
    const entry = this.attempts.get(ip);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.attempts.set(ip, { windowStart: now, count: 1 });
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
Также обновить header-комментарий файла: убрать «Map growth: one entry per distinct IP per process lifetime», заменить на описание lazy sweep.

- [ ] **Step 4: Прогнать — зелёно (все тесты лимитера, включая старые)**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/membership/join-rate-limiter.ts packages/core/src/membership/join-rate-limiter.spec.ts
git commit -m "fix(core): sweep expired JoinRateLimiter entries (REQ-ID-006)"
```

---

