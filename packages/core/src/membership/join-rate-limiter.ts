// Per-IP fixed-window limiter for room-join attempts (REQ-ID-006, join_rate_limit_ip).
// State lives in the provider instance field, NOT module-level (REQ-CORE-004's eslint
// gate passes); a single replica (REQ-OPS-005) makes in-memory correct; a restart
// resets the 60s window — acceptable (design §4). The phase-4 global backoff layer
// (REQ-ID-019, amendment v1.3) will sit behind this same interface.
// Map growth is bounded by a lazy sweep: expired entries are evicted at most once
// per window on the next tryAcquire (amortized O(n) per windowMs), so one-shot IPs
// do not accumulate for the process lifetime.
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

  // Records the attempt and returns whether it is allowed. Called BEFORE any room
  // lookup (design §3): brute-force attempts against wrong codes accumulate too.
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
