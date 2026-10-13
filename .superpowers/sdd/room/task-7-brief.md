## Task 7: Run the integration lane in CI

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root `test:int` script (Task 3). GitHub Actions `ubuntu-latest` provides a running Docker daemon, so Testcontainers works without a `services:` block.

- [ ] **Step 1: Add the integration step**

In `.github/workflows/ci.yml`, add a step after `pnpm run test` (and after `prisma generate`, which is already present):

```yaml
      - run: pnpm run test:int
        env:
          # Testcontainers spins up its own ephemeral Postgres via Docker; this is a
          # placeholder so prisma.config.ts's env('DATABASE_URL') resolves during CLI
          # config loading. The harness overrides DATABASE_URL with the live container
          # URL before `migrate deploy` (see postgres.testcontainer.ts).
          DATABASE_URL: postgresql://ci:ci@localhost:5432/ci?schema=public
```

- [ ] **Step 2: Verify the workflow file is valid YAML and the step order is correct**

Run: `pnpm dlx yaml-lint .github/workflows/ci.yml` (or visually confirm indentation).
Expected: the `test:int` step sits inside the `build` job's `steps`, after `pnpm run test`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run Testcontainers integration lane (REQ-DEV-001)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Push the branch and confirm CI is green**

```bash
git push -u origin phase-1-room-lifecycle
```
Then confirm the CI run passes (build + unit + build + boundary + guardrails + **test:int**). Do not merge here — merge/finish is handled by the finishing-a-development-branch skill after review.

---

## Self-Review

**1. Spec coverage (design doc §1 → task):**
- REQ-RT-005 (state machine + soft-delete orthogonality) → Task 1 (pure SM), Task 4 (service enforcement), Task 5 (atomicity). ✔
- REQ-CORE-002 (Room domain) → Task 6 (module registered in core domains). ✔
- REQ-CORE-003 (schema-per-module `room`) → Task 2. ✔
- REQ-CORE-004 (no global mutable state) → Task 1 (const tables), Task 4 (stateless service); enforced by existing lint/boundary in Task 6. ✔
- REQ-CORE-006 (logic in services) → Task 4. ✔
- REQ-OPS-002 (`migrate deploy`) → Task 2 (migration), Task 3 (deploy in harness). ✔
- REQ-DEV-001 (CI gates) → Task 6 (local full run), Task 7 (CI incl. integration). ✔
- REQ-DEV-002 (one lockfile) → Task 3 (pnpm add updates root lockfile). ✔
- Two typed errors (§5) → Task 1. ✔
- Deferred seams (§10) → none scaffolded; recorded in Global Constraints. ✔

**2. Placeholder scan:** No TBD/TODO; every code and command step is concrete. ✔

**3. Type consistency:** `RoomStatus` union defined in Task 1, mirrored by Prisma enum in Task 2, cast at the service boundary in Task 4. `startTestDb`/`TestDb` defined in Task 3, consumed verbatim in Tasks 4–5. `RoomService` method names (`create`/`transition`/`activate`/`complete`/`cancel`/`softDelete`) consistent across Tasks 4–6. Error classes/codes (`RoomTransitionError`/`RoomConflictError`, `ROOM_TRANSITION_INVALID`/`ROOM_CONFLICT`) consistent Task 1 → 4 → 5. ✔

**Two-stage review (CLAUDE.md §3):** stage 1 (spec-compliance) checks the listed REQ-* above — headline REQ-RT-005; stage 2 checks code quality.
