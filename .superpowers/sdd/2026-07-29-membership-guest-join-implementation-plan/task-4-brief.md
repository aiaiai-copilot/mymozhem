### Task 4: IdentityService.createGuest + ORGANIZER-membership при создании комнаты

**Files:**
- Create: `packages/core/src/identity/identity.service.ts`
- Create: `packages/core/src/identity/identity.module.ts`
- Create: `packages/core/src/membership/membership.service.ts`
- Create: `packages/core/src/membership/membership.module.ts`
- Modify: `packages/core/src/room/room.service.ts` (транзакция create + membership)
- Modify: `packages/core/src/room/room.module.ts` (imports MembershipModule)
- Test: `packages/core/src/identity/identity.service.int-spec.ts` (новый)
- Test: `packages/core/src/room/room.service.int-spec.ts` (ассерт ORGANIZER-membership + обновление makeService)

**Interfaces:**
- Consumes: `displayNameSchema` (Task 1), `APP_CONFIG` (Task 2), схема membership (Task 3).
- Produces: `IdentityService.createGuest(displayName: string, tx?: Prisma.TransactionClient): Promise<Identity>`; `MembershipService.createOrganizerMembership(tx: Prisma.TransactionClient, roomId: string, identityId: string): Promise<Membership>`; `IdentityModule`, `MembershipModule`. Потребитель: MembershipService.join (Task 5) использует `createGuest` с `tx`.

- [ ] **Step 1: Написать failing-тесты**

Новый `packages/core/src/identity/identity.service.int-spec.ts`:

```ts
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { IdentityService } from './identity.service';

// REQ-ID-003: гость создаётся по коду комнаты и имени; этот сервис — первый
// identity-пишущий поток (identity seam design §6).
describe('IdentityService.createGuest (REQ-ID-003)', () => {
  let db: TestDb;
  let service: IdentityService;

  beforeAll(async () => {
    db = await startTestDb();
    service = new IdentityService(db.prisma);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE identity."Identity" CASCADE');
  });

  it('creates a GUEST identity with a trimmed display name', async () => {
    const guest = await service.createGuest('  Саша  ');
    expect(guest.kind).toBe('GUEST');
    expect(guest.displayName).toBe('Саша');
    expect(guest.email).toBeNull();
    expect(guest.deletedAt).toBeNull();
  });

  it('rejects an empty-after-trim name', async () => {
    await expect(service.createGuest('   ')).rejects.toThrow();
  });

  it('rejects a name over 40 chars', async () => {
    await expect(service.createGuest('x'.repeat(41))).rejects.toThrow();
  });
});
```

В `packages/core/src/room/room.service.int-spec.ts`, в describe `RoomService lifecycle`, добавить:

```ts
  it('creates the ORGANIZER membership atomically with the room (REQ-ID-011, design §1)', async () => {
    const room = await service.create(ORG);
    const memberships = await db.prisma.membership.findMany({ where: { roomId: room.id } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].identityId).toBe(ORG);
    expect(memberships[0].role).toBe('ORGANIZER');
  });
```

- [ ] **Step 2: Прогнать — подтвердить RED**

Run: `pnpm --filter @mymozhem/core test:int -t "createGuest"`
Expected: FAIL — `./identity.service` не существует (компиляция спеки падает).

- [ ] **Step 3: Реализовать IdentityService + IdentityModule**

`packages/core/src/identity/identity.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Identity, Prisma } from '@prisma/client';
import { displayNameSchema } from '@mymozhem/sdk';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class IdentityService {
  constructor(private readonly prisma: PrismaService) {}

  // REQ-ID-003: a guest is created by room code + name. This is the first
  // identity-writing flow — the identity seam deferred this service to exactly here
  // (design §6 of the identity slice). displayName is validated by the SDK contract
  // schema; a ZodError propagates untyped — mapping it is the first transport's job
  // (REQ-SEC-006). `tx` lets callers join their transaction (guest join is atomic,
  // membership design §3).
  async createGuest(
    displayName: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Identity> {
    const name = displayNameSchema.parse(displayName);
    return tx.identity.create({ data: { kind: 'GUEST', displayName: name } });
  }
}
```

`packages/core/src/identity/identity.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { IdentityService } from './identity.service';

@Module({
  imports: [PrismaModule],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
```

- [ ] **Step 4: Реализовать MembershipService (пока только createOrganizerMembership) + MembershipModule**

`packages/core/src/membership/membership.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Membership, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MembershipService {
  constructor(private readonly prisma: PrismaService) {}

  // Called by RoomService.create inside its transaction: the organizer becomes the
  // room's first member (design §1). A violation of the partial unique index
  // "Membership_single_organizer_key" rolls the room insert back too.
  async createOrganizerMembership(
    tx: Prisma.TransactionClient,
    roomId: string,
    identityId: string,
  ): Promise<Membership> {
    return tx.membership.create({
      data: { roomId, identityId, role: 'ORGANIZER' },
    });
  }
}
```

`packages/core/src/membership/membership.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MembershipService } from './membership.service';

@Module({
  imports: [PrismaModule],
  providers: [MembershipService],
  exports: [MembershipService],
})
export class MembershipModule {}
```

- [ ] **Step 5: RoomService.create — транзакция с ORGANIZER-membership**

В `packages/core/src/room/room.service.ts`:

- Импорт: `import { MembershipService } from '../membership/membership.service';`
- Конструктор (membership ПЕРЕД config):

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLog: EventLogService,
    private readonly appRegistry: AppRegistryService,
    private readonly membership: MembershipService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
```

- Тело цикла в `create` — транзакция; `insertRoom` принимает `tx`:

```ts
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateRoomCode(this.config.ROOM_CODE_MIN_LEN);
      try {
        return await this.prisma.$transaction(async (tx) => {
          const room = await this.insertRoom(tx, organizerId, code, policy);
          await this.membership.createOrganizerMembership(tx, room.id, organizerId);
          return room;
        });
      } catch (e) {
        if (attempt < 2 && isRoomCodeCollision(e)) continue;
        throw e;
      }
    }
```

- Сигнатура `insertRoom` и его `$queryRaw` через `tx`:

```ts
  private async insertRoom(
    tx: Prisma.TransactionClient,
    organizerId: string,
    code: string,
    joinPolicy: RoomJoinPolicy,
  ): Promise<Room> {
    const rows = await tx.$queryRaw<Room[]>`
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

(Импорт `Prisma` из `@prisma/client` в room.service.ts уже есть — type-only.)

`packages/core/src/room/room.module.ts` — добавить MembershipModule в imports:

```ts
  imports: [PrismaModule, RealtimeModule, AppRegistryModule, ConfigModule, MembershipModule],
```

Обновить `makeService` в room.service.int-spec.ts (и все call-site'ы `new RoomService(`):

```ts
const makeService = (db: TestDb) =>
  new RoomService(
    db.prisma,
    new EventLogService(),
    new AppRegistryService([validManifests[0]]),
    new MembershipService(db.prisma),
    TEST_CONFIG,
  );
```

- [ ] **Step 6: Прогнать — GREEN**

Run:

```bash
pnpm --filter @mymozhem/core test:int -t "createGuest"
pnpm --filter @mymozhem/core test:int -t "ORGANIZER membership"
pnpm --filter @mymozhem/core test:int
```

Expected: зелёные, полная лана без регрессий.

- [ ] **Step 7: Гейты + commit**

Run: `pnpm --filter @mymozhem/core lint && pnpm --filter @mymozhem/core typecheck && pnpm --filter @mymozhem/core test`
Expected: зелёные.

```bash
git add packages/core/src
git commit -m "feat(core): IdentityService.createGuest + organizer membership on room create (REQ-ID-003, REQ-ID-011)"
```

---

