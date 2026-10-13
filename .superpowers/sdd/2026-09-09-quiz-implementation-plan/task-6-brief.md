### Task 6: core — app-runtime: диспетчер, replay, кэш проекций, сериализация по комнате

**Files:**
- Create: `packages/core/src/app-runtime/app-runtime.tokens.ts`
- Create: `packages/core/src/app-runtime/app-runtime.errors.ts`
- Create: `packages/core/src/app-runtime/room-serializer.ts`
- Create: `packages/core/src/app-runtime/app-projection-cache.ts`
- Create: `packages/core/src/app-runtime/app-runtime.service.ts`
- Create: `packages/core/src/app-runtime/app-runtime.module.ts`
- Create: `packages/core/src/app-runtime/room-serializer.spec.ts`
- Create: `packages/core/src/app-runtime/app-runtime.int-spec.ts`
- Modify: `packages/core/src/index.ts` (экспорты модуля/сервиса/токена/ошибок)

**Interfaces:**
- Consumes: SDK Task 1 (коды), Task 3 (`clientInitiated`), Task 4 (`AppRuntimeModule`, `appCommitSchema`, `AppLogEvent`, `AppHostContext`); core: `EventLogService.commitAppEvent(tx, roomId, name, payload, visibility, actorId)`, `EventOutbox.run`, `MembershipService.findActiveMembership`, `AppRegistryService.eventValidatorFor/getEventDefinition`, `RoomNotActiveError`, `EventPayloadInvalidError` (realtime.errors), `PrismaService`.
- Produces: `APP_RUNTIME_MODULES` (token), `AppRuntimeService.dispatch(params): Promise<void>` (потребитель — Task 7, gateway), `AppRuntimeModule.register(modules: readonly AppRuntimeModule[])`, `AppRuntimeService.invalidateProjection(roomId)` (для тестов пересоздания, Task 13).

Реализация по файлам:

```typescript
// app-runtime.tokens.ts
import type { AppRuntimeModule } from '@mymozhem/sdk';
export const APP_RUNTIME_MODULES = Symbol('APP_RUNTIME_MODULES');
export type RegisteredRuntimeModules = readonly AppRuntimeModule[];
```

```typescript
// app-runtime.errors.ts — ContractError напрямую: wireCodeOf gateway отдаёт err.code
// без записи в error-mapping (REQ-SEC-006 соблюдено: наружу только код).
import { ContractError } from '@mymozhem/sdk';

export class AppModuleUnavailableError extends ContractError {
  constructor(appId: string, manifestVersion: number) {
    super('MODULE_UNAVAILABLE', `no runtime module registered for ${appId}@${manifestVersion}`);
    this.name = new.target.name;
  }
}

export class PublishForbiddenError extends ContractError {
  constructor(reason: string) {
    super('PUBLISH_FORBIDDEN', reason);
    this.name = new.target.name;
  }
}
```

```typescript
// room-serializer.ts — per-room очередь диспетчей (одна реплика, REQ-OPS-005).
// Без неё два конкурентных publish прочитают одну и ту же проекцию до коммита
// друг друга (double-answer гонка, design §7.3). Состояние — поле экземпляра,
// пересоздаваемо (REQ-CORE-004): потеря записи = потеря лишь упорядочения в полёте.
export class RoomSerializer {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const tail = this.tails.get(roomId) ?? Promise.resolve();
    const run = tail.then(() => fn());
    // Цепочка не должна расти бесконечно и не должна протухать: маркер заменяется
    // на settle нового звена; когда звено последнее — запись удаляется.
    const marker = run.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(roomId, marker);
    void marker.then(() => {
      if (this.tails.get(roomId) === marker) this.tails.delete(roomId);
    });
    return run;
  }
}
```

```typescript
// app-projection-cache.ts
import type { AppLogEvent } from '@mymozhem/sdk';

interface CacheEntry<S> {
  state: S;
  lastSeq: number;
}

// In-memory кэш проекций, key = roomId (комната пинится к одному app). Не источник
// истины: холодный промах пересоздаётся replay'ем лога (ADR-005). invalidate —
// точка для тестов пересоздания (design §7.6) и будущей эвикции.
export class AppProjectionCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  get<S>(roomId: string): CacheEntry<S> | undefined {
    return this.entries.get(roomId) as CacheEntry<S> | undefined;
  }

  set<S>(roomId: string, entry: CacheEntry<S>): void {
    this.entries.set(roomId, entry);
  }

  invalidate(roomId: string): void {
    this.entries.delete(roomId);
  }
}

export type { AppLogEvent };
```

```typescript
// app-runtime.service.ts
import { Inject, Injectable } from '@nestjs/common';
import {
  appCommitSchema,
  ContractError,
  type AppHostContext,
  type AppLogEvent,
  type AppRuntimeModule,
} from '@mymozhem/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipService } from '../membership/membership.service';
import { AppRegistryService } from '../app-registry/app-registry.service';
import { EventLogService } from '../realtime/event-log.service';
import { EventOutbox } from '../realtime/event-outbox';
import { EventPayloadInvalidError, RoomNotActiveError } from '../realtime/realtime.errors';
import { AppModuleUnavailableError, PublishForbiddenError } from './app-runtime.errors';
import { RoomSerializer } from './room-serializer';
import { AppProjectionCache } from './app-projection-cache';
import { APP_RUNTIME_MODULES, type RegisteredRuntimeModules } from './app-runtime.tokens';

// Командный хост (design 2026-09-09 §2): клиентский publish app-типа исполняется
// модулем ДО коммита; модуль возвращает события или бросает типизированный отказ.
// Все гейты записи (схема владельца, visibility ceiling, rate-limit, status, seal)
// остаются в commitAppEvent — диспетчер их не дублирует и не обходит.
@Injectable()
export class AppRuntimeService {
  private readonly serializer = new RoomSerializer();

  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
    private readonly appRegistry: AppRegistryService,
    private readonly eventLog: EventLogService,
    private readonly outbox: EventOutbox,
    private readonly projections: AppProjectionCache,
    @Inject(APP_RUNTIME_MODULES) private readonly modules: RegisteredRuntimeModules,
  ) {}

  invalidateProjection(roomId: string): void {
    this.projections.invalidate(roomId);
  }

  async dispatch(params: {
    roomId: string;
    actorId: string;
    appId: string;
    shortName: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.serializer.run(params.roomId, () => this.dispatchLocked(params));
  }

  private async dispatchLocked(params: {
    roomId: string;
    actorId: string;
    appId: string;
    shortName: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    // 1. Комната ACTIVE с пином (REQ-RT-004/016) — до вызова модуля: модуль не
    //    должен наблюдать запечатанную комнату. Тот же гейт повторит commit.
    const room = await this.prisma.room.findUnique({ where: { id: params.roomId } });
    if (
      !room ||
      room.deletedAt !== null ||
      room.status !== 'ACTIVE' ||
      room.appId === null ||
      room.manifestVersion === null
    ) {
      throw new RoomNotActiveError(`Room ${params.roomId} is not ACTIVE (sealed, draft or not found)`);
    }
    if (room.appId !== params.appId) {
      throw new ContractError('EVENT_UNKNOWN_TYPE', `room ${params.roomId} is pinned to ${room.appId}, not ${params.appId}`);
    }
    // 2. Членство и роль (REQ-ID-011): SPECTATOR читает, но не publish'ит — гейт
    //    ядра, до вызова модуля.
    const membership = await this.membership.findActiveMembership(params.roomId, params.actorId);
    if (!membership) {
      throw new ContractError('ACTOR_NOT_MEMBER', `identity ${params.actorId} is not a member of room ${params.roomId}`);
    }
    if (membership.role === 'SPECTATOR') {
      throw new PublishForbiddenError('SPECTATOR cannot publish app events');
    }
    // 3. Модуль по пину комнаты. Нет модуля — fail-closed.
    const mod = this.modules.find(
      (m) => m.appId === room.appId && m.manifestVersion === room.manifestVersion,
    );
    if (!mod) {
      throw new AppModuleUnavailableError(room.appId, room.manifestVersion);
    }
    // 4. Тип — клиентская команда пиннутого манифеста. Производные типы клиенту закрыты.
    const eventDef = this.appRegistry.getEventDefinition(room.appId, room.manifestVersion, params.shortName);
    if (!eventDef) {
      throw new ContractError('EVENT_UNKNOWN_TYPE', `no event type ${params.shortName} in manifest ${room.appId}@${room.manifestVersion}`);
    }
    if (!eventDef.clientInitiated) {
      throw new PublishForbiddenError(`event type ${params.shortName} is not client-initiated`);
    }
    // 5. Вход валидируется схемой владельца ДО вызова модуля (REQ-RT-009): handler
    //    читает payload для решений — malformed вход не должен становиться TypeError.
    const validate = this.appRegistry.eventValidatorFor(room.appId, room.manifestVersion, params.shortName, eventDef.schema);
    if (!validate(params.payload)) {
      throw new EventPayloadInvalidError(
        `payload of ${room.appId}.${params.shortName} does not match its registered schema: ${this.appRegistry.describeEventErrors(validate)}`,
      );
    }
    // 6. Проекция: тёплый кэш или replay лога (module-private включительно —
    //    серверный путь, не клиентский канал).
    const state = await this.projectionFor(mod, params.roomId);
    const ctx: AppHostContext<unknown> = {
      roomId: params.roomId,
      actorId: params.actorId,
      actorRole: membership.role,
      settings: room.appSettings,
      state,
      now: new Date().toISOString(),
    };
    // 7. Вызов модуля. AppRejection (ContractError) уходит наверх как есть —
    //    до коммита ничего не пишется.
    const commits = await mod.handlePublish(ctx, params.shortName, params.payload);
    for (const commit of commits) {
      const parsed = appCommitSchema.safeParse(commit);
      if (!parsed.success) {
        // Баг модуля, не клиента: наружу код, детали — в message (server-side).
        throw new ContractError('EVENT_PAYLOAD_INVALID', `module ${mod.appId} returned a malformed commit: ${parsed.error.message}`);
      }
    }
    // 8. Коммиты — через единственный путь записи, в одной транзакции, в порядке
    //    массива (seq возрастает — порядок модулем задан осознанно).
    if (commits.length > 0) {
      const committed = await this.outbox.run(async (tx) => {
        const out = [];
        for (const commit of commits) {
          out.push(
            await this.eventLog.commitAppEvent(
              tx,
              params.roomId,
              commit.shortName,
              commit.payload,
              commit.visibility,
              commit.actor === 'publisher' ? params.actorId : null,
            ),
          );
        }
        return out;
      });
      // 9. Тёплый fold: проекция продвигается закоммиченными событиями.
      this.foldCommitted(mod, params.roomId, state, committed);
    }
  }

  private async projectionFor(module: AppRuntimeModule, roomId: string): Promise<unknown> {
    const cached = this.projections.get(roomId);
    if (cached !== undefined) {
      return cached.state;
    }
    const events = await this.prisma.logEvent.findMany({
      where: { roomId, type: { startsWith: `${module.appId}.` } },
      orderBy: { seq: 'asc' },
    });
    let state = module.initialState();
    for (const event of events) {
      state = module.reduce(state, toAppLogEvent(module.appId, event));
    }
    this.projections.set(roomId, { state, lastSeq: events.at(-1)?.seq ?? 0 });
    return state;
  }

  private foldCommitted(
    module: AppRuntimeModule,
    roomId: string,
    state: unknown,
    committed: readonly { type: string; payload: unknown; actorId: string | null; seq: number; recordedAt: Date }[],
  ): void {
    let next = state;
    for (const event of committed) {
      next = module.reduce(next, toAppLogEvent(module.appId, event));
    }
    this.projections.set(roomId, { state: next, lastSeq: committed.at(-1)?.seq ?? 0 });
  }
}

function toAppLogEvent(
  appId: string,
  event: { type: string; payload: unknown; actorId: string | null; seq: number; recordedAt: Date },
): AppLogEvent {
  return {
    shortName: event.type.slice(appId.length + 1),
    payload: event.payload as Record<string, unknown>,
    actorId: event.actorId,
    seq: event.seq,
    recordedAt: event.recordedAt.toISOString(),
  };
}
```

```typescript
// app-runtime.module.ts — та же схема, что AppRegistryModule (Task 5): global +
// register из composition root.
import { Module, type DynamicModule } from '@nestjs/common';
import { AppRuntimeService } from './app-runtime.service';
import { AppProjectionCache } from './app-projection-cache';
import { APP_RUNTIME_MODULES, type RegisteredRuntimeModules } from './app-runtime.tokens';

@Module({})
export class AppRuntimeModule {
  static register(modules: RegisteredRuntimeModules): DynamicModule {
    return {
      module: AppRuntimeModule,
      global: true,
      providers: [{ provide: APP_RUNTIME_MODULES, useValue: modules }, AppProjectionCache, AppRuntimeService],
      exports: [AppRuntimeService],
    };
  }
}
```

**REQ:** REQ-RT-004 (пин), REQ-ID-011 (SPECTATOR-гейт), REQ-RT-009 (вход до модуля), REQ-CTR-009 (через commit), REQ-CORE-004 (пересоздаваемое состояние).

- [ ] **Step 1: Failing unit test — RoomSerializer**

`room-serializer.spec.ts`: 50 конкурентных `run` по одному roomId инкрементят общий счётчик с искусственной задержкой — итог ровно 50, порядок входов строго FIFO; два разных roomId не блокируют друг друга (пересечение по времени); rejection звена не рвёт цепочку (следующий run выполняется); запись удаляется после settle (размер map возвращается к 0).

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/core test -- room-serializer`
Expected: FAIL.

- [ ] **Step 3: Implement RoomSerializer + AppProjectionCache** (код выше).

- [ ] **Step 4: Run — GREEN** (unit).

- [ ] **Step 5: Failing int-spec — диспетчер**

`app-runtime.int-spec.ts` по образцу `event-commit.int-spec.ts` (прямая инстанциация сервисов, `startTestDb`, `seedIdentity`, TRUNCATE в afterEach). Фикстурный модуль `test-app@1` (манифест из event-commit.int-spec с `clientInitiated: true` у `note.posted` и `secret.recorded`, плюс производный тип `note.echoed` public `clientInitiated: false`):

```typescript
// Фикстурный рантайм-модуль: note.posted коммитит вход как есть (actor: publisher)
// и доизлучает note.echoed (actor: server, payload { n: вдвое }); secret.recorded
// коммитит как есть. reduce считает сумму n по note.posted — для replay-теста.
```

Сервис под тестом:

```typescript
const runtime = new AppRuntimeService(
  db.prisma, membership, registry, eventLog, outbox, new AppProjectionCache(), [testModule],
);
await runtime.dispatch({ roomId, actorId: P1, appId: 'test-app', shortName: 'note.posted', payload: { n: 1 } });
```

Тесты (каждый — отдельный `it`):
1. commit цепочка: `note.posted` → в логе два события подряд (`test-app.note.posted` actorId=P1, затем `test-app.note.echoed` actorId=null), оба доставлены в bus (подписка на RealtimeBus как в event-outbox.int-spec).
2. SPECTATOR: membership с ролью SPECTATOR (создать напрямую через `db.prisma.membership.create`) → dispatch → rejects `PUBLISH_FORBIDDEN`, лог пуст.
3. Производный тип от клиента: `note.echoed` → `PUBLISH_FORBIDDEN`.
4. Модуль не зарегистрирован (пин на `test-app@2` без модуля) → `MODULE_UNAVAILABLE`.
5. Тип вне манифеста → `EVENT_UNKNOWN_TYPE`; невалидный payload → `EVENT_PAYLOAD_INVALID`; не-ACTIVE комната → `ROOM_LOG_SEALED` (RoomNotActiveError); не-член → `ACTOR_NOT_MEMBER`.
6. Отказ модуля до коммита: модуль бросает `new AppRejection('ALREADY_ANSWERED', '…')` на второй `note.posted` от того же актора (состояние из reduce) → второй dispatch rejects кодом, в логе ровно одно `note.posted`.
7. Конкурентный double-submit одного актора: `Promise.allSettled([dispatch, dispatch])` → ровно один успех, в логе одно событие (проверка через `readRoomLog`).
8. REQ-RT-007 на app-пути: 20 конкурентных dispatch со смешанным размером payload (`note.posted` с `blob` 0 и 4KB попеременно) → все закоммичены, seq плотные `1..20`, порядок не коррелирует с размером (проверка: множество seq больших payload не является префиксом/суффиксом — достаточно: seqs плотные и все события на месте; строгая payload-нейтральность критической секции покрыта event-commit.int-spec и не меняется этим срезом).
9. Replay: после двух dispatch инвалидировать кэш (`invalidateProjection`), вызвать dispatch снова → модуль видел state с суммой прежних `n` (assert через шпион reduce/последнее observed state).

- [ ] **Step 6: Run — RED**

Run: `pnpm --filter @mymozhem/core test:int -- app-runtime`
Expected: FAIL (AppRuntimeService не существует).

- [ ] **Step 7: Implement** `app-runtime.service.ts`, `app-runtime.module.ts`, `app-runtime.tokens.ts`, `app-runtime.errors.ts`, экспорты в `core/src/index.ts`.

- [ ] **Step 8: Run — GREEN**

Run: `pnpm --filter @mymozhem/core test:int -- app-runtime && pnpm typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core
git commit -m "feat(core): app-runtime — командный хост модулей (диспетчер до коммита, replay-проекция, per-room сериализация, гейты SPECTATOR/clientInitiated/пин)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

