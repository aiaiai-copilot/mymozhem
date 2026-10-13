### Task 5: commitAppEvent — цепочка + int-тесты

**Files:**
- Modify: `packages/core/src/realtime/event-log.service.ts`
- Test: `packages/core/src/realtime/event-commit.int-spec.ts` (новый файл)

**Interfaces:**
- Consumes: всё из Tasks 1-4: `appendLocked`, `AppRegistryService.getEventDefinition/eventValidatorFor/describeEventErrors`, `EventEmitLimiter.tryAcquire`, `AppConfig.MAX_EVENT_PAYLOAD_BYTES`, realtime-ошибки, `isWithinCeiling` и `Visibility` из SDK.
- Produces: `EventLogService.commitAppEvent(tx: Prisma.TransactionClient, roomId: string, name: string, payload: unknown, visibility: Visibility, actorId?: string | null): Promise<LogEvent>`. `name` — короткое имя из манифеста (`note.posted`); хранимый `type` = `${appId}.${name}`; `schemaVersion` = пиннутый `manifestVersion`.

- [ ] **Step 1: Write the failing int-tests**

Создать `packages/core/src/realtime/event-commit.int-spec.ts`:

```ts
import type { AppManifest } from '@mymozhem/sdk';
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import { readRoomLog } from '../testing/read-room-log';
import { TEST_CONFIG } from '../testing/test-config';
import { AppRegistryService } from '../app-registry/app-registry.service';
import { MembershipService } from '../membership/membership.service';
import { JoinRateLimiter } from '../membership/join-rate-limiter';
import { IdentityService } from '../identity/identity.service';
import { RoomService } from '../room/room.service';
import { EventLogService } from './event-log.service';
import { EventEmitLimiter } from './event-emit-limiter';
import {
  ActorNotMemberError,
  EventEmitRateLimitedError,
  EventPayloadInvalidError,
  EventPayloadTooLargeError,
  EventTypeUnknownError,
  EventVisibilityExceededError,
  RoomNotActiveError,
} from './realtime.errors';

const ORG = '00000000-0000-0000-0000-000000000001';
const P1 = '00000000-0000-0000-0000-0000000000a1';
const P2 = '00000000-0000-0000-0000-0000000000b2';

// Фикстурный манифест (design §7): открытая схема note.posted — нужна для
// payload-нейтральности (Task 7); secret.recorded — потолок module-private.
const TEST_APP: AppManifest = {
  appId: 'test-app',
  manifestVersion: 1,
  contractRange: '^1.0.0',
  appSettings: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: { label: { type: 'string' } },
  },
  events: {
    'note.posted': {
      schema: {
        type: 'object',
        properties: { n: { type: 'number' }, blob: { type: 'string' } },
        required: ['n'],
        additionalProperties: true,
      },
      visibility: 'public',
    },
    'secret.recorded': {
      schema: {
        type: 'object',
        properties: { n: { type: 'number' } },
        required: ['n'],
        additionalProperties: false,
      },
      visibility: 'module-private',
    },
  },
};

describe('EventLogService.commitAppEvent', () => {
  let db: TestDb;
  let rooms: RoomService;
  let eventLog: EventLogService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    await seedIdentity(db.prisma, { id: P1, kind: 'GUEST' });
    await seedIdentity(db.prisma, { id: P2, kind: 'GUEST' });
    const registry = new AppRegistryService([TEST_APP]);
    eventLog = new EventLogService(registry, new EventEmitLimiter(1000), TEST_CONFIG);
    rooms = new RoomService(
      db.prisma,
      eventLog,
      registry,
      new MembershipService(
        db.prisma,
        new IdentityService(db.prisma),
        new JoinRateLimiter(1000),
        TEST_CONFIG,
      ),
      TEST_CONFIG,
    );
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  const ACTIVE_SETTINGS = { label: 'live' };

  async function activeRoom() {
    const room = await rooms.create(ORG);
    await rooms.configure(room.id, {
      appId: 'test-app',
      manifestVersion: 1,
      settings: ACTIVE_SETTINGS,
    });
    return rooms.activate(room.id);
  }

  async function joinParticipant(roomId: string, identityId: string) {
    await db.prisma.membership.create({
      data: { roomId, identityId, role: 'PARTICIPANT' },
    });
  }

  it('commits an app event with contract shape after activation', async () => {
    const room = await activeRoom();
    await joinParticipant(room.id, P1);

    await db.prisma.$transaction((tx) =>
      eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', P1),
    );

    const log = await readRoomLog(db.prisma, room.id);
    expect(log).toHaveLength(2); // seq 1 — core.room.activated (пин)
    expect(log[1]).toMatchObject({
      seq: 2,
      type: 'test-app.note.posted',
      visibility: 'public',
      actorId: P1,
      payload: { n: 1 },
      schemaVersion: 1, // пиннутый manifestVersion
    });
  });

  it('rejects emission into a DRAFT room (ROOM_NOT_ACTIVE), nothing written', async () => {
    const room = await rooms.create(ORG);
    await rooms.configure(room.id, {
      appId: 'test-app',
      manifestVersion: 1,
      settings: ACTIVE_SETTINGS,
    });

    const err = await db.prisma
      .$transaction((tx) =>
        eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', null),
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RoomNotActiveError);
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(0);
  });

  it('seals the log in a terminal status (REQ-RT-016): cancel, then emit rejected', async () => {
    const room = await activeRoom();
    await rooms.cancel(room.id);

    const err = await db.prisma
      .$transaction((tx) =>
        eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', null),
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RoomNotActiveError);
    expect((err as RoomNotActiveError).code).toBe('ROOM_NOT_ACTIVE');
    // seq 1 activated, seq 2 cancelled — попытка эмита ничего не добавила
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(2);
  });

  it('rejects oversized payload (REQ-RT-012)', async () => {
    const room = await activeRoom();
    const big = { n: 1, blob: 'x'.repeat(TEST_CONFIG.MAX_EVENT_PAYLOAD_BYTES) };
    const err = await db.prisma
      .$transaction((tx) =>
        eventLog.commitAppEvent(tx, room.id, 'note.posted', big, 'public', null),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EventPayloadTooLargeError);
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(1);
  });

  it('rejects an unknown event type (REQ-CTR-008)', async () => {
    const room = await activeRoom();
    const err = await db.prisma
      .$transaction((tx) =>
        eventLog.commitAppEvent(tx, room.id, 'note.v2', { n: 1 }, 'public', null),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EventTypeUnknownError);
  });

  it('rejects payload failing the registered schema (REQ-CTR-008)', async () => {
    const room = await activeRoom();
    const err = await db.prisma
      .$transaction((tx) =>
        eventLog.commitAppEvent(tx, room.id, 'note.posted', { blob: 1 }, 'public', null),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EventPayloadInvalidError);
    expect((err as EventPayloadInvalidError).code).toBe('EVENT_PAYLOAD_INVALID');
  });

  it('rejects visibility weaker than the declared ceiling (REQ-CTR-009)', async () => {
    const room = await activeRoom();
    await joinParticipant(room.id, P1);
    const err = await db.prisma
      .$transaction((tx) =>
        eventLog.commitAppEvent(tx, room.id, 'secret.recorded', { n: 1 }, 'organizer', P1),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EventVisibilityExceededError);
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(1);
  });

  it('allows visibility STRONGER than the ceiling (module-private under public)', async () => {
    const room = await activeRoom();
    await db.prisma.$transaction((tx) =>
      eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'module-private', null),
    );
    const log = await readRoomLog(db.prisma, room.id);
    expect(log[1]).toMatchObject({ visibility: 'module-private' });
  });

  it('rejects an actor without membership (ACTOR_NOT_MEMBER)', async () => {
    const room = await activeRoom();
    const err = await db.prisma
      .$transaction((tx) =>
        eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', P2),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ActorNotMemberError);
  });

  it('null actor (server emission): no membership gate, commits', async () => {
    const room = await activeRoom();
    await db.prisma.$transaction((tx) =>
      eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', null),
    );
    const log = await readRoomLog(db.prisma, room.id);
    expect(log[1]).toMatchObject({ actorId: null, seq: 2 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mymozhem/core test:int -t "commitAppEvent"`
Expected: FAIL — `commitAppEvent` не существует (compile/TS error в jest). Фильтр матчит все тесты нового describe (10 штук — проверить по выводу, что не 0).

- [ ] **Step 3: Implement commitAppEvent**

В `packages/core/src/realtime/event-log.service.ts` на место комментария-шва Task 4:

```ts
  // Commit-цепочка app-событий (design §2): ВСЕ проверки до advisory lock —
  // payload-нейтральность гонки за seq контрактуальна (REQ-RT-007). Порядок шагов:
  // status-гейт → rate-limit → размер → реестр → схема → видимость → membership →
  // appendLocked. Дешёвые отказы раньше; запечатанная комната не жжёт лимит (шаг 1
  // до шага 2). actorId = null — серверная эмиссия приложения: membership-гейт и
  // per-actor лимит не применяются (design §0).
  async commitAppEvent(
    tx: Prisma.TransactionClient,
    roomId: string,
    name: string,
    payload: unknown,
    visibility: Visibility,
    actorId: string | null = null,
  ): Promise<LogEvent> {
    // 1. Status-гейт (REQ-RT-016): только ACTIVE с пином; DRAFT/терминальные/
    // удалённые/несуществующие — один код. Пин не-null в ACTIVE по гейту активации
    // (REQ-RT-004); проверка — fail-closed на случай рассогласования.
    const room = await tx.room.findUnique({ where: { id: roomId } });
    if (
      !room ||
      room.deletedAt !== null ||
      room.status !== 'ACTIVE' ||
      room.appId === null ||
      room.manifestVersion === null
    ) {
      throw new RoomNotActiveError(`Room ${roomId} is not ACTIVE (sealed, draft or not found)`);
    }
    const appId = room.appId;
    const manifestVersion = room.manifestVersion;
    // 2. Per-actor rate-limit (REQ-RT-014): считаются попытки, не только успехи.
    if (actorId !== null && !this.emitLimiter.tryAcquire(`${roomId}:${actorId}`)) {
      throw new EventEmitRateLimitedError(
        `Event emission rate limit exceeded for actor ${actorId} in room ${roomId}`,
      );
    }
    // 3. Размер (REQ-RT-012) — до реестра: дешевле и не требует manifest lookup.
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > this.config.MAX_EVENT_PAYLOAD_BYTES) {
      throw new EventPayloadTooLargeError(
        `payload of ${appId}.${name} exceeds MAX_EVENT_PAYLOAD_BYTES (${this.config.MAX_EVENT_PAYLOAD_BYTES})`,
      );
    }
    // 4. Реестр (REQ-CTR-008): тип обязан существовать в пиннутом манифесте.
    const definition = this.appRegistry.getEventDefinition(appId, manifestVersion, name);
    if (!definition) {
      throw new EventTypeUnknownError(`No event type ${name} in manifest ${appId}@${manifestVersion}`);
    }
    // 5. Схема владельца типа (REQ-CTR-008) — verdict-only, без коэрсии (REQ-CORE-007).
    const validate = this.appRegistry.eventValidatorFor(appId, manifestVersion, name, definition.schema);
    if (!validate(payload)) {
      throw new EventPayloadInvalidError(
        `payload of ${appId}.${name} does not match its registered schema: ${this.appRegistry.describeEventErrors(validate)}`,
      );
    }
    // 6. Потолок видимости (REQ-CTR-009): слабее декларированного — отказ, строже — можно.
    if (!isWithinCeiling(visibility, definition.visibility)) {
      throw new EventVisibilityExceededError(
        `visibility ${visibility} exceeds declared ceiling ${definition.visibility} for ${appId}.${name}`,
      );
    }
    // 7. Membership-гейт (design §0): актор — член комнаты.
    if (actorId !== null) {
      const member = await tx.membership.findUnique({
        where: { roomId_identityId: { roomId, identityId: actorId } },
      });
      if (!member) {
        throw new ActorNotMemberError(`Identity ${actorId} is not a member of room ${roomId}`);
      }
    }
    // 8. Append: schemaVersion = пиннутый manifestVersion — версия схемы app-события.
    return this.appendLocked(
      tx,
      roomId,
      `${appId}.${name}`,
      payload,
      actorId,
      visibility,
      manifestVersion,
    );
  }
```

Импорты в файл: `isWithinCeiling`, тип `Visibility` из `@mymozhem/sdk`; классы ошибок из `./realtime.errors`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @mymozhem/core test:int -t "commitAppEvent"` → PASS (10 тестов).
Run: `pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core test:int` → весь suite зелёный. `pnpm lint && pnpm typecheck` → зелёные.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/realtime/event-log.service.ts packages/core/src/realtime/event-commit.int-spec.ts
git commit -m "feat(core): commitAppEvent — commit-цепочка app-событий (REQ-RT-012/016, REQ-CTR-008/009, membership-гейт)"
```

---

