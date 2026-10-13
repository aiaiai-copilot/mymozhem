# Task 6 report — Экспорты, wiring приложения, полные гейты + живой boot

Date: 2026-07-29. Branch: `phase-1-membership-guest-join`. Base: a123f0d.

## What was done

### Step 1 — core exports (`packages/core/src/index.ts`)
Added verbatim per brief:
- after `export * from './config/config.schema';`: `config.tokens`, `config.module`;
- after the room block: `identity.service`, `identity.module`, `membership.errors`, `join-rate-limiter`, `membership.service`, `membership.module`.

All referenced files existed as the brief assumed.

### Step 2 — AppModule rewrite (`apps/server/src/app.module.ts`)
Full replacement with the brief's code: imports `PrismaModule, HealthModule, AppRegistryModule, RoomModule, IdentityModule, MembershipModule, RealtimeModule` from `@mymozhem/core`.

### Step 3 — full gate run (repo root)
`pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm boundary-check && pnpm guardrails && pnpm build` — **all green, exit 0**.

First run failed on `@mymozhem/server` unit/e2e (`test/health.e2e-spec.ts`): AppModule now pulls in ConfigModule, whose factory validates `process.env` at boot and threw `Invalid configuration: DATABASE_URL: expected string, received undefined`. Fix (see Deviations): placeholder `DATABASE_URL` in the spec; PrismaService is stubbed there, so no real connection. After the fix, the full chain passed end-to-end:

- lint: 3/3 packages successful
- typecheck: 5/5 tasks successful
- unit/e2e tests: sdk 14 suites / 182 tests, core 7 suites / 83 tests, server 1 suite / 3 tests — all passed
- integration (testcontainers, throwaway local PG): 8 suites / 78 tests — all passed; 6 migrations applied per suite
- boundary-check (depcruise, config untouched): `✔ no dependency violations found (247 modules, 561 dependencies cruised)` — 0 violations
- guardrails: 3/3 fired OK ("All guardrails verified alive")
- build: 3/3 packages successful

### Step 4 — live docker boot smoke
`docker compose up --build -d` → postgres Healthy, server Started.
- `curl http://localhost:3000/health/ready` → **HTTP 200** (Nest booted with MembershipModule/IdentityModule/ConfigModule — DI resolved without issues).
- `SELECT migration_name FROM _prisma_migrations ORDER BY finished_at NULLS LAST;` (via `docker compose exec -T postgres psql -U mymozhem`) → **6 rows**:

```
20260718061612_room_lifecycle
20260722151900_identity_seam
20260722153952_room_organizer_fk
20260722180147_realtime_log_event
20260723090841_room_app_config
20260729164500_membership_guest_join
```

Last migration = `_membership_guest_join`, as expected.
- `docker compose down -v` removed containers + network + volumes. Foreign container `lt-pg` (host :5432) verified still running and untouched.

### Step 5 — commits
- `d70f919` — `fix(server): set DATABASE_URL placeholder for AppModule boot in health e2e (REQ-OPS-003)` (separate fix commit, per instructions)
- `47d7105` — `feat(core): wire identity/membership modules into the app (REQ-ID-002)` (index.ts + app.module.ts only)

Untracked `AGENTS.md` not touched, not committed.

## Deviations from the brief

1. **Health e2e fix not in the brief.** The brief assumed gates would be green as-is; in reality the server health e2e boot of AppModule failed on missing `DATABASE_URL` (ConfigModule env validation, REQ-OPS-003). Minimal fix in `apps/server/test/health.e2e-spec.ts`: `process.env.DATABASE_URL ??= 'postgresql://stub:stub@localhost:5432/stub';` at the top of `beforeAll`, with a comment explaining why. No production code changed; committed separately as `fix(server):` (brief template said `fix(core): …` — used `fix(server)` since the change is in apps/server; REQ tag included as required).
2. **Commit prefix note**: main commit message kept exactly as the brief specified.
3. Brief path note: the brief actually lives in the repo at `.superpowers/sdd/2026-07-29-membership-guest-join-implementation-plan/task-6-brief.md` (the dispatch's home-dir path did not exist); content matched the steps given.

## Self-review

- index.ts exports match the brief line-for-line; no other blocks reordered.
- app.module.ts matches the brief verbatim.
- No dependency-cruiser config change; boundary-check 0 violations confirmed in the actual run.
- No changes outside the three files (index.ts, app.module.ts, health.e2e-spec.ts).
- Boot evidence gathered from the live artifact, not from unit mocks.
- One stale background-notification race during the gate run (a delayed exit-1 notification from the first failed run arrived while the second run was in flight); resolved by reading the actual output file, which showed the second full chain completing with exit 0. Both full chain runs ultimately exited 0.

## Final-review fix wave

Whole-branch review of `phase-1-membership-guest-join` (HEAD at review start: `47d7105`) flagged one important finding + deferred item 6, folded into a single scoped fix: the `TEST_CONFIG: AppConfig` literal was triplicated across three core int-specs, and a prior review ruling pre-committed to extracting it to `src/testing/` once the third call-site appeared.

### What changed (4 files, no production code)

- **NEW** `packages/core/src/testing/test-config.ts` — shared `TEST_CONFIG: AppConfig` export (NODE_ENV 'test', PORT 3000, DATABASE_URL 'postgresql://unused', ROOM_CODE_MIN_LEN 8, ROOM_PARTICIPANT_LIMIT 500, JOIN_RATE_LIMIT_IP 20), styled after the neighbouring `postgres.testcontainer.ts` / `seed-identity.ts` helpers with a one-line comment.
- `packages/core/src/room/room.service.int-spec.ts` — local definition and now-unused `type AppConfig` import removed; imports `TEST_CONFIG` from `../testing/test-config`.
- `packages/core/src/realtime/event-log.int-spec.ts` — same replacement.
- `packages/core/src/membership/membership.service.int-spec.ts` — same replacement, plus the `makeMembership` factory fallback changed from `?? 500` to `?? TEST_CONFIG.ROOM_PARTICIPANT_LIMIT` so the limit default has a single source.

Nothing else touched.

### Verification

- `pnpm --filter @mymozhem/core typecheck` → `tsc -p tsconfig.json --noEmit`, exit 0, no output.
- `pnpm --filter @mymozhem/core lint` → `eslint src`, exit 0, no warnings.
- `pnpm --filter @mymozhem/core test:int` → `Test Suites: 8 passed, 8 total / Tests: 78 passed, 78 total` (40.8 s; throwaway testcontainers).

### Commit

- `107e12d` — `refactor(core): extract shared TEST_CONFIG into src/testing (REQ-OPS-003)` — 4 files changed, 16 insertions(+), 31 deletions(−). Untracked `AGENTS.md` left alone.
