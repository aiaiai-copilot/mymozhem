### Task 3: Миграция membership + код комнаты и политика в RoomService.create

**Files:**
- Modify: `packages/core/prisma/schema.prisma`
- Create: `packages/core/prisma/migrations/<timestamp>_membership_guest_join/migration.sql` (генерируется `--create-only`, затем дописывается вручную)
- Create: `packages/core/src/room/room-code.ts`
- Create: `packages/core/src/room/room-code.spec.ts`
- Modify: `packages/core/src/room/room.service.ts` (create: code + joinPolicy; конструктор +config)
- Modify: `packages/core/src/room/room.module.ts` (imports ConfigModule)
- Test: `packages/core/src/membership/membership-schema.int-spec.ts` (новый файл)
- Test: `packages/core/src/room/room.service.int-spec.ts` (новый describe + обновление makeService)
- Modify: `packages/core/src/identity/identity-schema.int-spec.ts` (presence-апгрейд + кросс-kind)
- Modify: `packages/core/src/testing/harness.int-spec.ts` (code в create, seed с email)
- Modify: `packages/core/jest.integration.config.js` (косметика комментария)

**Interfaces:**
- Consumes: `roomJoinPolicySchema`/`RoomJoinPolicy` (Task 1), `APP_CONFIG`/`ConfigModule`/`AppConfig` (Task 2).
- Produces: Prisma-модели `Membership`, enum'ы `MemberRole`/`RoomJoinPolicy`, поля `Room.code: string`, `Room.joinPolicy: $Enums.RoomJoinPolicy`, `Identity.displayName: string | null`; `generateRoomCode(length: number): string`, `ROOM_CODE_ALPHABET: string`, `isRoomCodeCollision(e: unknown): boolean`; `RoomService.create(organizerId: string, joinPolicy?: RoomJoinPolicy): Promise<Room>`. На код опираются Tasks 4–5.

- [ ] **Step 1: Написать failing unit-тест генератора кода**

`packages/core/src/room/room-code.spec.ts`:

```ts
import { generateRoomCode, ROOM_CODE_ALPHABET } from './room-code';

describe('generateRoomCode (REQ-ID-013)', () => {
  it('produces a code of the requested length from the safe alphabet only', () => {
    const code = generateRoomCode(8);
    expect(code).toHaveLength(8);
    for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
  });

  it('excludes confusable characters by construction (no 0/o, 1/l/i)', () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[01ilo]/);
  });

  it('respects other lengths', () => {
    expect(generateRoomCode(12)).toHaveLength(12);
  });
});
```

Run: `pnpm --filter @mymozhem/core test -t "generateRoomCode"`
Expected: FAIL — модуль `./room-code` не существует.

- [ ] **Step 2: Написать failing интеграционные тесты схемы и create**

Новый `packages/core/src/membership/membership-schema.int-spec.ts`:

```ts
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';

const ORG = '00000000-0000-0000-0000-000000000001';

// REQ-ID-011 + REQ-DEV-006: таблица membership и частичный индекс единственного
// организатора существуют и ведут себя как специфицировано (design §2).
describe('Membership schema', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE membership."Membership", room."Room" CASCADE',
    );
  });

  const createRoom = (code: string) =>
    db.prisma.room.create({ data: { organizerId: ORG, code } });

  it('single-organizer partial unique index exists (REQ-DEV-006 presence test)', async () => {
    const rows = await db.prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'membership' AND indexname = 'Membership_single_organizer_key'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/^CREATE UNIQUE INDEX/);
    expect(rows[0].indexdef).toContain('"roomId"');
    expect(rows[0].indexdef).toMatch(/role = 'ORGANIZER'/);
  });

  it('enforces one ORGANIZER per room at the database level', async () => {
    const room = await createRoom('testcode1');
    const guest = await seedIdentity(db.prisma, { kind: 'GUEST' });
    await db.prisma.membership.create({
      data: { roomId: room.id, identityId: ORG, role: 'ORGANIZER' },
    });
    await expect(
      db.prisma.membership.create({
        data: { roomId: room.id, identityId: guest.id, role: 'ORGANIZER' },
      }),
    ).rejects.toThrow(/[Uu]nique constraint|duplicate key/);
  });

  it('allows a second ORGANIZER membership in a DIFFERENT room', async () => {
    const roomA = await createRoom('testcode1');
    const roomB = await createRoom('testcode2');
    await db.prisma.membership.create({
      data: { roomId: roomA.id, identityId: ORG, role: 'ORGANIZER' },
    });
    await db.prisma.membership.create({
      data: { roomId: roomB.id, identityId: ORG, role: 'ORGANIZER' },
    });
    expect(await db.prisma.membership.count()).toBe(2);
  });

  it('enforces unique(roomId, identityId)', async () => {
    const room = await createRoom('testcode1');
    const guest = await seedIdentity(db.prisma, { kind: 'GUEST' });
    await db.prisma.membership.create({
      data: { roomId: room.id, identityId: guest.id, role: 'PARTICIPANT' },
    });
    await expect(
      db.prisma.membership.create({
        data: { roomId: room.id, identityId: guest.id, role: 'SPECTATOR' },
      }),
    ).rejects.toThrow(/[Uu]nique constraint|duplicate key/);
  });

  it('enforces unique room codes', async () => {
    await createRoom('testcode1');
    await expect(createRoom('testcode1')).rejects.toThrow(
      /[Uu]nique constraint|duplicate key/,
    );
  });
});
```

Новый describe в конец `packages/core/src/room/room.service.int-spec.ts` (makeService обновляется в Step 6 — на этом шаге тесты падают и по схеме, и по сигнатуре):

```ts
describe('RoomService.create room code and join policy (REQ-ID-013, REQ-ID-002)', () => {
  let db: TestDb;
  let service: RoomService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    service = makeService(db);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  it('creates a room with an 8-char safe-alphabet code and guests policy by default', async () => {
    const room = await service.create(ORG);
    expect(room.code).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
    expect(room.joinPolicy).toBe('GUESTS');
  });

  it('generates distinct codes for two rooms', async () => {
    const a = await service.create(ORG);
    const b = await service.create(ORG);
    expect(a.code).not.toBe(b.code);
  });

  it('honours an explicit join policy', async () => {
    const room = await service.create(ORG, 'registered');
    expect(room.joinPolicy).toBe('REGISTERED');
  });

  it('rejects an invalid join policy before touching the DB', async () => {
    await expect(service.create(ORG, 'public' as never)).rejects.toThrow();
  });
});
```

Апгрейд presence-теста в `packages/core/src/identity/identity-schema.int-spec.ts` (follow-up identity-пакета): в первый тест (`exists in the migrated database`) добавить два ассерта после `expect(rows).toHaveLength(1)`:

```ts
    expect(rows[0].indexdef).toMatch(/^CREATE UNIQUE INDEX/);
    expect(rows[0].indexdef).toContain('lower("email")');
```

И новый кросс-kind тест в тот же describe:

```ts
  it('allows a GUEST row with the email of a live REGISTERED row', async () => {
    await db.prisma.identity.create({ data: { kind: 'REGISTERED', email: 'a@b.c' } });
    await db.prisma.identity.create({ data: { kind: 'GUEST', email: 'a@b.c' } });
    expect(await db.prisma.identity.count()).toBe(2);
  });
```

- [ ] **Step 3: Прогнать интеграционные — подтвердить RED**

Run: `pnpm --filter @mymozhem/core test:int -t "Membership schema"`
Expected: FAIL — `schema membership does not exist` / Prisma validation (модели нет).

- [ ] **Step 4: Обновить schema.prisma**

В `packages/core/prisma/schema.prisma`:

1. `datasource.schemas` → `["identity", "membership", "realtime", "room"]`.
2. В модель `Room` добавить поля `code`, `joinPolicy` и релейшн `memberships`; полный вид:

```prisma
model Room {
  id              String         @id @default(uuid()) @db.Uuid
  organizer       Identity       @relation(fields: [organizerId], references: [id])
  organizerId     String         @db.Uuid
  status          RoomStatus     @default(DRAFT)
  code            String         @unique
  joinPolicy      RoomJoinPolicy @default(GUESTS)
  appId           String?
  manifestVersion Int?
  appSettings     Json?
  deletedAt       DateTime?
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  logEvents       LogEvent[]
  memberships     Membership[]

  @@schema("room")
}
```

3. После enum `RoomStatus` добавить:

```prisma
// REQ-ID-002: join policy — атрибут комнаты, дефолт guests (ADR-004). Значения в БД —
// lowercase-строки спеки (прецедент EventVisibility); Prisma-имена — как у MemberRole.
enum RoomJoinPolicy {
  GUESTS      @map("guests")
  REGISTERED  @map("registered")
  INVITE_ONLY @map("invite_only")

  @@schema("room")
}
```

4. В модель `Identity` добавить `displayName String?` (после `email`) и релейшн `memberships Membership[]` (после `logEvents`).
5. В конец файла добавить:

```prisma
enum MemberRole {
  ORGANIZER
  MODERATOR
  PARTICIPANT
  SPECTATOR

  @@schema("membership")
}

// Membership — связь identity с комнатой, несущая роль (REQ-ID-011). CRUD-домен
// (ADR-005): изменения членства в лог не пишутся. ORGANIZER-membership создаётся в
// транзакции RoomService.create; единственность организатора — частичный индекс
// "Membership_single_organizer_key" (рукописная часть миграции, REQ-DEV-006).
model Membership {
  id         String    @id @default(uuid()) @db.Uuid
  room       Room      @relation(fields: [roomId], references: [id], onDelete: Restrict)
  roomId     String    @db.Uuid
  identity   Identity  @relation(fields: [identityId], references: [id], onDelete: Restrict)
  identityId String    @db.Uuid
  role       MemberRole
  joinedAt   DateTime  @default(now())

  @@unique([roomId, identityId])
  @@schema("membership")
}
```

- [ ] **Step 5: Сгенерировать миграцию (--create-only), дописать индекс, применить**

Run (cwd = корень):

```bash
docker run -d --name mm-migrate -e POSTGRES_PASSWORD=postgres -p 55434:5432 postgres:17
until docker exec mm-migrate pg_isready -U postgres | grep -q "accepting connections"; do sleep 1; done
DATABASE_URL=postgresql://postgres:postgres@localhost:55434/postgres pnpm exec prisma migrate dev --name membership_guest_join --create-only
```

Expected: создана `packages/core/prisma/migrations/<timestamp>_membership_guest_join/migration.sql` (CreateSchema membership, два enum, CreateTable Membership, ALTER Room/Identity, FK, unique-индексы). Миграция НЕ применена.

Дописать в конец сгенерированного `migration.sql`:

```sql
-- Рукописная часть (практика REQ-DEV-006): ровно один ORGANIZER-membership на
-- комнату (design §2). PARTICIPANT/SPECTATOR/MODERATOR не ограничиваются.
CREATE UNIQUE INDEX "Membership_single_organizer_key"
  ON "membership"."Membership" ("roomId")
  WHERE "role" = 'ORGANIZER';
```

Применить и сгенерировать клиент (cwd = корень; явный generate — `migrate dev` не всегда регенерирует):

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:55434/postgres pnpm exec prisma migrate dev
DATABASE_URL=postgresql://postgres:postgres@localhost:55434/postgres pnpm exec prisma generate
docker rm -f mm-migrate
```

Expected: `Applying migration ... membership_guest_join` чисто; клиент видит `prisma.membership`, `Room.code`, `Identity.displayName`.

- [ ] **Step 6: Реализовать room-code.ts и обновить RoomService.create + makeService**

Новый `packages/core/src/room/room-code.ts`:

```ts
import { randomInt } from 'node:crypto';

// REQ-ID-013: cryptographically random room code; alphabet excludes confusable
// characters (no 0/o, 1/l/i) — 31 chars, 8 chars ≈ 8.5e11 combinations. Length comes
// from ROOM_CODE_MIN_LEN (config §4), never a literal.
export const ROOM_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateRoomCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

// Unique violation on the room code (index "Room_code_key"). Driver-adapter raw
// errors surface the Postgres SQLSTATE; the retry loop in create() is a safety net —
// a collision is a ~1e-12 event and intentionally untested.
export function isRoomCodeCollision(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return (
    err?.code === '23505' &&
    typeof err.message === 'string' &&
    err.message.includes('Room_code_key')
  );
}
```

В `packages/core/src/room/room.service.ts`:

- Импорты: добавить `Inject` к `@nestjs/common`; добавить
  `import { roomJoinPolicySchema, type RoomJoinPolicy } from '@mymozhem/sdk';` (к существующему SDK-импорту — type-импорт `CoreEventName` уже есть, объединить),
  `import { APP_CONFIG } from '../config/config.tokens';`,
  `import type { AppConfig } from '../config/config.schema';`,
  `import { generateRoomCode, isRoomCodeCollision } from './room-code';`.
- Конструктор:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLog: EventLogService,
    private readonly appRegistry: AppRegistryService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
```

- `create` — полная замена метода:

```ts
  async create(organizerId: string, joinPolicy: RoomJoinPolicy = 'guests'): Promise<Room> {
    const policy = roomJoinPolicySchema.parse(joinPolicy);
    // Retry on code collision lives OUTSIDE any transaction: a failed statement aborts
    // the whole Postgres transaction, so retrying inside one is pointless.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateRoomCode(this.config.ROOM_CODE_MIN_LEN);
      try {
        return await this.insertRoom(organizerId, code, policy);
      } catch (e) {
        if (attempt < 2 && isRoomCodeCollision(e)) continue;
        throw e;
      }
    }
    throw new Error('unreachable: the retry loop exits via return or throw');
  }

  // REQ-ID-005: organizer must be a live REGISTERED identity. One atomic guarded
  // INSERT — the WHERE EXISTS predicate is the single source of truth, no
  // check-before-write (same philosophy as the guarded UPDATEs below). Race-safe
  // structurally: in phase 1 kind is immutable, later flips go GUEST→REGISTERED
  // only (REQ-ID-004), and no flow sets deletedAt on REGISTERED (design §3).
  // The same predicate lives in the "Identity_registered_email_key" index
  // condition (design §7) — change both or neither.
  // `updatedAt` is explicit: Prisma's @updatedAt is client-side, no DB default.
  private async insertRoom(
    organizerId: string,
    code: string,
    joinPolicy: RoomJoinPolicy,
  ): Promise<Room> {
    const rows = await this.prisma.$queryRaw<Room[]>`
      INSERT INTO room."Room" ("id", "organizerId", "status", "code", "joinPolicy", "createdAt", "updatedAt")
      SELECT gen_random_uuid(), ${organizerId}::uuid, 'DRAFT', ${code}, ${joinPolicy}::"room"."RoomJoinPolicy", now(), now()
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

В `packages/core/src/room/room.module.ts` — добавить ConfigModule:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AppRegistryModule } from '../app-registry/app-registry.module';
import { ConfigModule } from '../config/config.module';
import { RoomService } from './room.service';

@Module({
  imports: [PrismaModule, RealtimeModule, AppRegistryModule, ConfigModule],
  providers: [RoomService],
  exports: [RoomService],
})
export class RoomModule {}
```

Обновить `makeService` в `packages/core/src/room/room.service.int-spec.ts` (и любые другие call-site'ы `new RoomService(` — найти `grep -rn "new RoomService(" packages apps`):

```ts
import type { AppConfig } from '../config/config.schema';

const TEST_CONFIG: AppConfig = {
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: 'postgresql://unused',
  ROOM_CODE_MIN_LEN: 8,
  ROOM_PARTICIPANT_LIMIT: 500,
  JOIN_RATE_LIMIT_IP: 20,
};

const makeService = (db: TestDb) =>
  new RoomService(
    db.prisma,
    new EventLogService(),
    new AppRegistryService([validManifests[0]]),
    TEST_CONFIG,
  );
```

- [ ] **Step 7: Починить harness.int-spec.ts и косметику jest-конфига (follow-up)**

`packages/core/src/testing/harness.int-spec.ts` — seed с email и код в create:

```ts
    db = await startTestDb();
    await seedIdentity(db.prisma, {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'harness@example.test',
    });
```

```ts
    const created = await db.prisma.room.create({
      data: { organizerId: '00000000-0000-0000-0000-000000000001', code: 'harness01' },
    });
```

`packages/core/jest.integration.config.js` — комментарий к `maxWorkers`:

```js
  maxWorkers: 1, // one container per describe block (startTestDb); avoid parallel DB contention
```

- [ ] **Step 8: Прогнать тесты — GREEN**

Run:

```bash
pnpm --filter @mymozhem/core test -t "generateRoomCode"
pnpm --filter @mymozhem/core test:int -t "Membership schema"
pnpm --filter @mymozhem/core test:int -t "room code and join policy"
pnpm --filter @mymozhem/core test:int -t "partial unique index"
pnpm --filter @mymozhem/core test:int
```

Expected: все зелёные; полная лана без регрессий (существующие room/identity/realtime спеки проходят с новым конструктором и схемой).

- [ ] **Step 9: Commit**

```bash
git add packages/core/prisma packages/core/src packages/core/jest.integration.config.js
git commit -m "feat(core): membership schema + room code & join policy in create (REQ-ID-013, REQ-ID-002, REQ-ID-011)"
```

---

