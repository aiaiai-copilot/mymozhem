### Task 4: Guarded INSERT in RoomService.create + ROOM_ORGANIZER_NOT_REGISTERED

**Files:**
- Modify: `packages/core/src/room/room.errors.ts`
- Modify: `packages/core/src/room/room.service.ts`
- Modify: `packages/core/src/room/room.service.int-spec.ts`

**Interfaces:**
- Consumes: `seedIdentity` from Task 3.
- Produces: `RoomOrganizerNotRegisteredError` (code `ROOM_ORGANIZER_NOT_REGISTERED` in `ROOM_ERROR_CODES`); `RoomService.create(organizerId: string): Promise<Room>` now rejects non-REGISTERED organizers. No external consumer of the error yet (core-internal, REQ-SEC-006 seam documented).

- [ ] **Step 1: Add the error code and class**

In `packages/core/src/room/room.errors.ts`, extend `ROOM_ERROR_CODES` and add the class:

```ts
export const ROOM_ERROR_CODES = {
  ROOM_TRANSITION_INVALID: 'ROOM_TRANSITION_INVALID',
  ROOM_CONFLICT: 'ROOM_CONFLICT',
  ROOM_ORGANIZER_NOT_REGISTERED: 'ROOM_ORGANIZER_NOT_REGISTERED',
} as const;
```

Append after `RoomConflictError`:

```ts
// Organizer identity missing, GUEST, or anonymized — collapsed into one code on
// purpose (design §3): to the caller it is a single refusal, and the predicate is
// identity's invariant, not a place for reconnaissance.
export class RoomOrganizerNotRegisteredError extends RoomError {
  constructor(message: string) {
    super(ROOM_ERROR_CODES.ROOM_ORGANIZER_NOT_REGISTERED, message);
  }
}
```

- [ ] **Step 2: Write the failing guard tests**

In `packages/core/src/room/room.service.int-spec.ts`, update the import:

```ts
import { RoomError, RoomTransitionError, RoomConflictError, RoomOrganizerNotRegisteredError } from './room.errors';
```

Add these tests inside the `RoomService lifecycle` describe, right after the `'create() yields a DRAFT room'` test:

```ts
  it('rejects a GUEST organizer with ROOM_ORGANIZER_NOT_REGISTERED (REQ-ID-005)', async () => {
    const guest = await seedIdentity(db.prisma, { kind: 'GUEST' });
    const err = await service.create(guest.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoomOrganizerNotRegisteredError);
    expect((err as RoomOrganizerNotRegisteredError).code).toBe('ROOM_ORGANIZER_NOT_REGISTERED');
  });

  it('rejects a nonexistent organizer with the same collapsed code', async () => {
    await expect(
      service.create('00000000-0000-0000-0000-0000000000aa'),
    ).rejects.toBeInstanceOf(RoomOrganizerNotRegisteredError);
  });

  it('rejects an anonymized (deletedAt) REGISTERED organizer', async () => {
    const ghost = await seedIdentity(db.prisma, { kind: 'REGISTERED', deletedAt: new Date() });
    await expect(service.create(ghost.id)).rejects.toBeInstanceOf(RoomOrganizerNotRegisteredError);
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @mymozhem/core run test:int -- room.service`
Expected: FAIL — `create` still inserts blindly, so the GUEST/nonexistent/anonymized organizers produce rooms instead of errors.

- [ ] **Step 4: Rewrite create() as an atomic guarded INSERT**

In `packages/core/src/room/room.service.ts`, update the import:

```ts
import { RoomConflictError, RoomOrganizerNotRegisteredError } from './room.errors';
```

Replace the whole `create` method:

```ts
  async create(organizerId: string): Promise<Room> {
    // REQ-ID-005: organizer must be a live REGISTERED identity. One atomic guarded
    // INSERT — the WHERE EXISTS predicate is the single source of truth, no
    // check-before-write (same philosophy as the guarded UPDATEs below). Race-safe
    // structurally: in phase 1 kind is immutable, later flips go GUEST→REGISTERED
    // only (REQ-ID-004), and no flow sets deletedAt on REGISTERED (design §3).
    // The same predicate lives in the "Identity_registered_email_key" index
    // condition (design §7) — change both or neither.
    // `updatedAt` is explicit: Prisma's @updatedAt is client-side, no DB default.
    const rows = await this.prisma.$queryRaw<Room[]>`
      INSERT INTO room."Room" ("id", "organizerId", "status", "createdAt", "updatedAt")
      SELECT gen_random_uuid(), ${organizerId}::uuid, 'DRAFT', now(), now()
      WHERE EXISTS (
        SELECT 1 FROM identity."Identity"
        WHERE "id" = ${organizerId}::uuid
          AND "kind" = 'REGISTERED'
          AND "deletedAt" IS NULL
      )
      RETURNING *
    `;
    if (rows.length === 0) {
      throw new RoomOrganizerNotRegisteredError(
        `Organizer ${organizerId} is not a live REGISTERED identity`,
      );
    }
    return rows[0];
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @mymozhem/core run test:int -- room.service`
Expected: PASS — all lifecycle, atomicity, CHECK, FK, and guard tests.

- [ ] **Step 6: Run the full gate set on the package**

Run: `pnpm --filter @mymozhem/core run typecheck && pnpm --filter @mymozhem/core run test && pnpm --filter @mymozhem/core run test:int && pnpm --filter @mymozhem/core run lint`
Expected: all PASS (unit 5/5, int including new suites, lint clean).

- [ ] **Step 7: Run repo-level gates**

Run: `pnpm run boundary-check && pnpm run guardrails && pnpm --filter @mymozhem/sdk test`
Expected: 0 boundary violations; guardrails alive; SDK suite PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/room
git commit -m "feat(core): enforce REGISTERED organizer via atomic guarded INSERT (REQ-ID-005)"
```

---

## Self-Review Notes (completed by plan author)

- **Spec coverage:** §2 model+migration → Tasks 2–3; §3 guarded INSERT + error → Task 4; §4 SDK vocabulary → Task 1; §5 tests → Tasks 2 (index/FK-adjacent), 3 (FK), 4 (guard). §6 seams — no task builds them, by design. §7 dual-location predicate — comments in Task 2 SQL and Task 4 code.
- **Placeholder scan:** none — every code step carries full code.
- **Type consistency:** `seedIdentity` signature identical in Tasks 3–4; `RoomOrganizerNotRegisteredError` name identical in errors file, service, and tests; `ROOM_ERROR_CODES` extension is additive (existing two codes untouched).
- **Ordering constraint honored:** existing room int-specs break at Task 3 (FK) and are repaired inside Task 3 — every task ends green.
