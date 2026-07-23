# appSettings write path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Построить write path конфигурации комнаты: колонки `(appId, manifestVersion, appSettings)` на Room, валидацию настроек по JSON Schema манифеста (ajv + кэш, REQ-CORE-007), атомарный `configure` только в DRAFT, заморозку при активации с эмитом `core.room.activated` (REQ-RT-004, REQ-RT-010 3/3).

**Architecture:** Три nullable-колонки + рукописный CHECK «тройка атомарна» на `room."Room"` (миграция). Валидация живёт в `AppRegistryService.validateSettings` (Ajv2020, ленивый кэш скомпилированных валидаторов по ключу `appId@version`). `RoomService.configure` — guarded UPDATE с предикатом DRAFT. `RoomService.transition` в ветке ACTIVE: guarded UPDATE (row-lock, точка сериализации с configure) → re-read → предусловие + перевалидация → эмит пина — всё одной транзакцией (fail-closed, REQ-DEV-008).

**Tech Stack:** NestJS 11, Prisma 7.8 (adapter-pg), PostgreSQL 17, ajv 8 (draft 2020-12), zod 4 (SDK), jest + ts-jest, @testcontainers/postgresql.

**Дизайн (источник истины по решениям):** `docs/sessions/2026-07-23-appsettings-write-path-design.md` — 5 решений владельца в §0, порядок активации с post-lock re-read в §5, таблица ошибок в §6, швы в §9.

**Закрываемые требования (для spec-compliance ревью):** headline **REQ-RT-004**; **REQ-RT-010** (доводит до 3/3); **REQ-CORE-007**; сопутствующе REQ-DEV-008, REQ-CORE-003, REQ-CORE-004, REQ-CTR-005.

## Global Constraints

- **Prisma 7.8 закреплена; preview-фичи запрещены.** CHECK-констрейнт — рукописная часть миграции (практика REQ-DEV-006, прецедент partial-индекса identity и CHECK `Room_softdelete_not_active`). Миграции создаются `prisma migrate dev` с эфемерного authoring-контейнера; после слияния в main миграция **заморожена**.
- **Хост-порт 5432 занят чужим контейнером `lt-pg` — НЕ трогать.** Authoring-контейнер `mm-migrate` публиковать на порт **55432**, после авторинга удалить (`docker rm -f mm-migrate`).
- **`pnpm exec prisma generate` требует `DATABASE_URL` и cwd = корень репозитория** (обнаружение `prisma.config.ts`); `migrate dev` не всегда регенерирует клиент — generate запускать явно.
- **Интеграционная лана поднимает Testcontainers Postgres** (по контейнеру на describe с `startTestDb`, `maxWorkers: 1`) — Docker Desktop должен быть запущен. `postgres.testcontainer.ts` мутирует `process.env.DATABASE_URL`, это известный и принятый паттерн.
- **ajv — только в `packages/core`** (SDK остаётся чистым zod). Импорт draft 2020-12: `import Ajv2020 from 'ajv/dist/2020'` — манифестные схемы несут `$schema: draft 2020-12`, дефолтный Ajv (draft-07) на них упадёт.
- **TDD:** тест первым, RED подтверждается прогоном, затем реализация. Коммиты с REQ-тегами в сообщении, стиль как в git log (`feat(core): … (REQ-XXX-NNN)`).
- **`actorId` остаётся `null`** у lifecycle-событий (шов плана с auth); HTTP-поверхность не строится (шов); SDK не изменяется.
- **Конвенция порядка блокировок:** advisory lock комнаты — всегда leaf-most; транзакция, захватившая его, после этого `room."Room"` не пишет (эмит — последним шагом).

---

### Task 1: Миграция — колонки конфигурации + CHECK тройки на room."Room"

**Files:**
- Modify: `packages/core/prisma/schema.prisma` (модель Room, строки с комментарием «appSettings/pin/freeze deferred»)
- Create: `packages/core/prisma/migrations/<timestamp>_room_app_config/migration.sql` (генерируется, затем редактируется вручную)
- Test: `packages/core/src/room/room.service.int-spec.ts` (новый describe в конце файла)

**Interfaces:**
- Consumes: существующие `startTestDb`, `seedIdentity`, `RoomService.create`.
- Produces: поля `appId: string | null`, `manifestVersion: number | null`, `appSettings: Prisma.JsonValue` на Prisma-модели `Room`; CHECK-констрейнт `"Room_config_triple"` — на них опираются Tasks 3–4.

- [ ] **Step 1: Написать failing-тесты CHECK-инварианта**

Добавить в конец `packages/core/src/room/room.service.int-spec.ts`:

```ts
describe('Room config triple CHECK constraint (REQ-RT-004)', () => {
  let db: TestDb;
  let service: RoomService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    service = new RoomService(db.prisma, new EventLogService());
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  it('accepts an all-NULL triple and a fully-set triple', async () => {
    const room = await service.create(ORG); // тройка NULL
    await db.prisma.$executeRawUnsafe(
      `UPDATE room."Room"
       SET "appId" = 'quiz', "manifestVersion" = 1, "appSettings" = '{}'::jsonb
       WHERE id = $1`,
      room.id,
    );
    const reread = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(reread.appId).toBe('quiz');
    expect(reread.manifestVersion).toBe(1);
  });

  // Инвариант тройки (design §2): либо все NULL, либо все заданы. Сервис такую запись
  // не производит никогда (единственный путь — configure, Task 3), поэтому проверяем
  // сырым SQL, что инвариант держит сама БД (философия REQ-RWD-010).
  it.each([
    { set: `"appId" = 'quiz'`, label: 'appId without the rest' },
    { set: `"appId" = 'quiz', "manifestVersion" = 1`, label: 'pin without appSettings' },
    { set: `"appSettings" = '{}'::jsonb`, label: 'appSettings without the pin' },
  ])('rejects a partial triple at the database level ($label)', async ({ set }) => {
    const room = await service.create(ORG);
    await expect(
      db.prisma.$executeRawUnsafe(`UPDATE room."Room" SET ${set} WHERE id = $1`, room.id),
    ).rejects.toThrow(/Room_config_triple/);
  });
});
```

- [ ] **Step 2: Прогнать тесты — подтвердить RED**

Run: `pnpm --filter @mymozhem/core test:int -- -t "config triple"`
Expected: FAIL — `column "appId" does not exist` (колонок ещё нет).

- [ ] **Step 3: Обновить schema.prisma**

В `packages/core/prisma/schema.prisma` заменить комментарий и модель Room:

```prisma
// Room — core CRUD lifecycle entity (ADR-005: not event-sourced). State machine
// in room-state-machine.ts (REQ-RT-005). organizerId is a declarative FK to
// identity.id; the REGISTERED invariant (REQ-ID-005) is enforced by the guarded
// INSERT in RoomService.create, not by the FK itself.
// Конфигурация приложения (REQ-RT-004): тройка (appId, manifestVersion, appSettings)
// атомарна — либо все NULL, либо все заданы (CHECK "Room_config_triple", рукописная
// часть миграции room_app_config). Единственный путь записи — RoomService.configure;
// заморозка — предикат status = 'DRAFT' в его guarded UPDATE, не флаг.
model Room {
  id              String     @id @default(uuid()) @db.Uuid
  organizer       Identity   @relation(fields: [organizerId], references: [id])
  organizerId     String     @db.Uuid
  status          RoomStatus @default(DRAFT)
  appId           String?
  manifestVersion Int?
  appSettings     Json?
  deletedAt       DateTime?
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt
  logEvents       LogEvent[]

  @@schema("room")
}
```

- [ ] **Step 4: Сгенерировать миграцию (--create-only) с authoring-контейнера**

Run (cwd = корень репозитория):

```bash
docker run -d --name mm-migrate -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17
until docker exec mm-migrate pg_isready -U postgres | grep -q "accepting connections"; do sleep 1; done
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/postgres pnpm exec prisma migrate dev --name room_app_config --create-only
```

Expected: создана `packages/core/prisma/migrations/<timestamp>_room_app_config/migration.sql` с тремя `ADD COLUMN`. Миграция НЕ применена.

- [ ] **Step 5: Дописать CHECK вручную и применить**

Дописать в конец сгенерированного `migration.sql`:

```sql
-- Рукописная часть (практика REQ-DEV-006): тройка конфигурации атомарна —
-- либо все NULL, либо все NOT NULL (design §2). Единственный сервисный путь записи
-- заменяет тройку целиком; CHECK — страховка от обхода сервиса.
ALTER TABLE room."Room" ADD CONSTRAINT "Room_config_triple"
CHECK (
  ("appId" IS NULL) = ("manifestVersion" IS NULL)
  AND ("appId" IS NULL) = ("appSettings" IS NULL)
);
```

Применить и сгенерировать клиент (cwd = корень):

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/postgres pnpm exec prisma migrate dev
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/postgres pnpm exec prisma generate
docker rm -f mm-migrate
```

Expected: миграция применена чисто (`Applying migration ... room_app_config`), клиент сгенерирован. Проверка клиента: `pnpm --filter @mymozhem/core typecheck` после Step 1 увидит `reread.appId` без ошибок.

- [ ] **Step 6: Прогнать тесты — GREEN**

Run: `pnpm --filter @mymozhem/core test:int -- -t "config triple"`
Expected: PASS (2 теста: принятие NULL/полной тройки + 3 кейса it.each отказов).

- [ ] **Step 7: Commit**

```bash
git add packages/core/prisma packages/core/src/room/room.service.int-spec.ts
git commit -m "feat(core): room app config columns + triple CHECK migration (REQ-RT-004)"
```

---

### Task 2: Валидация настроек в AppRegistryService (ajv + кэш, REQ-CORE-007)

**Files:**
- Modify: `packages/core/package.json` (зависимость ajv — через pnpm add)
- Create: `packages/core/src/app-registry/app-registry.errors.ts`
- Modify: `packages/core/src/app-registry/app-registry.service.ts`
- Test: `packages/core/src/app-registry/app-registry.service.spec.ts` (новый describe)

**Interfaces:**
- Consumes: `validManifests` из `@mymozhem/sdk` (quiz@1: appSettings требует `{ title: string, correctAnswers: number[] }`, `additionalProperties: false`).
- Produces: `AppRegistryService.validateSettings(appId: string, manifestVersion: number, settings: unknown): void`; классы `AppRegistryError`, `AppManifestUnknownError`, `AppSettingsInvalidError` с кодами `APP_MANIFEST_UNKNOWN` / `APP_SETTINGS_INVALID` — их используют Tasks 3–4.

- [ ] **Step 1: Установить ajv**

Run: `pnpm --filter @mymozhem/core add ajv@^8.17.1`
Expected: в `packages/core/package.json` появился ajv; lockfile обновлён (один lockfile на монорепо, REQ-DEV-002).

- [ ] **Step 2: Написать failing unit-тесты**

Добавить в `packages/core/src/app-registry/app-registry.service.spec.ts` импорты и describe:

```ts
import Ajv2020 from 'ajv/dist/2020';
import { AppManifestUnknownError, AppSettingsInvalidError } from './app-registry.errors';

// Синхронный catch-helper: validateSettings бросает, не возвращает промис.
const capture = (fn: () => void): unknown => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
};

describe('AppRegistryService.validateSettings (REQ-CORE-007)', () => {
  const manifest = validManifests[0]; // quiz@1: { title: string, correctAnswers: number[] }, additionalProperties: false

  it('accepts settings that satisfy the manifest schema', () => {
    const svc = new AppRegistryService([manifest]);
    expect(() =>
      svc.validateSettings('quiz', 1, { title: 'Friday quiz', correctAnswers: [0, 2] }),
    ).not.toThrow();
  });

  it.each([
    { name: 'missing required property', value: { title: 'Friday quiz' } },
    { name: 'wrong property type', value: { title: 'Friday quiz', correctAnswers: 'nope' } },
    { name: 'additional property', value: { title: 'Friday quiz', correctAnswers: [0], hack: true } },
  ])('rejects invalid settings with APP_SETTINGS_INVALID ($name)', ({ value }) => {
    const svc = new AppRegistryService([manifest]);
    const err = capture(() => svc.validateSettings('quiz', 1, value));
    expect(err).toBeInstanceOf(AppSettingsInvalidError);
    expect((err as AppSettingsInvalidError).code).toBe('APP_SETTINGS_INVALID');
  });

  it.each([
    { name: 'unknown appId', appId: 'nope', version: 1 },
    { name: 'unknown manifestVersion', appId: 'quiz', version: 99 },
  ])('rejects an unknown manifest with APP_MANIFEST_UNKNOWN ($name)', ({ appId, version }) => {
    const svc = new AppRegistryService([manifest]);
    const err = capture(() =>
      svc.validateSettings(appId, version, { title: 't', correctAnswers: [] }),
    );
    expect(err).toBeInstanceOf(AppManifestUnknownError);
    expect((err as AppManifestUnknownError).code).toBe('APP_MANIFEST_UNKNOWN');
  });

  it('compiles the validator once per (appId, manifestVersion) key', () => {
    const spy = jest.spyOn(Ajv2020.prototype, 'compile');
    try {
      const svc = new AppRegistryService([manifest]);
      svc.validateSettings('quiz', 1, { title: 'a', correctAnswers: [] });
      svc.validateSettings('quiz', 1, { title: 'b', correctAnswers: [1] });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
```

- [ ] **Step 3: Прогнать — подтвердить RED**

Run: `pnpm --filter @mymozhem/core test -- app-registry.service`
Expected: FAIL компиляции — `validateSettings does not exist` / `app-registry.errors` не найден.

- [ ] **Step 4: Создать app-registry.errors.ts**

```ts
// Core-internal typed errors of the app-registry module: validation of appSettings
// against the manifest's JSON Schema (REQ-CORE-007). NOT part of the SDK contract —
// when a transport lands, these map to typed API responses without stack traces
// (REQ-SEC-006), same convention as room.errors.ts.
export const APP_REGISTRY_ERROR_CODES = {
  APP_MANIFEST_UNKNOWN: 'APP_MANIFEST_UNKNOWN',
  APP_SETTINGS_INVALID: 'APP_SETTINGS_INVALID',
} as const;

export type AppRegistryErrorCode =
  (typeof APP_REGISTRY_ERROR_CODES)[keyof typeof APP_REGISTRY_ERROR_CODES];

export class AppRegistryError extends Error {
  constructor(
    readonly code: AppRegistryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

// No manifest registered under (appId, manifestVersion): unknown app, or a version a
// redeploy removed from the compiled-in registry (boot-time registry vs durable room
// row, design §5).
export class AppManifestUnknownError extends AppRegistryError {
  constructor(message: string) {
    super(APP_REGISTRY_ERROR_CODES.APP_MANIFEST_UNKNOWN, message);
  }
}

// Settings do not satisfy the manifest's JSON Schema. ajv detail stays in the
// server-side message only; outward goes the code (REQ-SEC-006).
export class AppSettingsInvalidError extends AppRegistryError {
  constructor(message: string) {
    super(APP_REGISTRY_ERROR_CODES.APP_SETTINGS_INVALID, message);
  }
}
```

- [ ] **Step 5: Реализовать validateSettings в AppRegistryService**

Полностью заменить `packages/core/src/app-registry/app-registry.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import Ajv2020 from 'ajv/dist/2020';
import type { ValidateFunction } from 'ajv';
import type { AppManifest, JsonSchemaObject } from '@mymozhem/sdk';
import { buildAppRegistry, type AppRegistry } from './app-registry';
import { APP_MANIFESTS } from './app-registry.tokens';
import { AppManifestUnknownError, AppSettingsInvalidError } from './app-registry.errors';

@Injectable()
export class AppRegistryService {
  private readonly registry: AppRegistry;
  // REQ-CORE-007: скомпилированные валидаторы кэшируются по (appId, manifestVersion).
  // Лениво — компиляция при первом обращении; далее запись неизменяема (дух
  // REQ-CORE-004, как сам boot-time реестр). Eager-прогрев всех манифестов на буте
  // отклонён: платили бы за неиспользуемое (design §3).
  private readonly validators = new Map<string, ValidateFunction>();
  // Ajv2020: манифестные схемы несут $schema draft 2020-12 — дефолтный Ajv (draft-07)
  // на них падает. strict: false — схемы несут аннотацию x-visibility (ADR-008),
  // неизвестный ajv keyword, который strict-режим отклонил бы.
  private readonly ajv = new Ajv2020({ allErrors: true, strict: false });

  constructor(@Inject(APP_MANIFESTS) manifests: readonly unknown[]) {
    // Built once at construction (boot); immutable thereafter (REQ-CORE-004). A bad
    // manifest throws here and fails startup — fail-closed.
    this.registry = buildAppRegistry(manifests);
  }

  getManifest(appId: string, manifestVersion: number): AppManifest | undefined {
    return this.registry.getManifest(appId, manifestVersion);
  }

  // REQ-CORE-007: валидация настроек по JSON Schema манифеста — при каждой записи
  // (RoomService.configure) и повторно при DRAFT → ACTIVE (RoomService.transition).
  // Verdict-only: никакой коэрсии и мутации входа (ajv без coerce/removeAdditional).
  validateSettings(appId: string, manifestVersion: number, settings: unknown): void {
    const manifest = this.registry.getManifest(appId, manifestVersion);
    if (!manifest) {
      throw new AppManifestUnknownError(
        `No manifest registered for ${appId}@${manifestVersion}`,
      );
    }
    const validate = this.validatorFor(appId, manifestVersion, manifest.appSettings);
    if (!validate(settings)) {
      throw new AppSettingsInvalidError(
        `appSettings do not match the manifest schema of ${appId}@${manifestVersion}: ${this.ajv.errorsText(validate.errors)}`,
      );
    }
  }

  private validatorFor(
    appId: string,
    manifestVersion: number,
    schema: JsonSchemaObject,
  ): ValidateFunction {
    const key = `${appId}@${manifestVersion}`;
    const cached = this.validators.get(key);
    if (cached) {
      return cached;
    }
    const compiled = this.ajv.compile(schema);
    this.validators.set(key, compiled);
    return compiled;
  }
}
```

- [ ] **Step 6: Прогнать — GREEN + гейты задачи**

Run: `pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core lint && pnpm --filter @mymozhem/core typecheck`
Expected: unit PASS (старые 3 + новые 7 в этом файле, остальные без изменений), lint/typecheck чисто.

- [ ] **Step 7: Commit**

```bash
git add packages/core/package.json packages/core/src/app-registry pnpm-lock.yaml
git commit -m "feat(core): AppRegistryService.validateSettings with ajv cache (REQ-CORE-007)"
```

---

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

### Task 4: Активация — предусловие, перевалидация, эмит room.activated (REQ-RT-004, REQ-RT-010)

**Files:**
- Modify: `packages/core/src/room/room.service.ts` (transition + комментарий LIFECYCLE_EVENTS)
- Test: `packages/core/src/room/room.service.int-spec.ts` (обновление существующих тестов + новый describe)

**Interfaces:**
- Consumes: `RoomService.configure` и `RoomSettingsFrozenError` (Task 3), `RoomNotConfiguredError` (Task 3, room.errors), `validateSettings` (Task 2).
- Produces: активация эмитит `core.room.activated` с payload `{ appId, manifestVersion }` (словарь `CORE_EVENTS` SDK — без изменений); регрессионный якорь лога — две строки.

- [ ] **Step 1: Обновить существующие тесты под новый контракт активации (RED)**

Все места, где тест вызывает `activate`, теперь обязаны сначала сконфигурировать комнату — активация неконфигурированной отклоняется.

а) `describe('RoomService lifecycle')`, тест `'persists each legal transition'` — вставить configure перед каждым activate:

```ts
  it('persists each legal transition', async () => {
    const a = await service.create(ORG);
    await configureQuiz(service, a.id);
    expect((await service.activate(a.id)).status).toBe('ACTIVE');
    expect((await service.complete(a.id)).status).toBe('COMPLETED');

    const b = await service.create(ORG);
    expect((await service.cancel(b.id)).status).toBe('CANCELLED');

    const c = await service.create(ORG);
    await configureQuiz(service, c.id);
    await service.activate(c.id);
    expect((await service.cancel(c.id)).status).toBe('CANCELLED');
  });
```

б) Тот же describe, `'soft-deletes in DRAFT/COMPLETED/CANCELLED, refuses in ACTIVE'` — перед `service.activate(active.id)` вставить `await configureQuiz(service, active.id);`.

в) `describe('Room CHECK constraint…')`, тест `'rejects an UPDATE that sets deletedAt on an ACTIVE room…'` — перед `service.activate(room.id)` вставить `await configureQuiz(service, room.id);`.

г) `describe('RoomService lifecycle log emit (REQ-RT-010)')` — заменить три теста:

```ts
  it('full path DRAFT→ACTIVE→COMPLETED emits room.activated (pin) then room.completed', async () => {
    const room = await service.create(ORG);
    await configureQuiz(service, room.id);
    await service.activate(room.id);
    await service.complete(room.id);

    // REQ-RT-010 3/3: обе строки public; activated несёт пин замороженной тройки
    // (REQ-RT-004). Регрессионный якорь среза lifecycle-эмита обновлён: 1 строка → 2.
    const log = await readRoomLog(db.prisma, room.id);
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({
      seq: 1,
      type: 'core.room.activated',
      visibility: 'public',
      actorId: null,
      payload: { appId: 'quiz', manifestVersion: 1 },
      schemaVersion: 1,
    });
    expect(log[1]).toMatchObject({
      seq: 2,
      type: 'core.room.completed',
      visibility: 'public',
      actorId: null,
      payload: {},
      schemaVersion: 1,
    });
  });

  it('cancel() from DRAFT and from ACTIVE emits core.room.cancelled', async () => {
    const a = await service.create(ORG);
    await service.cancel(a.id);
    const b = await service.create(ORG);
    await configureQuiz(service, b.id);
    await service.activate(b.id);
    await service.cancel(b.id);

    expect((await readRoomLog(db.prisma, a.id)).map((e) => e.type)).toEqual(['core.room.cancelled']);
    expect((await readRoomLog(db.prisma, b.id)).map((e) => [e.seq, e.type])).toEqual([
      [1, 'core.room.activated'],
      [2, 'core.room.cancelled'],
    ]);
  });

  it('emits nothing on illegal transition, terminal transition, create or softDelete', async () => {
    const room = await service.create(ORG);
    await expect(service.complete(room.id)).rejects.toBeInstanceOf(RoomTransitionError);
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(0);

    await configureQuiz(service, room.id);
    await service.activate(room.id);
    await service.complete(room.id);
    await expect(service.cancel(room.id)).rejects.toBeInstanceOf(RoomTransitionError);
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(2); // activated + completed

    const plain = await service.create(ORG);
    await service.softDelete(plain.id);
    expect(await readRoomLog(db.prisma, plain.id)).toHaveLength(0);
  });
```

- [ ] **Step 2: Написать failing-тесты гейта активации**

Добавить в конец int-spec:

```ts
describe('RoomService activation gate (REQ-RT-004, REQ-CORE-007)', () => {
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

  it('rejects activation of an unconfigured room; room stays DRAFT, log stays empty', async () => {
    const room = await service.create(ORG);
    const err = await service.activate(room.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoomNotConfiguredError);
    expect((err as RoomNotConfiguredError).code).toBe('ROOM_NOT_CONFIGURED');
    const reread = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(reread.status).toBe('DRAFT');
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(0);
  });

  // Перевалидация при активации — не декорация (design §5): подменяем настройки
  // напрямую в БД минуя сервис (configure такое не запишет) — активация обязана
  // отклонить и откатиться целиком (REQ-DEV-008).
  it('re-validates settings at activation: tampered appSettings roll everything back', async () => {
    const room = await service.create(ORG);
    await configureQuiz(service, room.id);
    await db.prisma.$executeRawUnsafe(
      `UPDATE room."Room" SET "appSettings" = '{}'::jsonb WHERE id = $1`,
      room.id,
    );
    const err = await service.activate(room.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppSettingsInvalidError);
    const reread = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(reread.status).toBe('DRAFT');
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(0);
  });

  // Реестр boot-time, строка комнаты durable: активация против версии, которой нет
  // в реестре процесса (редеплой убрал), обязана отказать (design §5).
  it('rejects activation when the pinned manifest is absent from the registry', async () => {
    const room = await service.create(ORG);
    await configureQuiz(service, room.id);
    const emptyRegistryService = new RoomService(
      db.prisma,
      new EventLogService(),
      new AppRegistryService([]),
    );
    const err = await emptyRegistryService.activate(room.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppManifestUnknownError);
    const reread = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(reread.status).toBe('DRAFT');
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(0);
  });

  // Гонка configure vs activate (design §5): row-lock guarded UPDATE активации —
  // точка сериализации. Ровно одно из двух: configure успел (активирована новая
  // тройка) или получил ROOM_SETTINGS_FROZEN (активирована прежняя). Пин в событии
  // совпадает с замороженной строкой при любом исходе. НЕ сужать до одного исхода —
  // расписание ненаблюдаемо (прецедент: race-тест cancel/cancel).
  it('configure vs activate race: one winner, pin in the event matches the frozen row', async () => {
    const room = await service.create(ORG);
    await configureQuiz(service, room.id);
    const newSettings = { title: 'Raced quiz', correctAnswers: [3] };

    const [cfg, act] = await Promise.allSettled([
      service.configure(room.id, { appId: 'quiz', manifestVersion: 1, settings: newSettings }),
      service.activate(room.id),
    ]);

    const final = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(final.status).toBe('ACTIVE');
    expect(act.status).toBe('fulfilled');
    if (cfg.status === 'rejected') {
      expect(cfg.reason).toBeInstanceOf(RoomSettingsFrozenError);
      expect(final.appSettings).toEqual(QUIZ_SETTINGS);
    } else {
      expect(final.appSettings).toEqual(newSettings);
    }
    const log = await readRoomLog(db.prisma, room.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      seq: 1,
      type: 'core.room.activated',
      payload: { appId: final.appId, manifestVersion: final.manifestVersion },
    });
  });
});
```

Импорт `RoomNotConfiguredError` добавить в импорт из `./room.errors` (Step 1 Task 3 его ещё не импортировал).

- [ ] **Step 3: Прогнать — подтвердить RED**

Run: `pnpm --filter @mymozhem/core test:int -- -t "activation gate"`
Expected: FAIL — 4 новых теста падают (активация пока не проверяет конфигурацию и не эмитит; race-тест: лог пуст). Также красными станут обновлённые в Step 1 тесты log-эмита (ожидают две строки).

- [ ] **Step 4: Реализовать ветку активации в transition**

В `packages/core/src/room/room.service.ts`:

а) обновить комментарий у `LIFECYCLE_EVENTS` и сам импорт ошибок:

```ts
import {
  RoomConflictError,
  RoomNotConfiguredError,
  RoomOrganizerNotRegisteredError,
  RoomSettingsFrozenError,
} from './room.errors';
```

```ts
// Терминальные переходы с пустым payload (REQ-RT-010). 'room.activated' — особая
// ветка в transition: его payload — пин (appId, manifestVersion) из замороженной
// строки (REQ-RT-004, design §5).
const LIFECYCLE_EVENTS: Partial<Record<RoomStatus, CoreEventName>> = {
  COMPLETED: 'room.completed',
  CANCELLED: 'room.cancelled',
};
```

б) заменить метод `transition` целиком:

```ts
  async transition(roomId: string, to: RoomStatus): Promise<Room> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.room.findUnique({ where: { id: roomId } });
      if (!current || current.deletedAt !== null) {
        throw new RoomConflictError(`Room ${roomId} not found or deleted`);
      }
      // State-machine legality first — precise ROOM_TRANSITION_INVALID for an existing room.
      assertTransition(current.status as RoomStatus, to);
      // Atomic guarded update: correctness of the race rests on this WHERE, not on the
      // read above (REQ-RT-005; same DB-invariant philosophy as REQ-RWD-010).
      // Для активации это ещё и точка сериализации с configure: updateMany берёт
      // row-lock — конкурентный configure либо уже закоммичен (и виден в re-read
      // ниже), либо ждёт наш коммит и получает ROOM_SETTINGS_FROZEN (design §5).
      const res = await tx.room.updateMany({
        where: { id: roomId, status: current.status, deletedAt: null },
        data: { status: to },
      });
      if (res.count === 0) {
        // → rollback: ни перехода, ни события у проигравшего (REQ-DEV-008).
        throw new RoomConflictError(`Room ${roomId} changed concurrently`);
      }
      // Re-read ПОСЛЕ row-lock: снимок, который перевалидируется, пинится и эмитится.
      // Чтение пина из `current` (до лока) могло бы отдать в room.activated пин,
      // который конкурентный configure уже перезаписал, — событие ≠ состояние.
      const updated = await tx.room.findUniqueOrThrow({ where: { id: roomId } });
      if (to === 'ACTIVE') {
        // REQ-RT-004: активация требует сконфигурированной комнаты — payload
        // room.activated это пин, неконфигурированной он неоткуда взяться.
        // Отказ откатывает и переход, и событие (REQ-DEV-008).
        if (
          updated.appId === null ||
          updated.manifestVersion === null ||
          updated.appSettings === null
        ) {
          throw new RoomNotConfiguredError(`Room ${roomId} has no app configuration`);
        }
        // REQ-CORE-007: повторная валидация при DRAFT → ACTIVE. Реестр boot-time,
        // строка durable: редеплой мог убрать манифест или изменить схему версии.
        this.appRegistry.validateSettings(
          updated.appId,
          updated.manifestVersion,
          updated.appSettings,
        );
        // Эмит — последним в транзакции: advisory lock комнаты всегда leaf-most,
        // после его захвата room."Room" в этой транзакции не пишем (конвенция
        // порядка блокировок, HANDOFF «Долгоживущие ограничения»).
        await this.eventLog.commitCoreEvent(tx, roomId, 'room.activated', {
          appId: updated.appId,
          manifestVersion: updated.manifestVersion,
        });
      } else {
        const eventName = LIFECYCLE_EVENTS[to];
        if (eventName) {
          await this.eventLog.commitCoreEvent(tx, roomId, eventName, {});
        }
      }
      return updated;
    });
  }
```

- [ ] **Step 5: Прогнать — GREEN, полная интеграционная лана**

Run: `pnpm --filter @mymozhem/core test:int`
Expected: PASS все describe (lifecycle, atomicity, CHECK ×2, organizerId FK, log emit, config triple, configure, activation gate). Никаких skipped.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/room
git commit -m "feat(core): activation freeze + room.activated emit (REQ-RT-004, REQ-RT-010, REQ-CORE-007, REQ-DEV-008)"
```

---

### Task 5: Полные гейты + живой boot артефакта

**Files:** только чтение/прогон; изменений кода нет (если гейт красный — возврат к задаче-виновнику).

**Interfaces:**
- Consumes: всё выше.
- Produces: зелёный CI-эквивалент локально; доказанный boot с 5 миграциями.

- [ ] **Step 1: Полная лана гейтов из корня**

Run:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm boundary-check && pnpm guardrails && pnpm build
```

Expected: всё зелёное. `boundary-check` — 0 нарушений (зависимость room → app-registry внутри core правилам не запрещена, конфиг не менялся).

- [ ] **Step 2: Живой boot docker-артефакта со свежей БД**

Run:

```bash
docker compose up --build -d
until curl -sf http://localhost:3000/health/ready >/dev/null; do sleep 2; done
docker compose exec -T postgres psql -U mymozhem -c "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at NULLS LAST;"
docker compose down -v
```

Expected: `/health/ready` → 200; в `_prisma_migrations` 5 строк, последняя `<timestamp>_room_app_config`; `down -v` убирает контейнеры и volume (хост-порт 5432/`lt-pg` не тронут — compose не публикует postgres наружу). Если psql-запрос не находит таблицу в `public` (multiSchema) — fallback: `docker compose logs server 2>&1 | grep -i "room_app_config"` — миграция видна в логе применения при старте.

- [ ] **Step 3: Финальный коммит при необходимости**

Если Steps 1–2 потребовали правок — закоммитить их отдельно (`fix(core): …` с REQ-тегом). Если правок не было — коммита нет, задача завершена.
