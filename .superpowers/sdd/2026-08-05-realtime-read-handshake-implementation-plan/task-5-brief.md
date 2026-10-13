### Task 5: RealtimeBus + EventOutbox + staging в EventLogService + переход RoomService на runner

Самая широкая задача среза: fail-closed staging атомарен с переходом всех вызывающих на runner (иначе сборка/тесты ломаются между шагами — поэтому одна задача, а не две).

**Files:**
- Create: `packages/core/src/realtime/realtime-bus.ts`
- Create: `packages/core/src/realtime/event-outbox.ts`
- Create: `packages/core/src/realtime/event-outbox.int-spec.ts`
- Modify: `packages/core/src/realtime/event-log.service.ts` (конструктор + stage в appendLocked)
- Modify: `packages/core/src/realtime/realtime.module.ts` (провайдеры, PrismaModule, комментарий)
- Modify: `packages/core/src/room/room.service.ts` (конструктор + transition → outbox.run)
- Modify: `packages/core/src/index.ts` (экспорты)
- Modify (механика конструкторов/транзакций): `packages/core/src/realtime/event-commit.int-spec.ts`, `packages/core/src/realtime/event-log.int-spec.ts`, `packages/core/src/room/room.service.int-spec.ts`, `packages/core/src/membership/membership.service.int-spec.ts`, `packages/core/src/auth/token.service.int-spec.ts`, `apps/server/test/transport.e2e-spec.ts`, `apps/server/scripts/create-room.mjs`

**Interfaces:**
- Consumes: `PrismaService`; существующие сигнатуры `commitCoreEvent`/`commitAppEvent` (НЕ меняются).
- Produces:
  - `RealtimeBus`: `publish(events: readonly LogEvent[]): void`, `subscribe(listener: CommittedEventsListener): void`; `CommittedEventsListener = (events: readonly LogEvent[]) => void`.
  - `EventOutbox`: `run<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>`, `stage(event: LogEvent): void`; ошибки `EventOutboxMissingContextError`, `EventOutboxNestedRunError`.
  - Новые конструкторы: `new EventLogService(appRegistry, emitLimiter, config, outbox)`; `new RoomService(prisma, eventLog, outbox, appRegistry, membership, config)` (outbox — третьим параметром, после eventLog).
  - Экспорты barrel: `RealtimeBus`, `EventOutbox`, обе ошибки, `CommittedEventsListener`.

- [ ] **Step 1: Failing int-test — outbox (доставка, откат, fail-closed, вложенность)**

`packages/core/src/realtime/event-outbox.int-spec.ts`:

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
import { RealtimeBus } from './realtime-bus';
import {
  EventOutbox,
  EventOutboxMissingContextError,
  EventOutboxNestedRunError,
} from './event-outbox';

const ORG = '00000000-0000-0000-0000-000000000001';
const P1 = '00000000-0000-0000-0000-0000000000a1';

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
        properties: { n: { type: 'number' } },
        required: ['n'],
        additionalProperties: true,
      },
      visibility: 'public',
    },
  },
};

describe('EventOutbox', () => {
  let db: TestDb;
  let bus: RealtimeBus;
  let outbox: EventOutbox;
  let eventLog: EventLogService;
  let rooms: RoomService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    await seedIdentity(db.prisma, { id: P1, kind: 'GUEST' });
    const registry = new AppRegistryService([TEST_APP]);
    bus = new RealtimeBus();
    outbox = new EventOutbox(db.prisma, bus);
    eventLog = new EventLogService(registry, new EventEmitLimiter(1000), TEST_CONFIG, outbox);
    rooms = new RoomService(
      db.prisma,
      eventLog,
      outbox,
      registry,
      new MembershipService(db.prisma, new IdentityService(db.prisma), new JoinRateLimiter(1000), TEST_CONFIG),
      TEST_CONFIG,
    );
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  async function activeRoom() {
    const room = await rooms.create(ORG);
    await rooms.configure(room.id, {
      appId: 'test-app',
      manifestVersion: 1,
      settings: { label: 'live' },
    });
    return rooms.activate(room.id);
  }

  it('delivers committed events exactly once, after commit', async () => {
    const room = await activeRoom();
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' } });
    const delivered: string[] = [];
    let publishCalls = 0;
    bus.subscribe((events) => {
      publishCalls += 1;
      delivered.push(...events.map((e) => e.type));
    });

    await outbox.run((tx) => eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', P1));

    expect(delivered).toEqual(['test-app.note.posted']);
    expect(publishCalls).toBe(1);
    expect((await readRoomLog(db.prisma, room.id)).map((e) => e.type)).toEqual([
      'core.room.activated',
      'test-app.note.posted',
    ]);
  });

  it('batches several events of one transaction into a single publish', async () => {
    const room = await activeRoom();
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' } });
    const batches: number[] = [];
    bus.subscribe((events) => batches.push(events.length));

    await outbox.run(async (tx) => {
      await eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', P1);
      await eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 2 }, 'public', P1);
    });

    expect(batches).toEqual([2]);
  });

  it('rollback delivers nothing and writes nothing (REQ-DEV-008)', async () => {
    const room = await activeRoom();
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' } });
    let publishCalls = 0;
    bus.subscribe(() => {
      publishCalls += 1;
    });

    await expect(
      outbox.run(async (tx) => {
        await eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', P1);
        throw new Error('boom after commit');
      }),
    ).rejects.toThrow('boom after commit');

    expect(publishCalls).toBe(0);
    expect((await readRoomLog(db.prisma, room.id)).map((e) => e.type)).toEqual(['core.room.activated']);
  });

  it('fail-closed: commit inside a bare prisma.$transaction throws (no delivery path)', async () => {
    const room = await activeRoom();
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' } });

    await expect(
      db.prisma.$transaction((tx) =>
        eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', P1),
      ),
    ).rejects.toBeInstanceOf(EventOutboxMissingContextError);
  });

  it('nested run is refused', async () => {
    await expect(outbox.run(() => outbox.run(async () => undefined))).rejects.toBeInstanceOf(
      EventOutboxNestedRunError,
    );
  });

  it('RoomService.transition delivers lifecycle events to subscribers (REQ-RT-010)', async () => {
    const delivered: string[] = [];
    bus.subscribe((events) => delivered.push(...events.map((e) => e.type)));

    const room = await rooms.create(ORG);
    await rooms.configure(room.id, { appId: 'test-app', manifestVersion: 1, settings: { label: 'x' } });
    await rooms.activate(room.id);
    await rooms.complete(room.id);

    expect(delivered).toEqual(['core.room.activated', 'core.room.completed']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/core test:int event-outbox`
Expected: FAIL — `./realtime-bus`/`./event-outbox` не существуют (проверить >0 тестов).

- [ ] **Step 3: Implementation — bus + outbox**

`packages/core/src/realtime/realtime-bus.ts`:

```ts
import { EventEmitter } from 'node:events';
import { Injectable } from '@nestjs/common';
import type { LogEvent } from '@prisma/client';

export type CommittedEventsListener = (events: readonly LogEvent[]) => void;

// In-process шина «событие закоммичено» (design §5): легальна при одной реплике
// (REQ-OPS-005); воссоздаваемость не нужна — события durable в логе, шина несёт
// только live-доставку. Состояние — поле экземпляра (REQ-CORE-004).
@Injectable()
export class RealtimeBus {
  private readonly emitter = new EventEmitter();

  publish(events: readonly LogEvent[]): void {
    if (events.length === 0) return;
    this.emitter.emit('committed', events);
  }

  subscribe(listener: CommittedEventsListener): void {
    this.emitter.on('committed', listener);
  }
}
```

`packages/core/src/realtime/event-outbox.ts`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { LogEvent, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeBus } from './realtime-bus';

// Внутренние ошибки механизма (design §5): обе означают баг вызывающего, на провод
// не маппятся (через gateway-фильтр уйдут как INTERNAL_ERROR).
export class EventOutboxMissingContextError extends Error {
  constructor() {
    super('commit*Event called outside EventOutbox.run: a committed event would have no delivery path');
    this.name = new.target.name;
  }
}

export class EventOutboxNestedRunError extends Error {
  constructor() {
    super('EventOutbox.run cannot be nested: Prisma has no nested interactive transactions');
    this.name = new.target.name;
  }
}

// Tx-scoped outbox (design §5, подход A): commit*Event складывает событие в
// ALS-контекст транзакции; run() после УСПЕШНОГО коммита отдаёт буфер в шину; при
// откате буфер умирает вместе с контекстом — откаченное событие недоставимо
// структурно. Контекста нет → fail-closed: «забыл доставить» исключено структурно.
@Injectable()
export class EventOutbox {
  private readonly als = new AsyncLocalStorage<{ events: LogEvent[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: RealtimeBus,
  ) {}

  async run<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (this.als.getStore() !== undefined) {
      throw new EventOutboxNestedRunError();
    }
    const store = { events: [] as LogEvent[] };
    const result = await this.prisma.$transaction((tx) => this.als.run(store, () => fn(tx)));
    // Flush строго после resolves $transaction: до этой строки события видны только
    // буферу — подписчики никогда не наблюдают то, что может откатиться.
    this.bus.publish(store.events);
    return result;
  }

  stage(event: LogEvent): void {
    const store = this.als.getStore();
    if (store === undefined) {
      throw new EventOutboxMissingContextError();
    }
    store.events.push(event);
  }
}
```

- [ ] **Step 4: Staging в EventLogService**

В `packages/core/src/realtime/event-log.service.ts`:
1. Импорт: `import { EventOutbox } from './event-outbox';`
2. Конструктор:

```ts
  constructor(
    private readonly appRegistry: AppRegistryService,
    private readonly emitLimiter: EventEmitLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly outbox: EventOutbox,
  ) {}
```

3. В конце `appendLocked` заменить `return rows[0];` на:

```ts
    // Staging в tx-outbox (design §5): доставка — после коммита, через runner.
    // Вне контекста — fail-closed: событие без пути доставки не коммитится.
    this.outbox.stage(rows[0]);
    return rows[0];
```

4. Комментарий класса дополнить строкой: `// Commit без EventOutbox.run отклоняется (fail-closed staging в appendLocked).`

- [ ] **Step 5: RoomService.transition → outbox.run**

В `packages/core/src/room/room.service.ts`:
1. Импорт: `import { EventOutbox } from '../realtime/event-outbox';`
2. Конструктор — `outbox` третьим параметром:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLog: EventLogService,
    private readonly outbox: EventOutbox,
    private readonly appRegistry: AppRegistryService,
    private readonly membership: MembershipService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
```

3. В `transition` заменить `return this.prisma.$transaction(async (tx) => {` на `return this.outbox.run(async (tx) => {` (тело не меняется; атомарность «переход + лог» сохраняется — runner и есть транзакция).

- [ ] **Step 6: RealtimeModule — провайдеры**

`packages/core/src/realtime/realtime.module.ts` целиком:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AppRegistryModule } from '../app-registry/app-registry.module';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { EventLogService } from './event-log.service';
import { EventEmitLimiter } from './event-emit-limiter';
import { RealtimeBus } from './realtime-bus';
import { EventOutbox } from './event-outbox';

// PrismaModule нужен EventOutbox'у (runner владеет транзакцией); сам примитив
// записи по-прежнему работает на транзакционном клиенте вызывающего — атомарность
// «действие + лог» (REQ-DEV-008) не меняется.
@Module({
  imports: [ConfigModule, AppRegistryModule, PrismaModule],
  providers: [
    {
      provide: EventEmitLimiter,
      useFactory: (config: AppConfig) => new EventEmitLimiter(config.EVENT_EMIT_RATE_LIMIT_PER_MIN),
      inject: [APP_CONFIG],
    },
    RealtimeBus,
    EventOutbox,
    EventLogService,
  ],
  exports: [EventLogService, EventOutbox],
})
export class RealtimeModule {}
```

- [ ] **Step 7: Barrel**

В `packages/core/src/index.ts` после строки `export * from './realtime/realtime.module';` добавить:

```ts
export * from './realtime/realtime-bus';
export * from './realtime/event-outbox';
```

- [ ] **Step 8: Механическая правка конструкций и транзакций (рецепт для каждого файла)**

Рецепт A (файл конструирует `EventLogService`): добавить `RealtimeBus` + `EventOutbox` и 4-й аргумент:

```ts
const bus = new RealtimeBus();
const outbox = new EventOutbox(db.prisma, bus);
const eventLog = new EventLogService(registry, new EventEmitLimiter(1000), TEST_CONFIG, outbox);
```

Рецепт B (файл конструирует `RoomService`): `outbox` третьим аргументом:

```ts
new RoomService(db.prisma, eventLog, outbox, registry, membership, TEST_CONFIG)
```

(порядок остальных аргументов как был; в `transport.e2e-spec.ts` registry создаётся дважды — сохранить существующую структуру, только добавить bus/outbox).

Рецепт C (вызов коммита в ручной транзакции): `db.prisma.$transaction((tx) => eventLog.commit…(tx, …))` → `outbox.run((tx) => eventLog.commit…(tx, …))`.

Файлы и что в них:
- `packages/core/src/realtime/event-commit.int-spec.ts` — A + B + C (все `db.prisma.$transaction` с commitAppEvent/commitCoreEvent, включая конкурентные тесты; переменную `outbox` поднять в `beforeAll`).
- `packages/core/src/realtime/event-log.int-spec.ts` — A + B + C.
- `packages/core/src/room/room.service.int-spec.ts` — A + B (коммиты — внутри transition, теперь сам на runner).
- `packages/core/src/membership/membership.service.int-spec.ts` — A + B (если конструирует RoomService/EventLogService; иначе пропустить).
- `packages/core/src/auth/token.service.int-spec.ts` — A + B (если конструирует; иначе пропустить).
- `apps/server/test/transport.e2e-spec.ts` — A + B (два `new AppRegistryService([])` — оба остаются).
- `apps/server/scripts/create-room.mjs` — B-эквивалент: добавить конструкцию `RealtimeBus`/`EventOutbox` из dist-subpath (существующая конвенция workaround'а) и аргументы; если скрипт вызывает `activate`/`complete`/`cancel` — проверить, что это методы RoomService (runner внутри, правка вызовов не нужна).

- [ ] **Step 9: Build + все затронутые тесты**

Run: `pnpm build`
Run: `pnpm --filter @mymozhem/core test:int`
Expected: PASS всех int-спек (включая новую event-outbox и переписанные event-commit/event-log/room/membership/token).
Run: `pnpm --filter @mymozhem/server test`
Expected: PASS transport e2e.
Run: `pnpm --filter @mymozhem/core test`
Expected: PASS unit.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src apps/server/test/transport.e2e-spec.ts apps/server/scripts/create-room.mjs
git commit -m "feat(core): EventOutbox (ALS, fail-closed) + RealtimeBus; RoomService.transition на runner (design §5, подход A)"
```

---

