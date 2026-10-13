# Task 1 report: Конфиг-параметры эмиссии

**Status:** DONE
**Commit:** `39f3a2e145a34c63ce3fbf1252171649f8801750` — `feat(core): config params EVENT_EMIT_RATE_LIMIT_PER_MIN/MAX_EVENT_PAYLOAD_BYTES (REQ-RT-012/014, §4)`
**Branch:** phase-1-event-commit

## What was done

- `packages/core/src/config/config.schema.ts` — added after `REFRESH_RATE_LIMIT` (verbatim from brief):
  - `EVENT_EMIT_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(30)` (REQ-RT-014)
  - `MAX_EVENT_PAYLOAD_BYTES: z.coerce.number().int().min(1024).max(262_144).default(16_384)` (REQ-RT-012)
- `packages/core/src/testing/test-config.ts` — added both keys to `TEST_CONFIG` (`30` / `16_384`).
- `packages/core/src/config/config.schema.spec.ts` — added the two tests from the brief (defaults + out-of-range rejection), importing `configSchema` alongside `loadConfig`.

## TDD trail

1. **Red:** `pnpm --filter @mymozhem/core test -t "event emission params"` failed as expected — TS2339 (`EVENT_EMIT_RATE_LIMIT_PER_MIN`/`MAX_EVENT_PAYLOAD_BYTES` do not exist on the inferred type). Note: failure is a suite compile error, not a `2 failed` test count, because ts-jest type-checks before running — this is the failure mode the brief predicted («не существует в типе/выводе»).
2. **Green:** same command → `Tests: 2 passed, 110 total` (filter matched exactly 2, not 0).
3. **Full suite:** `pnpm --filter @mymozhem/core test` → 9 suites, 110 tests, all passed.
4. **Typecheck:** `pnpm typecheck` → 5/5 tasks successful (monorepo-wide; TEST_CONFIG now satisfies the extended `AppConfig`).

## Deviations from the brief (minor)

- In the second test, the brief's verbatim code declared a local `const base`, which would shadow the spec file's existing top-level `base` (different value: `postgresql://u:p@localhost:5432/db`). Renamed the local to `envBase` to avoid shadowing/lint risk. Assertions and values unchanged.
- The brief's tests use `configSchema.parse/safeParse` with number values; existing neighbors use `loadConfig` with string env values. Followed the brief verbatim here (it explicitly prescribed the code); both styles now coexist in the file.

## Constraints check

- No new runtime dependencies. No DB migrations. SDK contract untouched (only `packages/core` files changed; 3 files, +23/−1).
- No global mutable process state; params are plain config values consumed by later tasks.

## Concerns

None.
