### Task 3: RoomService.configure — write path тройки (REQ-RT-004)

**Files:**
- Modify: `packages/core/src/room/room.errors.ts`
- Modify: `packages/core/src/room/room.service.ts`
- Modify: `packages/core/src/room/room.module.ts`
- Test: `packages/core/src/room/room.service.int-spec.ts` (хелперы + новый describe + обновление конструкторов)

**Interfaces:**
- Consumes: `AppRegistryService.validateSettings` (Task 2); поля `appId/manifestVersion/appSettings` на Room (Task 1).
- Produces: `RoomService.configure(roomId: string, config: { appId: string; manifestVersion: number; settings: unknown }): Promise<Room>`; ошибки `RoomNotConfiguredError` (код `ROOM_NOT_CONFIGURED`) и `RoomSettingsFrozenError` (код `ROOM_SETTINGS_FROZEN`) — Task 4 использует обе (первую) и тесты (вторую). Конструктор `RoomService(prisma, eventLog, appRegistry)`.

- [ ] **Step 1: Расширить room.errors.ts**

Добавить коды в `ROOM_ERROR_CODES` и два класса:

```ts
export const ROOM_ERROR_CODES = {
  ROOM_TRANSITION_INVALID: 'ROOM_TRANSITION_INVALID',
  ROOM_CONFLICT: 'ROOM_CONFLICT',
  ROOM_ORGANIZER_NOT_REGISTERED: 'ROOM_ORGANIZER_NOT_REGISTERED',
  ROOM_NOT_CONFIGURED: 'ROOM_NOT_CONFIGURED',
  // Строковый паритет с зарезервированным кодом SDK-контракта (CONTRACT_ERROR_CODES,
  // design §6): будущий транспорт отобразит code→code 1:1. SDK не меняется.
  ROOM_SETTINGS_FROZEN: 'ROOM_SETTINGS_FROZEN',
} as const;
```

```ts
// Активация требует сконфигурированной комнаты (REQ-RT-004): payload room.activated —
// пин (appId, manifestVersion), у неконфигурированной комнаты ему неоткуда взяться.
export class RoomNotConfiguredError extends RoomError {
  constructor(message: string) {
    super(ROOM_ERROR_CODES.ROOM_NOT_CONFIGURED, message);
  }
}

// Запись конфигурации закрыта: комната не DRAFT (заморозка REQ-RT-004), удалена или
// отсутствует. Причины свёрнуты в один код намеренно (design §6) — вызывающему единый
// отказ; точность — в server-side message.
export class RoomSettingsFrozenError extends RoomError {
  constructor(message: string) {
    super(ROOM_ERROR_CODES.ROOM_SETTINGS_FROZEN, message);
  }
}
```

- [ ] **Step 2: Подготовить хелперы и обновить конструкторы в int-spec**

В `packages/core/src/room/room.service.int-spec.ts`:

а) добавить импорты:

```ts
import { validManifests } from '@mymozhem/sdk';
import { AppRegistryService } from '../app-registry/app-registry.service';
import { AppManifestUnknownError, AppSettingsInvalidError } from '../app-registry/app-registry.errors';
import {
  RoomError,
  RoomTransitionError,
  RoomConflictError,
  RoomOrganizerNotRegisteredError,
  RoomSettingsFrozenError,
} from './room.errors';
```

(заменив существующий импорт room.errors)

б) после `const ORG = ...` добавить:

```ts
// quiz@1 из SDK-фикстур: appSettings требует { title: string, correctAnswers: number[] }.
const QUIZ_SETTINGS = { title: 'Friday quiz', correctAnswers: [0, 2] };

const makeService = (db: TestDb) =>
  new RoomService(db.prisma, new EventLogService(), new AppRegistryService([validManifests[0]]));

const configureQuiz = (service: RoomService, roomId: string) =>
  service.configure(roomId, { appId: 'quiz', manifestVersion: 1, settings: QUIZ_SETTINGS });
```

в) заменить ВСЕ вхождения `new RoomService(db.prisma, new EventLogService())` на `makeService(db)` (5 мест — в describe'ах lifecycle, transition atomicity, CHECK soft-delete, lifecycle log emit, config triple из Task 1; describe organizerId FK сервиса не имеет).

- [ ] **Step 3: Написать failing-тесты configure**

Добавить в конец int-spec:

```ts
describe('RoomService.configure (REQ-RT-004)', () => {
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

  it('persists the full config triple on a DRAFT room', async () => {
    const room = await service.create(ORG);
    const configured = await configureQuiz(service, room.id);
    expect(configured.appId).toBe('quiz');
    expect(configured.manifestVersion).toBe(1);
    expect(configured.appSettings).toEqual(QUIZ_SETTINGS);
  });

  it('replaces the whole triple on re-configure', async () => {
    const room = await service.create(ORG);
    await configureQuiz(service, room.id);
    const next = { title: 'Other quiz', correctAnswers: [1] };
    const reconfigured = await service.configure(room.id, {
      appId: 'quiz',
      manifestVersion: 1,
      settings: next,
    });
    expect(reconfigured.appSettings).toEqual(next);
  });

  it('rejects invalid settings with APP_SETTINGS_INVALID and leaves the row unchanged', async () => {
    const room = await service.create(ORG);
    const err = await service
      .configure(room.id, { appId: 'quiz', manifestVersion: 1, settings: { title: 'x' } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppSettingsInvalidError);
    expect((err as AppSettingsInvalidError).code).toBe('APP_SETTINGS_INVALID');
    const reread = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(reread.appId).toBeNull();
    expect(reread.appSettings).toBeNull();
  });

  it('rejects an unknown manifest with APP_MANIFEST_UNKNOWN', async () => {
    const room = await service.create(ORG);
    const err = await service
      .configure(room.id, { appId: 'quiz', manifestVersion: 99, settings: QUIZ_SETTINGS })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppManifestUnknownError);
    expect((err as AppManifestUnknownError).code).toBe('APP_MANIFEST_UNKNOWN');
  });

  it.each([
    {
      name: 'ACTIVE',
      setup: async (s: RoomService, id: string) => {
        await configureQuiz(s, id);
        await s.activate(id);
      },
    },
    { name: 'CANCELLED', setup: async (s: RoomService, id: string) => { await s.cancel(id); } },
    { name: 'soft-deleted', setup: async (s: RoomService, id: string) => { await s.softDelete(id); } },
  ])('rejects configure on a $name room with ROOM_SETTINGS_FROZEN', async ({ setup }) => {
    const room = await service.create(ORG);
    await setup(service, room.id);
    const err = await configureQuiz(service, room.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoomSettingsFrozenError);
    expect((err as RoomSettingsFrozenError).code).toBe('ROOM_SETTINGS_FROZEN');
  });

  it('rejects configure of a missing room with the same collapsed code', async () => {
    await expect(
      service.configure('00000000-0000-0000-0000-0000000000ff', {
        appId: 'quiz',
        manifestVersion: 1,
        settings: QUIZ_SETTINGS,
      }),
    ).rejects.toBeInstanceOf(RoomSettingsFrozenError);
  });
});
```

- [ ] **Step 4: Прогнать — подтвердить RED**

Run: `pnpm --filter @mymozhem/core test:int -- -t "configure"`
Expected: FAIL компиляции/рантайма — `service.configure is not a function`.

- [ ] **Step 5: Реализовать configure в RoomService**

В `packages/core/src/room/room.service.ts`:

а) импорты — добавить `Prisma` к существующему импорту типов и новые:

```ts
import type { Room, $Enums, Prisma } from '@prisma/client';
import type { CoreEventName } from '@mymozhem/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { EventLogService } from '../realtime/event-log.service';
import { AppRegistryService } from '../app-registry/app-registry.service';
import {
  RoomConflictError,
  RoomOrganizerNotRegisteredError,
  RoomSettingsFrozenError,
} from './room.errors';
```

б) конструктор:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLog: EventLogService,
    private readonly appRegistry: AppRegistryService,
  ) {}
```

в) метод (между `create` и `transition`):

```ts
  // REQ-RT-004 write path: атомарная замена всей тройки (appId, manifestVersion,
  // appSettings) — промежуточного состояния не существует (design §4). Валидация ДО
  // обращения к БД (REQ-CORE-007); запись — guarded UPDATE: только DRAFT и не
  // удалённая. Заморозка активной комнаты — этот предикат, не флаг.
  async configure(
    roomId: string,
    config: { appId: string; manifestVersion: number; settings: unknown },
  ): Promise<Room> {
    this.appRegistry.validateSettings(config.appId, config.manifestVersion, config.settings);
    const res = await this.prisma.room.updateMany({
      where: { id: roomId, status: 'DRAFT', deletedAt: null },
      data: {
        appId: config.appId,
        manifestVersion: config.manifestVersion,
        // JSON Schema-валидированное значение — JSON; unknown → InputJsonValue безопасно.
        appSettings: config.settings as Prisma.InputJsonValue,
      },
    });
    if (res.count === 0) {
      // Re-read только для точности server-side message; код один (design §6).
      const existing = await this.prisma.room.findUnique({ where: { id: roomId } });
      const reason = !existing
        ? 'not found'
        : existing.deletedAt !== null
          ? 'deleted'
          : `status ${existing.status}`;
      throw new RoomSettingsFrozenError(`Room ${roomId} is not configurable: ${reason}`);
    }
    return this.prisma.room.findUniqueOrThrow({ where: { id: roomId } });
  }
```

г) `room.module.ts` — импорт AppRegistryModule:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AppRegistryModule } from '../app-registry/app-registry.module';
import { RoomService } from './room.service';

@Module({
  imports: [PrismaModule, RealtimeModule, AppRegistryModule],
  providers: [RoomService],
  exports: [RoomService],
})
export class RoomModule {}
```

- [ ] **Step 6: Прогнать — GREEN + гейты задачи**

Run: `pnpm --filter @mymozhem/core test:int -- -t "configure" && pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core lint && pnpm --filter @mymozhem/core typecheck`
Expected: configure-тесты PASS (8: 5 одиночных + 3 it.each); unit PASS; lint/typecheck чисто. Остальные int-тесты пока запускать не нужно — Task 4 меняет активацию.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/room packages/core/src/room/room.service.int-spec.ts
git commit -m "feat(core): RoomService.configure write path (REQ-RT-004)"
```

---

