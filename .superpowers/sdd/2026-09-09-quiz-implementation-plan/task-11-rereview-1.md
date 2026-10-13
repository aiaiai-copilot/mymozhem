# Task 11 — re-review 1 (scoped: fix round 4d33181)

**Scope:** verdict open findings only + new breakage in fix diff. No full re-review, no test re-run.

## Verdicts

1. **Important: dense-rank as competition ranking (`quiz-handlers.ts:540-546`)** — **ADDRESSED**
   - Fix diff changes `place = index + 1` → `place += 1` on each distinct-total transition (`finishGame`, quiz-handlers.ts). Equal totals share a place; next distinct total gets the immediately following place → true dense rank (1,2,2,3). Comment explicitly contrasts with competition ranking.
   - Test updated to a distinguishing case: `computes dense-rank standings (1,2,2,3)` now uses totals {P1:100, P2:50, P3:50, P4:30} and asserts places 1,2,2,3 — competition ranking would yield place 4 for P4, so the test now separates the two semantics.
   - Fix report names covering test (quiz-handlers.spec.ts, same test name), commands (`pnpm --filter @mymozhem/app-quiz test -- quiz-handlers` RED: 1 failed/30 passed; `pnpm --filter @mymozhem/app-quiz test` GREEN: 3 suites / 83 tests passed), plus typecheck/lint/boundary-check clean, commit 4d33181.

## New breakage in fix diff

- None. Sorting (`byTotalDescThenActor`) untouched; `place` init 0 with `+= 1` on first entry yields 1 (no off-by-one); `previousTotal`/`undefined` semantics preserved; empty-totals case unaffected (map over empty array).

**Overall: fix round approved.**
