# Task 2 Report: EventLogService.commitCoreEvent + RealtimeModule + readRoomLog

**Status:** DONE (with one documented deviation from the brief's verbatim code)
**Commit:** `ab20211` — feat(core): EventLogService.commitCoreEvent primitive + RealtimeModule (REQ-RT-001, REQ-RT-007)

## What was implemented

The single write path into `realtime."LogEvent"`:

- `EventLogService.commitCoreEvent(tx, roomId, name, payload?, actorId?)` — validates the payload against the SDK's `CORE_EVENTS` registry **before** entering the critical section, then takes a per-room `pg_advisory_xact_lock(hashtextextended(roomId, 0))` and assigns dense per-room `seq` atomically in one `INSERT ... SELECT COALESCE(MAX(seq),0)+1 ... RETURNING *` statement (REQ-RT-007). Works on the caller's `Prisma.TransactionClient` so "action + log" commit atomically (REQ-DEV-008).
- `RealtimeModule` — provides/exports `EventLogService`; intentionally does NOT import `PrismaModule` (no own Prisma client needed).
- `readRoomLog(prisma, roomId)` — raw test helper reading the log in storage (= contract) form: enum as text, payload as JSON. No read-path service in core (design §10 seam).

## What was tested and results

- `pnpm --filter @mymozhem/core test:int -- event-log.int-spec` — **4/4 PASS**:
  1. contract shape (seq=1, type `core.room.completed`, visibility `public` per REQ-RT-010, actorId null, payload `{}`, schemaVersion 1)
  2. dense per-room seq, independent across rooms ([1,2] vs [1])
  3. `EVENT_PAYLOAD_INVALID` ContractError on payload mismatch, nothing written
  4. 8-way concurrent commits serialize via advisory lock to exactly dense seqs 1..8 (REQ-RT-007)
- Full core suite: unit `pnpm --filter @mymozhem/core test` — 55/55 PASS (5 suites); integration `pnpm --filter @mymozhem/core test:int` — 29/29 PASS (5 suites, ~19s).
- `pnpm --filter @mymozhem/core typecheck` and `pnpm --filter @mymozhem/core lint` — clean, 0 errors.

## TDD Evidence

**RED** (Step 2, before implementation existed):

```
$ pnpm --filter @mymozhem/core test:int -- event-log.int-spec
src/realtime/event-log.int-spec.ts:4:29 - error TS2307: Cannot find module '../testing/read-room-log' or its corresponding type declarations.
src/realtime/event-log.int-spec.ts:6:33 - error TS2307: Cannot find module './event-log.service' or its corresponding type declarations.
Test Suites: 1 failed, 1 total  /  Tests: 0 total
```

Expected RED per brief: ts-jest compile failure on the two not-yet-created modules.

**GREEN** (Step 6, after implementation):

```
$ pnpm --filter @mymozhem/core test:int -- event-log.int-spec
✓ commits one event with the contract shape (REQ-RT-001) (11 ms)
✓ assigns dense per-room seq, independent across rooms (12 ms)
✓ rejects a payload mismatch with EVENT_PAYLOAD_INVALID and writes nothing (5 ms)
✓ serializes concurrent commits via the advisory lock: dense seqs 1..N (REQ-RT-007) (24 ms)
Tests: 4 passed, 4 total
```

## Files changed (all new, committed in ab20211)

- `/Users/alexanderlapygin/Projects/mymozhem/packages/core/src/realtime/event-log.int-spec.ts`
- `/Users/alexanderlapygin/Projects/mymozhem/packages/core/src/realtime/event-log.service.ts`
- `/Users/alexanderlapygin/Projects/mymozhem/packages/core/src/realtime/realtime.module.ts`
- `/Users/alexanderlapygin/Projects/mymozhem/packages/core/src/testing/read-room-log.ts`

## Self-review findings and deviation

**Deviation (important for downstream tasks):** the brief's verbatim advisory-lock line

```ts
await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${roomId}, 0))`;
```

**does not work** under Prisma 7.8 (adapter-pg): `pg_advisory_xact_lock` returns `void`, and `$queryRaw` fails deserializing the result column:

```
PrismaClientKnownRequestError: Raw query failed. Message: `Failed to deserialize column of type 'void'...`
```

This produced a genuine RED-again on 3/4 tests in the first GREEN run (only the payload-rejection test passed, since it throws before the lock). Minimal fix preserving the brief's semantics exactly: use `$executeRaw` (no result deserialization) for that one statement, with a comment explaining why:

```ts
// $executeRaw, не $queryRaw: pg_advisory_xact_lock возвращает void, а $queryRaw
// пытается десериализовать колонку результата и падает на типе 'void'.
await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${roomId}, 0))`;
```

Lock ordering, lock key, and the atomic insert are unchanged. If Task 3's brief reuses `$queryRaw` for advisory locks, the same fix applies — the plan author should update the source snippets.

Everything else matches the brief verbatim: 4 tests as specified, validation before the lock, no PrismaModule import, no read-path service, no new dependencies, no extra files. RED was observed before GREEN; the foreign `lt-pg` container on host port 5432 was untouched.
