# Task 1 report — SDK: событие `member.joined`, контракт 2.1.0

**Status:** DONE
**Commit:** `2545889826e57e6079a8c8d5400c1d342edc17c7` (branch `design-ui-batch-a`, worktree `.worktrees/design-ui-batch-a`)

## What was done

Per the brief, in TDD order:

1. **Failing test** (`packages/sdk/src/events/core-events.contract.spec.ts`):
   - Exact-key-list assertion extended with `'member.joined'` (sorted first, before `room.*`).
   - New case `validates the member.joined payload as the joining identity`: `{identityId: <uuid>}` valid; `{}` rejected; extra key (`displayName`) rejected (strict); non-uuid string rejected; `visibility === 'public'`; `version === 1`.
2. **RED run** — `pnpm --filter @mymozhem/sdk test`:
   `Test Suites: 1 failed, 29 passed`; the failure is exactly "ключа нет" — TS7053 `Property 'member.joined' does not exist on type ...` at spec line 49. 318 tests passed otherwise.
3. **Implementation:**
   - `packages/sdk/src/events/core-events.ts` — entry added after `room.cancelled`, in the `room.activated` entry style:
     `'member.joined': { schema: z.strictObject({ identityId: z.uuid() }), visibility: 'public', version: 1 }` (zod v4 `z.uuid()`, per constraint).
   - `packages/sdk/src/contract-version.ts:8` — `CONTRACT_VERSION = '2.1.0'`.
   - `packages/sdk/package.json:3` — `"version": "2.1.0"`.
4. **GREEN run** — `pnpm --filter @mymozhem/sdk test`:
   `Test Suites: 30 passed, 30 total; Tests: 329 passed, 329 total` — includes `core-events.contract.spec.ts` and `contract-version.contract.spec.ts` (SDK version ⇔ CONTRACT_VERSION parity, REQ-CTR-004).
5. **Build** — `pnpm --filter @mymozhem/sdk build` clean (tsc); `pnpm build` whole tree: `Tasks: 6 successful, 6 total` (7.36s). Only output note is the pre-existing vite >500 kB chunk-size warning on `@mymozhem/web` — unrelated noise, no action.
6. **Commit** — message verbatim from the brief + `Co-Authored-By` line:
   `feat(sdk): core-событие member.joined (payload identityId, public) — CONTRACT_VERSION 2.1.0`

## Self-review

- Entry/test style follows the `room.activated` precedent (comment above entry, `as const satisfies Record<string, EventTypeDefinition>` untouched).
- `coreEventType('member.joined')` → `'core.member.joined'` holds by construction (no per-name branches in `composeEventType`); covered indirectly by the registry shape tests.
- No `^2.0.0` contractRange pins touched anywhere — none in the diff; 2.1.0 satisfies `^2.0.0` (semver minor), per the controller ruling. The `contract-version.contract.spec.ts` `^2.0.0` acceptance case stays valid and passes.
- No new dependencies; lockfile untouched (`git status` clean after commit; only the 4 intended files in the diff: 32 insertions, 2 deletions).
- Extra CI-gate check beyond the brief: `pnpm --filter @mymozhem/sdk lint` and `typecheck` — both clean.

## Concerns

None.
