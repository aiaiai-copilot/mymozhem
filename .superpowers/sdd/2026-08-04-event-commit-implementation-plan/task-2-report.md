# Task 2 Report: EventEmitLimiter

**Status:** DONE
**Commit:** `c54d5a0` — `feat(core): EventEmitLimiter — per-actor hard rate limit эмиссии (REQ-RT-014, объём v1.3)`
**Branch:** `phase-1-event-commit`

## What was done

Followed the brief verbatim, in TDD order:

1. **Step 1 — failing tests first.** Created `packages/core/src/realtime/event-emit-limiter.spec.ts` exactly as specified in the brief (4 tests: limit-then-reject, window reset, key isolation, lazy sweep).
2. **Step 2 — verified failure.** `pnpm --filter @mymozhem/core test -t "EventEmitLimiter"` (no `--`) failed with `TS2307: Cannot find module './event-emit-limiter'`. The filter matched the new spec suite (its 4 tests); all other suites were skipped by the filter.
3. **Step 3 — implementation.** Created `packages/core/src/realtime/event-emit-limiter.ts` with the brief's code verbatim: plain class (no Nest decorator — module wiring is Task 4), fixed-window per-key limiter, instance-field state (REQ-CORE-004 discipline, same as `JoinRateLimiter`), lazy sweep at most once per window. No new runtime dependencies.
4. **Step 4 — green.** Same jest command: **4 passed, 0 failed** (`Tests: 110 skipped, 4 passed, 114 total`). `pnpm --filter @mymozhem/core lint`: clean.
5. **Step 5 — commit** with the exact message from the brief; only the two new files staged.

## Files

- `/Users/alexanderlapygin/Projects/mymozhem/packages/core/src/realtime/event-emit-limiter.ts`
- `/Users/alexanderlapygin/Projects/mymozhem/packages/core/src/realtime/event-emit-limiter.spec.ts`

## Interface produced (for Task 4/5 consumers)

`class EventEmitLimiter { constructor(limit: number, windowMs?: number, now?: () => number); tryAcquire(key: string): boolean }`

Key is `${roomId}:${actorId}`; attempts (not only successful commits) burn budget; attempts on invalid payloads count too (design §2 шаг 2).

## Concerns

None. The jest filter form worked exactly as instructed (no `--`), matched 4 tests, lint is green, and no other files were touched.
