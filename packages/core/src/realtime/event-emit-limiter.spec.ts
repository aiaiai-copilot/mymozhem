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
