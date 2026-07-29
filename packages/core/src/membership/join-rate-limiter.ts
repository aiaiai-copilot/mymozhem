// Per-IP fixed-window limiter for room-join attempts (REQ-ID-006, join_rate_limit_ip).
// State lives in the provider instance field, NOT module-level (REQ-CORE-004's eslint
// gate passes); a single replica (REQ-OPS-005) makes in-memory correct; a restart
// resets the 60s window — acceptable (design §4). The phase-4 global backoff layer
// (REQ-ID-019, amendment v1.3) will sit behind this same interface.
// Map growth: one entry per distinct IP per process lifetime — negligible at MVP scale.
export class JoinRateLimiter {
  private readonly attempts = new Map<string, { windowStart: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  // Records the attempt and returns whether it is allowed. Called BEFORE any room
  // lookup (design §3): brute-force attempts against wrong codes accumulate too.
  tryAcquire(ip: string): boolean {
    const now = this.now();
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
