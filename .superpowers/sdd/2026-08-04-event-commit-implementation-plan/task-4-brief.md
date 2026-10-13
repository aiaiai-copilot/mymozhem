### Task 4: Рефактор EventLogService — общий appendLocked, зависимости, обвязка

**Files:**
- Modify: `packages/core/src/realtime/event-log.service.ts`
- Modify: `packages/core/src/realtime/realtime.module.ts`
- Modify: `packages/core/src/index.ts` (barrel-экспорты)
- Modify (точки ручного конструирования — новые аргументы конструктора):
  `packages/core/src/realtime/event-log.int-spec.ts`,
  `packages/core/src/room/room.service.int-spec.ts` (2 места: строки ~28-35 и ~551-558),
  `packages/core/src/auth/token.service.int-spec.ts`,
  `packages/core/src/membership/membership.service.int-spec.ts`,
  `apps/server/test/transport.e2e-spec.ts`

**Interfaces:**
- Consumes: `AppRegistryService` (Task 3), `EventEmitLimiter` (Task 2), `APP_CONFIG`/`AppConfig` (Task 1).
- Produces: `EventLogService` с конструктором `(appRegistry: AppRegistryService, emitLimiter: EventEmitLimiter, config: AppConfig)` и приватным `appendLocked` — база Task 5. Поведение `commitCoreEvent` НЕ меняется (все существующие тесты остаются зелёными без правки ассертов).

- [ ] **Step 1: Run the existing suite first (baseline)**

Run: `pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core test:int`
Expected: всё зелёное до рефактора (baseline для «поведение не изменилось»).

- [ ] **Step 2: Refactor EventLogService**

Переписать `packages/core/src/realtime/event-log.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { LogEvent, Prisma } from '@prisma/client';
import {
  CORE_EVENTS,
  ContractError,
  coreEventType,
  type CoreEventName,
  type Visibility,
} from '@mymozhem/sdk';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { AppRegistryService } from '../app-registry/app-registry.service';
import { EventEmitLimiter } from './event-emit-limiter';

// Append-only commit-примитив для событий комнаты. ЕДИНСТВЕННЫЙ путь записи в
// realtime."LogEvent" — оба публичных метода (core и app) сходятся в appendLocked.
// Критическая секция контрактуальна (SDK-дизайн §7, REQ-RT-007): вся валидация —
// ДО advisory lock, размер payload не влияет на исход гонки за seq.
// Конвенция порядка блокировок (HANDOFF «Долгоживущие ограничения»): advisory lock
// комнаты — всегда leaf-most; транзакция, захватившая его, после этого НЕ пишет
// в room."Room".
@Injectable()
export class EventLogService {
  constructor(
    private readonly appRegistry: AppRegistryService,
    private readonly emitLimiter: EventEmitLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async commitCoreEvent(
    tx: Prisma.TransactionClient,
    roomId: string,
    name: CoreEventName,
    payload: unknown = {},
    actorId: string | null = null,
  ): Promise<LogEvent> {
    const definition = CORE_EVENTS[name];
    const parsed = definition.schema.safeParse(payload);
    if (!parsed.success) {
      throw new ContractError(
        'EVENT_PAYLOAD_INVALID',
        `payload of ${coreEventType(name)} does not match its core schema`,
      );
    }
    return this.appendLocked(
      tx,
      roomId,
      coreEventType(name),
      parsed.data,
      actorId,
      definition.visibility,
      definition.version,
    );
  }

  // commitAppEvent добавляется Task 5 — шов дизайна §2.

  private async appendLocked(
    tx: Prisma.TransactionClient,
    roomId: string,
    type: string,
    payload: unknown,
    actorId: string | null,
    visibility: Visibility,
    schemaVersion: number,
  ): Promise<LogEvent> {
    // $executeRaw, не $queryRaw: pg_advisory_xact_lock возвращает void, а $queryRaw
    // пытается десериализовать колонку результата и падает на типе 'void'.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${roomId}, 0))`;
    const rows = await tx.$queryRaw<LogEvent[]>`
      INSERT INTO realtime."LogEvent"
        ("roomId", "seq", "type", "payload", "actorId", "visibility", "schemaVersion")
      SELECT ${roomId}::uuid,
             COALESCE(MAX("seq"), 0) + 1,
             ${type},
             ${JSON.stringify(payload)}::jsonb,
             ${actorId}::uuid,
             ${visibility}::realtime."EventVisibility",
             ${schemaVersion}
      FROM realtime."LogEvent"
      WHERE "roomId" = ${roomId}::uuid
      RETURNING *
    `;
    return rows[0];
  }
}
```

Примечание для имплементера: `appRegistry`/`emitLimiter`/`config` пока не читаются ни одним методом — eslint может ругаться на unused. Это осознанно (Task 5 их потребляет); если правило `no-unused-vars` для constructor-полей активно, добавить в класс временный комментарий `// deps consumed by commitAppEvent (Task 5)` — но не удалять параметры. Проверить `pnpm --filter @mymozhem/core lint` и действовать по факту.

- [ ] **Step 3: Update RealtimeModule**

Переписать `packages/core/src/realtime/realtime.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { AppRegistryModule } from '../app-registry/app-registry.module';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { EventLogService } from './event-log.service';
import { EventEmitLimiter } from './event-emit-limiter';

// PrismaModule намеренно НЕ импортируется: примитив работает на транзакционном
// клиенте вызывающего (атомарность «действие + лог», REQ-DEV-008).
@Module({
  imports: [ConfigModule, AppRegistryModule],
  providers: [
    {
      provide: EventEmitLimiter,
      useFactory: (config: AppConfig) => new EventEmitLimiter(config.EVENT_EMIT_RATE_LIMIT_PER_MIN),
      inject: [APP_CONFIG],
    },
    EventLogService,
  ],
  exports: [EventLogService],
})
export class RealtimeModule {}
```

- [ ] **Step 4: Barrel exports**

В `packages/core/src/index.ts` рядом с `export * from './realtime/event-log.service';` добавить:

```ts
export * from './realtime/event-emit-limiter';
export * from './realtime/realtime.errors';
```

- [ ] **Step 5: Update manual constructions (6 файлов)**

Каждое `new EventLogService()` заменить на конструкцию с зависимостями. Паттерн замены (в каждом файле — с учётом уже существующих локальных переменных/импортов; `TEST_CONFIG` уже импортирован во всех этих файлах):

```ts
new EventLogService(
  new AppRegistryService([validManifests[0]]), // или [], как в соседнем RoomService того же файла
  new EventEmitLimiter(1000), // щедрый лимит: эти спеки не про rate-limit
  TEST_CONFIG,
)
```

Конкретно:
- `event-log.int-spec.ts:25` — registry `[validManifests[0]]` (как в RoomService рядом); `:35` — тот же паттерн.
- `room.service.int-spec.ts:30` и `:553` — registry как в соседнем RoomService (`[validManifests[0]]` и `[]` соответственно).
- `token.service.int-spec.ts:41` — registry `[]` (как в RoomService рядом).
- `membership.service.int-spec.ts:37` — registry `[]`.
- `apps/server/test/transport.e2e-spec.ts:97` — registry `[]`; импорт `EventEmitLimiter` из `@mymozhem/core` (barrel обновлён в Step 4).

Импорты `EventEmitLimiter` добавить в каждый тронутый core-файл (`./event-emit-limiter` в realtime, `../realtime/event-emit-limiter` в остальных).

- [ ] **Step 6: Verify behavior unchanged**

Run: `pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core test:int`
Expected: весь suite зелёный — те же тесты, что в Step 1, без правок ассертов.
Run: `pnpm --filter @mymozhem/server test` → e2e зелёные. `pnpm build && pnpm lint && pnpm typecheck` → зелёные.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/realtime packages/core/src/index.ts packages/core/src/room/room.service.int-spec.ts packages/core/src/auth/token.service.int-spec.ts packages/core/src/membership/membership.service.int-spec.ts apps/server/test/transport.e2e-spec.ts
git commit -m "refactor(core): EventLogService — общий appendLocked + deps (appRegistry/limiter/config), шов commitAppEvent"
```

---

