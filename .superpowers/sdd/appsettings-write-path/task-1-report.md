# Task 1 Report: Миграция — колонки конфигурации + CHECK тройки на room."Room" (REQ-RT-004)

**Status:** DONE
**Commit:** `3ab4dd1` — `feat(core): room app config columns + triple CHECK migration (REQ-RT-004)`

## What I implemented

1. **Schema** (`packages/core/prisma/schema.prisma`): replaced the "appSettings/pin/freeze deferred" comment with the REQ-RT-004 comment block and added three nullable columns to `model Room`, verbatim from the brief: `appId String?`, `manifestVersion Int?`, `appSettings Json?`.
2. **Migration** (`packages/core/prisma/migrations/20260723090841_room_app_config/migration.sql`): generated with `prisma migrate dev --name room_app_config --create-only` against the ephemeral `mm-migrate` container (port 55432, `lt-pg` on 5432 untouched). Generated part has the three `ADD COLUMN`s; appended the hand-written `Room_config_triple` CHECK verbatim from the brief (practice REQ-DEV-006). Applied cleanly with `prisma migrate dev`, client regenerated with explicit `prisma generate`.
3. **Test** (`packages/core/src/room/room.service.int-spec.ts`): new trailing describe `Room config triple CHECK constraint (REQ-RT-004)`, verbatim from the brief — 1 accept test (all-NULL triple, then fully-set triple via raw UPDATE) + 3 parametrized rejection tests (`it.each`) proving partial triples fail at the DB level.

## TDD Evidence

### RED

Command: `pnpm --filter @mymozhem/core test:int -t "config triple"`

Output:
```
FAIL src/room/room.service.int-spec.ts
  ● Test suite failed to run
    src/room/room.service.int-spec.ts:336:19 - error TS2339: Property 'appId' does not exist on type '{ id: string; deletedAt: Date | null; ...; status: RoomStatus; }'.
    src/room/room.service.int-spec.ts:337:19 - error TS2339: Property 'manifestVersion' does not exist on type '...'.
Test Suites: 1 failed, 4 skipped, 1 of 5 total
```

Expected: the columns do not exist yet — neither in the database nor on the generated Prisma client type. Per the task context, a ts-jest compile failure on `reread.appId` counts as a valid RED (a runtime `column "appId" does not exist` would be equally valid). Confirmed RED.

(Note: the brief's literal command `... test:int -- -t "config triple"` makes jest treat `-t` as a testPathPattern ("No tests found"); dropping the extra `--` runs it correctly. Used `pnpm --filter @mymozhem/core test:int -t "config triple"` for both RED and GREEN.)

### GREEN

Command: `pnpm --filter @mymozhem/core test:int -t "config triple"`

Output:
```
PASS src/room/room.service.int-spec.ts
Test Suites: 4 skipped, 1 passed, 1 of 5 total
Tests:       33 skipped, 4 passed, 37 total
```

4 tests = 1 accept test + 3 `it.each` rejection cases (jest counts each parametrized case as a test; the brief's "2 теста" refers to the two logical `it` blocks). Migration `20260723090841_room_app_config` was applied by the Testcontainers harness during this run.

## Test results (all green)

- Focused int test: **4 passed** (config triple describe).
- Full unit suite: `pnpm --filter @mymozhem/core test` — **5 suites, 55 tests passed**.
- Full integration suite: `pnpm --filter @mymozhem/core test:int` — **5 suites, 37 tests passed** (regression check: the new migration applies ahead of every existing room/identity/realtime suite).
- `pnpm --filter @mymozhem/core typecheck` — clean (confirms regenerated client exposes `appId`/`manifestVersion`/`appSettings`).
- `pnpm --filter @mymozhem/core lint` — clean.

## Files changed

- `packages/core/prisma/schema.prisma` (modified — Room model + comment)
- `packages/core/prisma/migrations/20260723090841_room_app_config/migration.sql` (created — generated ADD COLUMNs + hand-written CHECK)
- `packages/core/src/room/room.service.int-spec.ts` (modified — new describe at end of file)

## Self-review findings

- **Completeness:** all 7 brief steps done; test code, schema block, and CHECK SQL are verbatim from the brief. Produces interface matches what Tasks 3–4 consume (`appId: string | null`, `manifestVersion: number | null`, `appSettings: Prisma.JsonValue`, CHECK `Room_config_triple`).
- **Environment discipline:** `mm-migrate` removed (`docker ps -a --filter name=mm-migrate` → empty); foreign `lt-pg` container never touched; `DATABASE_URL` set and cwd = repo root for both `migrate dev` and the explicit `prisma generate`.
- **Commit:** amended once to add the `Co-Authored-By` trailer matching repo convention (subject line unchanged, exactly as brief Step 7). Working tree clean after commit.
- **CHECK shape:** `("appId" IS NULL) = ("manifestVersion" IS NULL) AND ("appId" IS NULL) = ("appSettings" IS NULL)` — pairwise boolean equality is true exactly when all three share the same nullness, i.e. all-NULL or all-set. Verified by the 4 passing tests including the `appSettings`-only partial case.

## Issues / concerns

None blocking. Minor note for the brief: the `--` separator in the test command (`test:int -- -t ...`) is misparsed by jest (treats `-t` as a pattern); invoking without `--` works. Worth correcting in the brief so later tasks copy the working form.
