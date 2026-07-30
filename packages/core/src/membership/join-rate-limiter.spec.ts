import { JoinRateLimiter } from './join-rate-limiter';

describe('JoinRateLimiter (REQ-ID-006)', () => {
  it('allows up to the limit within a window, then refuses', () => {
    const now = { t: 1_000_000 };
    const limiter = new JoinRateLimiter(2, 60_000, () => now.t);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(true);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(true);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(false);
  });

  it('tracks IPs independently', () => {
    const limiter = new JoinRateLimiter(1, 60_000);
    expect(limiter.tryAcquire('1.1.1.1')).toBe(true);
    expect(limiter.tryAcquire('2.2.2.2')).toBe(true);
    expect(limiter.tryAcquire('1.1.1.1')).toBe(false);
  });

  it('resets after the window elapses', () => {
    const now = { t: 1_000_000 };
    const limiter = new JoinRateLimiter(1, 60_000, () => now.t);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(true);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(false);
    now.t += 60_001;
    expect(limiter.tryAcquire('1.2.3.4')).toBe(true);
  });

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
});
