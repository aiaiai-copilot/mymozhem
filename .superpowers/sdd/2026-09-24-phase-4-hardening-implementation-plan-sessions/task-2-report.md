# Task 2 report — tx-aware гард + re-check в транзакции свипа (C-8.1)

**Commit:** `6e4a80c545931d416a1c62f3ba73e241e4caee98` — `fix(identity): close sweep race window C-8.1 — tx-aware guard + re-check rollback`
**Branch/worktree:** `phase-4-hardening` @ `.worktrees/phase-4-hardening`

## Verdict on inherited diff: MATCHES BRIEF (2 justified deviations, 1 incidental)

The uncommitted diff left by the prior implementer was reviewed line-by-line against the brief. All three source files and the new spec describe match the brief's code verbatim, with the following deviations:

1. **`guest-sweep.int-spec.ts` — `TestRaceWiringModule` imports `[RewardsModule, PrismaModule]` instead of `[RewardsModule]`** (with an explanatory comment in the diff). Root cause verified by me: `PrismaModule` is NOT `@Global` (checked `packages/core/src/prisma/prisma.module.ts`), and `RewardsModule` imports it but does not re-export `PrismaService` (checked `packages/core/src/rewards/rewards.module.ts` — exports are `RewardsService, RewardsAnonymizationGuard, AWARD_EFFECT_HANDLER`). NestJS imports are not transitive, so the guard factory's `inject: [PrismaService, ...]` would fail DI resolution in the wiring-module scope without the direct import. The deviation is necessary and correct.

2. **`guest-sweep.service.ts` — the old comment «Отзыв живых сессий гостя — по прецеденту среза исключения (membership.service.ts:118-123)…» above `tx.session.updateMany` was dropped.** Not a deviation by choice: the brief's Step 3 replacement method body (authoritative, given verbatim) omits this comment, so applying the body verbatim removes it. Minor doc loss; flagging for reviewer awareness only.

3. Incidental: the added `PrismaService` explicit import in the int-spec was explicitly called for by the brief ("добавить явный") — not a deviation.

No mutable module-level state introduced (REQ-CORE-004 respected — `RacingGuard`'s target lives in a DI token `RACE_TARGET`, captured by the factory closure). No try/catch of unique-violations; no new `$executeRaw` in service code (the one `$executeRaw` in the spec is the pre-existing pattern for backdating `createdAt`). Only the four named files were touched (verified via `git diff --stat` before commit: 4 files, +171/−40).

## RED evidence (per brief)

The brief (Step 2) accepts compile-fail as the RED form: «Допустимо сначала увидеть compile-fail — это и есть RED формы „интерфейс не существует"» (the new spec's `hasOpenAwards(tx, ids)` signature did not exist on the old interface). The prior implementer observed RED before the GREEN implementation; I was not present for it. GREEN was re-verified by me independently (below).

## GREEN runs (re-executed by me, not trusted from prior report)

Environment note: testcontainers failed initially with «Could not find a working container runtime strategy» — `/var/run/docker.sock` is a stale symlink to `~/.docker/run/docker.sock` (dead), while OrbStack's live socket is `~/.orbstack/run/docker.sock` (verified via `curl --unix-socket …/_ping` → OK). All int runs below were executed with `DOCKER_HOST=unix:///Users/alexanderlapygin/.orbstack/run/docker.sock`. This is an environment fix, not a code change; future sessions/CI on this machine need the same override or a repaired `/var/run/docker.sock`.

### 1. `pnpm --filter @mymozhem/core test:int -- guest-sweep.int-spec` — PASS
```
PASS src/identity/guest-sweep.int-spec.ts (8.89 s)
  GuestSweepService (int, REQ-ID-003/014)
    ✓ гость с истёкшим TTL анонимизируется … (79 ms)
    ✓ гость с неистёкшим TTL и REGISTERED с истёкшим не тронуты (9 ms)
    ✓ без подключённых гардов приостановки нет (rewards не подключён — REQ-RWD-001) (12 ms)
  GuestSweepService — приостановка при открытой награде (REQ-RWD-013)
    ✓ гость с открытой AWARDED не анонимизируется; после fulfill/revoke — анонимизируется следующим проходом (47 ms)
  GuestSweepService — окно гонки C-8.1: re-check откатывает свип
    ✓ award, закоммиченный между гард-чеком и коммитом, откатывает анонимизацию (0, identity не тронута) (15 ms)
Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
```
Filter matched >0 tests (5). All three describes including the new C-8.1 race describe pass.

### 2. `pnpm --filter @mymozhem/core test:int -- rewards.int-spec` (brief Step 5) — PASS
```
PASS src/rewards/rewards.int-spec.ts
  RewardsService (int)
    ✓ award.prize: декремент + insert + событие reward.awarded одной транзакцией (81 ms)
    ✓ K > quantity конкурентных награждений … (REQ-RWD-010) (27 ms)
    ✓ конкурентный дубль одного награждения … (REQ-RWD-003) (15 ms)
    ✓ повторное вручение — типизированный no-op; cross-переход … (REQ-RWD-007) (18 ms)
    ✓ двойной отзыв возвращает quantity один раз … (REQ-RWD-007/003) (16 ms)
    ✓ award.points: ledger-запись без приза и фонда, события нет (design §5) (8 ms)
    ✓ отказ эффекта откатывает транзакцию целиком — награды и события нет (подход A) (8 ms)
Test Suites: 1 passed, 1 total
Tests:       7 passed, 7 total
```
DI assembles fine with the constructor-less guard (Step 5's stated purpose).

### 3. `pnpm --filter @mymozhem/core test` — PASS
```
Test Suites: 18 passed, 18 total
Tests:       227 passed, 227 total
```

### 4. `pnpm --filter @mymozhem/core typecheck` — clean (tsc --noEmit, no output)

### 5. `pnpm --filter @mymozhem/core lint` — clean (eslint src, no output)

## Commit (brief Step 6)

Exact file list and message from the brief, plus the required Co-Authored-By trailer:
```
git add packages/core/src/identity/anonymization-guards.ts packages/core/src/rewards/rewards-anonymization.guard.ts packages/core/src/identity/guest-sweep.service.ts packages/core/src/identity/guest-sweep.int-spec.ts
git commit -m "fix(identity): close sweep race window C-8.1 — tx-aware guard + re-check rollback"
```
Result: `6e4a80c` on `phase-4-hardening`; working tree clean after commit.

## Concerns

1. **Docker socket on this machine is broken for testcontainers by default** (`/var/run/docker.sock` → dead `~/.docker/run/docker.sock`). Int tests require `DOCKER_HOST=unix://~/.orbstack/run/docker.sock` until the symlink is repaired. Worth fixing on the host so subsequent batches don't trip on it.
2. Minor: the pre-existing comment documenting the session-revocation precedent was dropped from `guest-sweep.service.ts` because the brief's verbatim replacement body omits it (item 2 above). No behavioral impact.
