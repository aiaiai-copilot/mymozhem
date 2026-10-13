# Task 8 Report: Конкуренция и payload-нейтральность (критерий выхода ф.1, REQ-RT-007)

**Status:** DONE
**Commit:** `64d2447` — `test(core): конкурентный seq и payload-нейтральность app-событий (REQ-RT-007, критерий выхода ф.1)`
**Branch:** `phase-1-event-commit`
**Date:** 2026-08-05

## What was done

- Added the third `describe` block verbatim from `task-8-brief.md` to
  `/Users/alexanderlapygin/Projects/mymozhem/packages/core/src/realtime/event-commit.int-spec.ts`
  (the only file changed; +98 lines).
- The describe reuses file-top constants `ORG`/`P1`/`P2`/`TEST_APP` as specified; no other edits.

## Verification

- **Filtered run:** `pnpm --filter @mymozhem/core test:int -t "concurrency"` (without `--`).
  Filter matched exactly the 2 new tests: `101 skipped, 2 passed, 103 total` (10 of 11 suites skipped).
- **Flakiness check — 3 consecutive runs of the filtered suite:** all passed
  (2/2 tests each time; durations 4.6 s / 4.7 s / 4.0 s). No flakes in the concurrency races.
- **Full int suite:** `pnpm --filter @mymozhem/core test:int` — **11 suites passed, 103/103 tests passed** (53 s).
- Docker/testcontainers available and used; no environment issues.

## Tests added

1. `serializes concurrent app commits: dense seqs after activation` — 8 parallel
   `$transaction(commitAppEvent)` commits land on exactly seqs {2..9}; room log is dense {1..9}.
2. `payload-neutrality: mixed-size races stay dense and all-valid` — 20 rounds of mixed-size
   (8 KB blob vs small) racing commits with alternating start order; seqs distinct per pair,
   final log dense {1..41}, all 40 app events valid.

## Concerns

None. Tests passed immediately as expected (implementation shipped in Task 5), confirming the
per-room serialization of `commitAppEvent` holds under concurrent load — phase-1 exit criterion
(REQ-RT-007) is characterized and green.
