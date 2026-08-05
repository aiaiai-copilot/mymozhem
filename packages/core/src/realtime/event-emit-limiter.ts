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
