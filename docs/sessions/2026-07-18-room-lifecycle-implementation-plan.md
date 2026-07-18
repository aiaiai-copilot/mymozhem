# Room Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the minimal Room aggregate as a CRUD lifecycle state machine (REQ-RT-005): create + status transitions + orthogonal soft-delete, persisted in a dedicated `room` Postgres schema, with a pure state-machine module and a Testcontainers-backed integration test proving atomic, race-safe transitions.

**Architecture:** A dependency-free pure module (`room-state-machine.ts`) owns the transition allow-list and deletability rule; a thin `RoomService` persists via Prisma and enforces transitions with **atomic conditional `UPDATE ... WHERE status = :from`** (zero rows affected → typed conflict), not read-then-write. Two core-internal typed errors (`ROOM_TRANSITION_INVALID`, `ROOM_CONFLICT`). No HTTP surface, no lifecycle-event emission, no appSettings/pin — those are worded seams closed by later plans.

**Tech Stack:** NestJS (module/DI), Prisma 7.8 (PostgreSQL, `multiSchema` — GA, no preview flag), Jest + ts-jest, `@testcontainers/postgresql` for the DB-backed integration lane.

**Design doc:** `docs/sessions/2026-07-18-room-lifecycle-design.md` (approved 2026-07-18). This plan implements it.

## Global Constraints

Every task's requirements implicitly include this section.

- **Headline requirement — REQ-RT-005 (verbatim):** переходы статуса ограничены явной машиной состояний: `DRAFT → ACTIVE → COMPLETED`, `DRAFT → CANCELLED`, `ACTIVE → CANCELLED`; иные переходы запрещены. Мягкое удаление — ортогональный атрибут `deletedAt`, допустимый в `DRAFT`, `COMPLETED`, `CANCELLED` (не в `ACTIVE`); удаление не является статусом.
- **REQ-CORE-003:** каждый модуль владеет таблицами в отдельной PostgreSQL-схеме (Prisma `multiSchema`). Room живёт в схеме `room`. FK на таблицы других app-модулей запрещён; декларативный FK на core-таблицу допускается без каскадов (здесь не вводится — Identity ещё нет).
- **REQ-CORE-004:** глобальное мутабельное module-level состояние запрещено. Чистый state-machine модуль — только `const`-таблицы; сервис stateless поверх Prisma.
- **REQ-CORE-006:** бизнес-логика в сервисах; контроллеров/гейтвеев в этом срезе нет.
- **REQ-OPS-002:** миграции применяются детерминированно (`prisma migrate deploy`); сид в production не попадает.
- **REQ-DEV-001:** CI-гейты на каждый PR — lint (+ boundary-check), type-check, unit-тесты, сборка. Все зелёные.
- **REQ-DEV-002:** один lockfile на монорепо (`pnpm-lock.yaml`); зависимости добавляются через pnpm, lockfile коммитится.
- **REQ-DEV-006:** частичные уникальные индексы — только SQL-миграцией без preview `partialIndexes`. В этом срезе частичных индексов НЕТ; preview-фичи Prisma не включаются.
- **Typed errors are core-internal**, not SDK: room lifecycle не пересекает границу app↔core в этом срезе. Маппинг в API-ответ без стектрейсов (REQ-SEC-006) — шов на будущую HTTP-поверхность.
- **Code comments in English** (matching existing `.ts` files); doc/spec prose in Russian.
- **Node ≥ 24, TypeScript strict.** Prisma generator `prisma-client-js`, URL из `prisma.config.ts` (`env('DATABASE_URL')`).
- **Seams NOT built (record, do not scaffold):** REQ-RT-010 lifecycle-эмит в лог; REQ-RT-004 appSettings/пин/заморозка; REQ-ID-005 organizer=REGISTERED + FK; авторизация переходов; HTTP surface; REQ-ID-013/002 код комнаты/политики; REQ-RT-016 запечатывание лога.

---

## File Structure

- `packages/core/src/room/room.errors.ts` — **create.** Typed core errors + codes.
- `packages/core/src/room/room-state-machine.ts` — **create.** Pure transition allow-list + guards. No Nest/Prisma deps.
- `packages/core/src/room/room-state-machine.spec.ts` — **create.** Unit tests (no DB).
- `packages/core/src/room/room.service.ts` — **create.** Prisma-backed lifecycle operations.
- `packages/core/src/room/room.service.int-spec.ts` — **create.** Integration tests (Testcontainers).
- `packages/core/src/room/room.module.ts` — **create.** Nest module wiring `RoomService`.
- `packages/core/src/testing/postgres.testcontainer.ts` — **create.** Reusable Testcontainers helper (start container → `migrate deploy` → connected `PrismaService`).
- `packages/core/src/testing/harness.int-spec.ts` — **create.** Smoke test proving harness + migration.
- `packages/core/prisma/schema.prisma` — **modify.** Add `schemas`, `RoomStatus` enum, `Room` model.
- `packages/core/prisma/migrations/**` — **create.** First migration (`room_lifecycle`).
- `packages/core/jest.integration.config.js` — **create.** Integration jest config (`*.int-spec.ts`).
- `packages/core/tsconfig.json` — **modify.** Exclude test artifacts from the build.
- `packages/core/package.json` — **modify.** Add `test:int` script + testcontainers devDeps.
- `packages/core/src/index.ts` — **modify.** Export room module surface.
- `apps/server/src/app.module.ts` — **modify.** Register `RoomModule`.
- `turbo.json` — **modify.** Add `test:int` task.
- `package.json` (root) — **modify.** Add `test:int` script.
- `.github/workflows/ci.yml` — **modify.** Run `test:int`.

---

## Task 1: Room domain errors + pure state machine

**Files:**
- Create: `packages/core/src/room/room.errors.ts`
- Create: `packages/core/src/room/room-state-machine.ts`
- Test: `packages/core/src/room/room-state-machine.spec.ts`

**Interfaces:**
- Produces:
  - `type RoomStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'`
  - `canTransition(from: RoomStatus, to: RoomStatus): boolean`
  - `assertTransition(from: RoomStatus, to: RoomStatus): void` — throws `RoomTransitionError`
  - `isDeletable(status: RoomStatus): boolean`
  - `assertDeletable(status: RoomStatus): void` — throws `RoomTransitionError`
  - `class RoomError extends Error { code: RoomErrorCode }`, `RoomTransitionError`, `RoomConflictError`
  - `ROOM_ERROR_CODES = { ROOM_TRANSITION_INVALID, ROOM_CONFLICT }`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/room/room-state-machine.spec.ts`:

```ts
import {
  canTransition,
  assertTransition,
  isDeletable,
  assertDeletable,
  type RoomStatus,
} from './room-state-machine';
import { RoomTransitionError } from './room.errors';

const LEGAL: Array<[RoomStatus, RoomStatus]> = [
  ['DRAFT', 'ACTIVE'],
  ['DRAFT', 'CANCELLED'],
  ['ACTIVE', 'COMPLETED'],
  ['ACTIVE', 'CANCELLED'],
];

const ILLEGAL: Array<[RoomStatus, RoomStatus]> = [
  ['DRAFT', 'COMPLETED'],
  ['ACTIVE', 'DRAFT'],
  ['COMPLETED', 'ACTIVE'],
  ['COMPLETED', 'CANCELLED'],
  ['CANCELLED', 'ACTIVE'],
  ['DRAFT', 'DRAFT'],
  ['ACTIVE', 'ACTIVE'],
];

describe('room-state-machine transitions', () => {
  it.each(LEGAL)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each(ILLEGAL)('rejects %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(RoomTransitionError);
  });

  it('throws with code ROOM_TRANSITION_INVALID', () => {
    try {
      assertTransition('DRAFT', 'COMPLETED');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as RoomTransitionError).code).toBe('ROOM_TRANSITION_INVALID');
    }
  });
});

describe('room-state-machine deletability', () => {
  it.each<[RoomStatus, boolean]>([
    ['DRAFT', true],
    ['COMPLETED', true],
    ['CANCELLED', true],
    ['ACTIVE', false],
  ])('isDeletable(%s) === %s', (status, expected) => {
    expect(isDeletable(status)).toBe(expected);
  });

  it('assertDeletable rejects ACTIVE with ROOM_TRANSITION_INVALID', () => {
    expect(() => assertDeletable('ACTIVE')).toThrow(RoomTransitionError);
    expect(() => assertDeletable('DRAFT')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/core exec jest room/room-state-machine -c jest.config.js`
Expected: FAIL — cannot find module `./room-state-machine` / `./room.errors`.

- [ ] **Step 3: Write the errors module**

Create `packages/core/src/room/room.errors.ts`:

```ts
// Core-internal typed domain errors for the Room lifecycle. NOT part of the SDK
// contract (these do not cross the app↔core boundary in this slice). When an HTTP
// surface for the organizer lands, these map to typed API responses without
// stack traces (REQ-SEC-006).
export const ROOM_ERROR_CODES = {
  ROOM_TRANSITION_INVALID: 'ROOM_TRANSITION_INVALID',
  ROOM_CONFLICT: 'ROOM_CONFLICT',
} as const;

export type RoomErrorCode = (typeof ROOM_ERROR_CODES)[keyof typeof ROOM_ERROR_CODES];

export class RoomError extends Error {
  constructor(
    readonly code: RoomErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

// State-machine violation: illegal transition, or soft-delete of an ACTIVE room.
export class RoomTransitionError extends RoomError {
  constructor(message: string) {
    super(ROOM_ERROR_CODES.ROOM_TRANSITION_INVALID, message);
  }
}

// Atomic conditional UPDATE affected zero rows: not-found, concurrent change,
// already terminal, or already deleted.
export class RoomConflictError extends RoomError {
  constructor(message: string) {
    super(ROOM_ERROR_CODES.ROOM_CONFLICT, message);
  }
}
```

- [ ] **Step 4: Write the state-machine module**

Create `packages/core/src/room/room-state-machine.ts`:

```ts
import { RoomTransitionError } from './room.errors';

// Domain status type. Prisma's generated `RoomStatus` enum (Task 2) mirrors these
// exact string members; the two are structurally interchangeable. This module stays
// Prisma-free so it is a pure, dependency-light leaf (unit-testable without a DB).
export type RoomStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

// Allow-list (REQ-RT-005). COMPLETED and CANCELLED are terminal — no outgoing edges.
const ROOM_TRANSITIONS: ReadonlyArray<readonly [RoomStatus, RoomStatus]> = [
  ['DRAFT', 'ACTIVE'],
  ['DRAFT', 'CANCELLED'],
  ['ACTIVE', 'COMPLETED'],
  ['ACTIVE', 'CANCELLED'],
];

// Soft-delete allowed in DRAFT/COMPLETED/CANCELLED, forbidden in ACTIVE (REQ-RT-005).
const DELETABLE_STATUSES: ReadonlySet<RoomStatus> = new Set<RoomStatus>([
  'DRAFT',
  'COMPLETED',
  'CANCELLED',
]);

export function canTransition(from: RoomStatus, to: RoomStatus): boolean {
  return ROOM_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

export function assertTransition(from: RoomStatus, to: RoomStatus): void {
  if (!canTransition(from, to)) {
    throw new RoomTransitionError(`Illegal room transition: ${from} -> ${to}`);
  }
}

export function isDeletable(status: RoomStatus): boolean {
  return DELETABLE_STATUSES.has(status);
}

export function assertDeletable(status: RoomStatus): void {
  if (!isDeletable(status)) {
    throw new RoomTransitionError(`Room in status ${status} cannot be soft-deleted`);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/core exec jest room/room-state-machine -c jest.config.js`
Expected: PASS — all `it.each` cases green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/room/room.errors.ts \
        packages/core/src/room/room-state-machine.ts \
        packages/core/src/room/room-state-machine.spec.ts
git commit -m "feat(core): room state machine + typed errors (REQ-RT-005)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Room Prisma model + first migration (schema `room`)

**Files:**
- Modify: `packages/core/prisma/schema.prisma`
- Create: `packages/core/prisma/migrations/<timestamp>_room_lifecycle/migration.sql` (via CLI)
- Create: `packages/core/prisma/migrations/migration_lock.toml` (via CLI)

**Interfaces:**
- Produces: Prisma model `Room { id, organizerId, status, deletedAt, createdAt, updatedAt }` in schema `room`; generated client type `RoomStatus` (`DRAFT|ACTIVE|COMPLETED|CANCELLED`). Consumed by Task 4 (`RoomService`) and Task 3 (harness applies the migration).

This task is scaffolding (no red-green unit test); it is exercised end-to-end by Task 3's smoke test, which applies this migration to a fresh container and asserts the table exists.

- [ ] **Step 1: Edit the schema**

Replace the contents of `packages/core/prisma/schema.prisma` with:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  schemas  = ["room"]
}

enum RoomStatus {
  DRAFT
  ACTIVE
  COMPLETED
  CANCELLED

  @@schema("room")
}

// Room — core CRUD lifecycle entity (ADR-005: not event-sourced). State machine
// in room-state-machine.ts (REQ-RT-005). organizerId is a plain column for now;
// declarative FK to identity.id + REGISTERED check are deferred (REQ-ID-005, no
// Identity table yet). appSettings/pin/freeze (REQ-RT-004) deferred to the next plan.
model Room {
  id          String     @id @default(uuid()) @db.Uuid
  organizerId String     @db.Uuid
  status      RoomStatus @default(DRAFT)
  deletedAt   DateTime?
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  @@schema("room")
}
```

- [ ] **Step 2: Verify the schema is valid**

Run: `pnpm exec prisma validate`
Expected: `The schema at packages/core/prisma/schema.prisma is valid 🚀` (no preview-feature error — multiSchema is GA in Prisma 7).

- [ ] **Step 3: Start an ephemeral local Postgres for migration authoring**

`prisma migrate dev` needs a database to diff against and record the migration. Use a throwaway container with a published host port (docker-compose's Postgres has no host port by design):

```bash
docker run --rm -d --name mm-migrate \
  -e POSTGRES_USER=mm -e POSTGRES_PASSWORD=mm -e POSTGRES_DB=mm \
  -p 5432:5432 postgres:17
# wait until ready
until docker exec mm-migrate pg_isready -U mm >/dev/null 2>&1; do sleep 1; done
```

- [ ] **Step 4: Create and apply the migration**

```bash
DATABASE_URL="postgresql://mm:mm@localhost:5432/mm" \
  pnpm exec prisma migrate dev --name room_lifecycle
```

Expected: creates `packages/core/prisma/migrations/<timestamp>_room_lifecycle/migration.sql`, applies it, and runs `prisma generate`. The SQL must contain `CREATE SCHEMA IF NOT EXISTS "room"`, `CREATE TYPE "room"."RoomStatus"`, and `CREATE TABLE "room"."Room"`.

- [ ] **Step 5: Tear down the authoring container**

```bash
docker stop mm-migrate
```

- [ ] **Step 6: Verify generate + typecheck**

Run: `pnpm exec prisma generate && pnpm --filter @mymozhem/core run typecheck`
Expected: client generated; typecheck PASS (the `Room` model is now on `PrismaClient`).

- [ ] **Step 7: Commit**

```bash
git add packages/core/prisma/schema.prisma packages/core/prisma/migrations
git commit -m "feat(core): Room model + first migration in schema room (REQ-RT-005, REQ-CORE-003, REQ-OPS-002)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Integration test harness (Testcontainers) + smoke test

**Files:**
- Modify: `packages/core/package.json` (devDeps + `test:int` script)
- Create: `packages/core/jest.integration.config.js`
- Create: `packages/core/src/testing/postgres.testcontainer.ts`
- Create: `packages/core/src/testing/harness.int-spec.ts`
- Modify: `packages/core/tsconfig.json` (exclude test artifacts from build)
- Modify: `turbo.json` (add `test:int` task)
- Modify: `package.json` (root `test:int` script)

**Interfaces:**
- Produces: `startTestDb(): Promise<TestDb>` where `TestDb = { prisma: PrismaService; stop: () => Promise<void> }`. Consumed by Tasks 4 and 5. `pnpm --filter @mymozhem/core run test:int` runs the `*.int-spec.ts` lane.

- [ ] **Step 1: Add Testcontainers devDependencies**

```bash
pnpm --filter @mymozhem/core add -D testcontainers @testcontainers/postgresql
```

Expected: both added under `devDependencies`; root `pnpm-lock.yaml` updated (REQ-DEV-002).

- [ ] **Step 2: Add the integration jest config**

Create `packages/core/jest.integration.config.js`:

```js
// Integration lane: DB-backed tests (*.int-spec.ts) against an ephemeral
// Testcontainers Postgres. Separate from unit `jest.config.js` (*.spec.ts) so unit
// runs stay fast and DB-free. `.int-spec.ts` does NOT match the unit `**/*.spec.ts`.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.int-spec.ts'],
  testTimeout: 120000, // container pull + start
  maxWorkers: 1, // one shared container per file; avoid parallel DB contention
};
```

- [ ] **Step 3: Add the `test:int` script (core)**

In `packages/core/package.json`, add to `scripts`:

```json
"test:int": "jest -c jest.integration.config.js"
```

- [ ] **Step 4: Write the Testcontainers helper**

Create `packages/core/src/testing/postgres.testcontainer.ts`:

```ts
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaService } from '../prisma/prisma.service';

// packages/core/src/testing -> repo root (four levels up).
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

export interface TestDb {
  prisma: PrismaService;
  stop: () => Promise<void>;
}

// Starts a throwaway Postgres, applies the committed migration with `migrate deploy`
// (REQ-OPS-002), and returns a connected PrismaService. NEVER points at a shared or
// production DB — the container is ephemeral and isolated by construction.
export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('postgres:17').start();
  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url; // PrismaService reads this at construction

  execSync('pnpm exec prisma migrate deploy', {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });

  const prisma = new PrismaService();
  await prisma.onModuleInit();

  return {
    prisma,
    stop: async () => {
      await prisma.onModuleDestroy();
      await container.stop();
    },
  };
}
```

- [ ] **Step 5: Write the smoke integration test (failing first)**

Create `packages/core/src/testing/harness.int-spec.ts`:

```ts
import { startTestDb, type TestDb } from './postgres.testcontainer';

describe('integration harness', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  it('applies the migration and can round-trip a Room row', async () => {
    const created = await db.prisma.room.create({
      data: { organizerId: '00000000-0000-0000-0000-000000000001' },
    });
    expect(created.status).toBe('DRAFT');
    expect(created.deletedAt).toBeNull();

    const found = await db.prisma.room.findUnique({ where: { id: created.id } });
    expect(found?.id).toBe(created.id);
  });
});
```

- [ ] **Step 6: Run the smoke test to verify it passes**

Run: `pnpm --filter @mymozhem/core run test:int -- harness`
Expected: PASS (container starts, migration applies, insert/select round-trips). Requires a running Docker daemon.

- [ ] **Step 7: Exclude test artifacts from the build**

Replace `packages/core/tsconfig.json` with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"],
  "exclude": ["src/**/*.spec.ts", "src/**/*.int-spec.ts", "src/testing/**"]
}
```

Run: `pnpm --filter @mymozhem/core run build`
Expected: PASS; `dist/` contains no `testing/` output and no compiled specs.

- [ ] **Step 8: Register the `test:int` turbo task**

In `turbo.json`, add to `tasks`:

```json
"test:int": { "dependsOn": ["^build"] }
```

- [ ] **Step 9: Add the root `test:int` script**

In root `package.json` `scripts`, add:

```json
"test:int": "turbo run test:int"
```

- [ ] **Step 10: Commit**

```bash
git add packages/core/package.json packages/core/jest.integration.config.js \
        packages/core/src/testing packages/core/tsconfig.json \
        turbo.json package.json pnpm-lock.yaml
git commit -m "test(core): Testcontainers integration harness + smoke test (REQ-OPS-002, REQ-DEV-001)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: RoomService — create, transitions, soft-delete

**Files:**
- Create: `packages/core/src/room/room.service.ts`
- Test: `packages/core/src/room/room.service.int-spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (`packages/core/src/prisma/prisma.service.ts`); pure module (`assertTransition`, `assertDeletable`, `RoomStatus`); `RoomConflictError` (Task 1); `startTestDb` (Task 3).
- Produces:
  - `class RoomService { create(organizerId: string): Promise<Room>; transition(roomId: string, to: RoomStatus): Promise<Room>; activate/complete/cancel(roomId: string): Promise<Room>; softDelete(roomId: string): Promise<Room> }`
  (`Room` is the Prisma-generated row type.)

- [ ] **Step 1: Write the failing integration test**

Create `packages/core/src/room/room.service.int-spec.ts`:

```ts
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { RoomService } from './room.service';
import { RoomTransitionError, RoomConflictError } from './room.errors';

const ORG = '00000000-0000-0000-0000-000000000001';

describe('RoomService lifecycle', () => {
  let db: TestDb;
  let service: RoomService;

  beforeAll(async () => {
    db = await startTestDb();
    service = new RoomService(db.prisma);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  it('create() yields a DRAFT room', async () => {
    const room = await service.create(ORG);
    expect(room.status).toBe('DRAFT');
    expect(room.deletedAt).toBeNull();
    expect(room.organizerId).toBe(ORG);
  });

  it('persists each legal transition', async () => {
    const a = await service.create(ORG);
    expect((await service.activate(a.id)).status).toBe('ACTIVE');
    expect((await service.complete(a.id)).status).toBe('COMPLETED');

    const b = await service.create(ORG);
    expect((await service.cancel(b.id)).status).toBe('CANCELLED');

    const c = await service.create(ORG);
    await service.activate(c.id);
    expect((await service.cancel(c.id)).status).toBe('CANCELLED');
  });

  it('rejects an illegal transition with ROOM_TRANSITION_INVALID', async () => {
    const room = await service.create(ORG);
    await expect(service.complete(room.id)).rejects.toBeInstanceOf(RoomTransitionError);
    // unchanged
    const reread = await db.prisma.room.findUnique({ where: { id: room.id } });
    expect(reread?.status).toBe('DRAFT');
  });

  it('rejects further transitions from a terminal status', async () => {
    const room = await service.create(ORG);
    await service.cancel(room.id);
    await expect(service.activate(room.id)).rejects.toBeInstanceOf(RoomTransitionError);
  });

  it('rejects transition of a missing room with ROOM_CONFLICT', async () => {
    await expect(
      service.activate('00000000-0000-0000-0000-0000000000ff'),
    ).rejects.toBeInstanceOf(RoomConflictError);
  });

  it('soft-deletes in DRAFT/COMPLETED/CANCELLED, refuses in ACTIVE', async () => {
    const draft = await service.create(ORG);
    expect((await service.softDelete(draft.id)).deletedAt).not.toBeNull();

    const active = await service.create(ORG);
    await service.activate(active.id);
    await expect(service.softDelete(active.id)).rejects.toBeInstanceOf(RoomTransitionError);

    const cancelled = await service.create(ORG);
    await service.cancel(cancelled.id);
    expect((await service.softDelete(cancelled.id)).deletedAt).not.toBeNull();
  });

  it('a soft-deleted room is inert (transitions conflict)', async () => {
    const room = await service.create(ORG);
    await service.softDelete(room.id);
    await expect(service.activate(room.id)).rejects.toBeInstanceOf(RoomConflictError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/core run test:int -- room.service`
Expected: FAIL — cannot find module `./room.service`.

- [ ] **Step 3: Implement RoomService**

Create `packages/core/src/room/room.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Room } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertTransition, assertDeletable, type RoomStatus } from './room-state-machine';
import { RoomConflictError } from './room.errors';

@Injectable()
export class RoomService {
  constructor(private readonly prisma: PrismaService) {}

  create(organizerId: string): Promise<Room> {
    // Organizer is a plain id here; REGISTERED check + FK deferred (REQ-ID-005).
    return this.prisma.room.create({ data: { organizerId } });
  }

  async transition(roomId: string, to: RoomStatus): Promise<Room> {
    const current = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!current || current.deletedAt !== null) {
      throw new RoomConflictError(`Room ${roomId} not found or deleted`);
    }
    // State-machine legality first — precise ROOM_TRANSITION_INVALID for an existing room.
    assertTransition(current.status as RoomStatus, to);
    // Atomic guarded update: correctness of the race rests on this WHERE, not on the
    // read above (REQ-RT-005; same DB-invariant philosophy as REQ-RWD-010).
    const res = await this.prisma.room.updateMany({
      where: { id: roomId, status: current.status, deletedAt: null },
      data: { status: to },
    });
    if (res.count === 0) {
      throw new RoomConflictError(`Room ${roomId} changed concurrently`);
    }
    return this.prisma.room.findUniqueOrThrow({ where: { id: roomId } });
  }

  activate(roomId: string): Promise<Room> {
    return this.transition(roomId, 'ACTIVE');
  }

  complete(roomId: string): Promise<Room> {
    return this.transition(roomId, 'COMPLETED');
  }

  cancel(roomId: string): Promise<Room> {
    return this.transition(roomId, 'CANCELLED');
  }

  async softDelete(roomId: string): Promise<Room> {
    const current = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!current || current.deletedAt !== null) {
      throw new RoomConflictError(`Room ${roomId} not found or already deleted`);
    }
    assertDeletable(current.status as RoomStatus);
    const res = await this.prisma.room.updateMany({
      where: { id: roomId, deletedAt: null, status: { not: 'ACTIVE' } },
      data: { deletedAt: new Date() },
    });
    if (res.count === 0) {
      throw new RoomConflictError(`Room ${roomId} changed concurrently`);
    }
    return this.prisma.room.findUniqueOrThrow({ where: { id: roomId } });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/core run test:int -- room.service`
Expected: PASS — all lifecycle cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/room/room.service.ts packages/core/src/room/room.service.int-spec.ts
git commit -m "feat(core): RoomService lifecycle via atomic guarded update (REQ-RT-005, REQ-CORE-006)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Concurrency / atomicity integration test

**Files:**
- Test: `packages/core/src/room/room.service.int-spec.ts` (add a `describe` block)

**Interfaces:**
- Consumes: `RoomService`, `startTestDb`, `RoomConflictError` (as above).

- [ ] **Step 1: Add the failing concurrency test**

Append to `packages/core/src/room/room.service.int-spec.ts` (inside the file, a new top-level `describe`):

```ts
describe('RoomService transition atomicity', () => {
  let db: TestDb;
  let service: RoomService;

  beforeAll(async () => {
    db = await startTestDb();
    service = new RoomService(db.prisma);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  it('two competing transitions on one room: exactly one wins, the other conflicts', async () => {
    const room = await service.create(ORG);

    const results = await Promise.allSettled([
      service.activate(room.id), // DRAFT -> ACTIVE
      service.cancel(room.id), // DRAFT -> CANCELLED
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(RoomConflictError);

    const finalStatus = (await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } }))
      .status;
    expect(['ACTIVE', 'CANCELLED']).toContain(finalStatus);
  });
});
```

Note: this test imports nothing new — `TestDb`, `startTestDb`, `RoomService`, `RoomConflictError`, and `ORG` are already imported/defined at the top of the file from Task 4.

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/core run test:int -- room.service`
Expected: PASS — the atomic guarded UPDATE lets exactly one transition win; the loser gets `ROOM_CONFLICT`. (If this ever fails intermittently, it means the transition is not atomic — a real defect, not flakiness.)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/room/room.service.int-spec.ts
git commit -m "test(core): prove transition atomicity under concurrency (REQ-RT-005)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: RoomModule wiring + core export + server registration

**Files:**
- Create: `packages/core/src/room/room.module.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/server/src/app.module.ts`

**Interfaces:**
- Consumes: `RoomService` (Task 4), `PrismaModule` (`packages/core/src/prisma/prisma.module.ts`).
- Produces: `RoomModule` (provides + exports `RoomService`); re-exported from `@mymozhem/core`.

- [ ] **Step 1: Create the module**

Create `packages/core/src/room/room.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RoomService } from './room.service';

@Module({
  imports: [PrismaModule],
  providers: [RoomService],
  exports: [RoomService],
})
export class RoomModule {}
```

- [ ] **Step 2: Export from the core entrypoint**

Add to `packages/core/src/index.ts`:

```ts
export * from './room/room.errors';
export * from './room/room-state-machine';
export * from './room/room.service';
export * from './room/room.module';
```

- [ ] **Step 3: Register in the server**

Edit `apps/server/src/app.module.ts` to add `RoomModule`:

```ts
import { Module } from '@nestjs/common';
import { AppRegistryModule, HealthModule, PrismaModule, RoomModule } from '@mymozhem/core';

@Module({
  imports: [PrismaModule, HealthModule, AppRegistryModule, RoomModule],
})
export class AppModule {}
```

- [ ] **Step 4: Verify build, typecheck, unit tests, e2e, boundary-check all green**

Run:
```bash
pnpm run build && pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run boundary-check && pnpm run guardrails
```
Expected: all PASS. `boundary-check` stays green (RoomService→PrismaService is an internal core dependency; no SDK or cross-module violation). The existing health e2e (which stubs PrismaService) still passes — `RoomModule` imports `PrismaModule`, and `RoomService` is not exercised by the health e2e.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/room/room.module.ts packages/core/src/index.ts apps/server/src/app.module.ts
git commit -m "feat(core): wire RoomModule and register it in the server (REQ-CORE-002)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

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
