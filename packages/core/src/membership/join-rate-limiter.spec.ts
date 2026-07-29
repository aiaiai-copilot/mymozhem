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
});
