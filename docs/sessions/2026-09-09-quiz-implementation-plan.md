# Quiz-срез (фаза 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Первый app-модуль (Quiz) за SDK-границей + рантайм-поверхность app-модулей в ядре («командный хост»: диспетчер publish → модуль → коммит).

**Architecture:** SDK 1.5.0 добавляет рантайм-контракт (`AppRuntimeModule`, `AppCommit`, `AppHostContext`, `AppRejection`) и поле `clientInitiated` в манифест. Новый `core/src/app-runtime/` диспетчерит клиентский publish app-типов в модуль до коммита, с per-room сериализацией, replay-проекцией из лога и гейтами (SPECTATOR, clientInitiated, пин модуля). `packages/app-quiz` реализует механику (раунды на скорость, ручной драйв ведущим, скоростная шкала) чистыми функциями поверх контракта. Связывание — только в `apps/server` (composition root).

**Tech Stack:** NestJS 11 (Fastify), Prisma 7 (PostgreSQL, testcontainers), zod 4, Ajv2020, socket.io 4, pnpm workspaces + turbo, jest/ts-jest.

**Spec:** `docs/sessions/2026-09-09-quiz-module-design.md` (утверждена владельцем 2026-09-09; §3 appSettings — раскладка на `questions`/`correctAnswers`, правка при детализации плана).

## Global Constraints

- Контракт: `CONTRACT_VERSION` = `1.5.0` и `packages/sdk/package.json` version = `1.5.0` (паритет проверяется контрактным тестом).
- `packages/app-*` НЕ импортирует `packages/core` (boundary `app-only-through-sdk`, уже вооружено); `@mymozhem/sdk` — лист.
- App-схемы для `defineApp` — без `.refine()/.superRefine()/.trim()` и др. checks вне allowlist `REPRESENTABLE_CHECK_KINDS` (conversion guard отклонит).
- actorId — только из аутентифицированного контекста (REQ-RT-009); наружу ровно `{code}` (REQ-SEC-006).
- Состояние модуля — пересоздаваемая проекция из лога (ADR-005, REQ-CORE-004); своих таблиц у квиза нет.
- Отказ модуля — до коммита, типизированный код из `CONTRACT_ERROR_CODES`.
- Тесты: unit — `*.spec.ts` (jest default), интеграционные — `*.int-spec.ts` (`pnpm --filter @mymozhem/core test:int`, testcontainers), e2e — `apps/server/test/*.e2e-spec.ts` (`pnpm --filter @mymozhem/server test`).
- Коммиты: conventional, по-русски, с `Co-Authored-By: Claude Code <noreply@anthropic.com>`. Push — НЕ выполнять (решение владельца).
- Закрываемые REQ (для двухстадийного ревью каждой задачи): REQ-CTR-001/002/003/004/005/008/009, REQ-CORE-004/005/008, REQ-RT-004/007/009/013, REQ-ID-011 (SPECTATOR-часть). Каждая задача ниже помечена своими REQ.

---

### Task 1: SDK — контракт 1.5.0 + новые wire-коды ошибок

**Files:**
- Modify: `packages/sdk/src/contract-version.ts:8` (`CONTRACT_VERSION`)
- Modify: `packages/sdk/package.json` (`version`)
- Modify: `packages/sdk/src/errors/error-codes.ts` (новые коды)
- Test: `packages/sdk/src/errors/error-codes.contract.spec.ts` (существующий — расширить), `packages/sdk/src/contract-version.contract.spec.ts`

**Interfaces:**
- Produces: коды `'MODULE_UNAVAILABLE'`, `'PUBLISH_FORBIDDEN'`, `'ANSWER_TOO_FAST'`, `'ROUND_NOT_OPEN'`, `'ALREADY_ANSWERED'`, `'QUESTION_UNKNOWN'`, `'OPTION_UNKNOWN'` в `ContractErrorCode` — их используют Task 6 (app-runtime) и Task 11 (quiz handlers).

- [ ] **Step 1: Failing test — новые коды в перечислении**

В `error-codes.contract.spec.ts` добавить:

```typescript
it.each([
  'MODULE_UNAVAILABLE',
  'PUBLISH_FORBIDDEN',
  'ANSWER_TOO_FAST',
  'ROUND_NOT_OPEN',
  'ALREADY_ANSWERED',
  'QUESTION_UNKNOWN',
  'OPTION_UNKNOWN',
] as const)('accepts phase-2 code %s', (code) => {
  expect(contractErrorCodeSchema.safeParse(code).success).toBe(true);
});
```

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: FAIL (коды не принимаются).

- [ ] **Step 3: Implement**

В `error-codes.ts` перед `'INTERNAL_ERROR'` добавить блок:

```typescript
  // Quiz-срез (фаза 2, design 2026-09-09): диспетчер app-runtime и отказы модуля.
  'MODULE_UNAVAILABLE',
  'PUBLISH_FORBIDDEN',
  'ANSWER_TOO_FAST',
  'ROUND_NOT_OPEN',
  'ALREADY_ANSWERED',
  'QUESTION_UNKNOWN',
  'OPTION_UNKNOWN',
```

В `contract-version.ts`: `export const CONTRACT_VERSION = '1.5.0';` В `packages/sdk/package.json`: `"version": "1.5.0"`.

- [ ] **Step 4: Run — GREEN**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: PASS, включая parity-тест версии (contract-version.contract.spec.ts).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk
git commit -m "feat(sdk): контракт 1.5.0 — wire-коды фазы 2 (app-runtime + отказы квиза)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: SDK — роль в join-request (SPECTATOR вход)

**Files:**
- Modify: `packages/sdk/src/auth/join-request.ts`
- Modify: `packages/sdk/src/auth/join-request.fixtures.ts`
- Test: `packages/sdk/src/auth/join-request.contract.spec.ts`

**Interfaces:**
- Produces: `JoinRequest.role?: 'participant' | 'spectator'` (wire-значения lowercase; маппинг на `MemberRole` — Task 8).

**REQ:** REQ-ID-011 (назначение SPECTATOR), REQ-CTR-005 (фикстуры).

- [ ] **Step 1: Failing contract test**

В `join-request.contract.spec.ts` добавить:

```typescript
it('accepts explicit spectator role', () => {
  expect(joinRequestSchema.safeParse({ code: 'ABCDEFGH', displayName: 'Гляделкин', role: 'spectator' }).success).toBe(true);
});

it('defaults to participant semantics: role is optional', () => {
  const parsed = joinRequestSchema.safeParse({ code: 'ABCDEFGH', displayName: 'Игрок' });
  expect(parsed.success).toBe(true);
  expect(parsed.success && parsed.data.role).toBeUndefined();
});

it('refuses privileged roles through the join flag', () => {
  for (const role of ['organizer', 'moderator', 'ORGANIZER', 'SPECTATOR']) {
    expect(joinRequestSchema.safeParse({ code: 'ABCDEFGH', displayName: 'x', role }).success).toBe(false);
  }
});
```

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/sdk test -- join-request`
Expected: FAIL (role — лишний ключ в strictObject).

- [ ] **Step 3: Implement**

`join-request.ts`:

```typescript
import { z } from 'zod';
import { displayNameSchema } from '../identity/display-name';

// POST /rooms/join request body (REQ-ID-003). strict: лишние ключи не проходят границу.
// role (фаза 2, REQ-ID-011): самоназначение зрителем при входе. Только два значения —
// ORGANIZER/MODERATOR через флаг не получить структурно. Отсутствие = participant.
export const joinRequestSchema = z.strictObject({
  code: z.string().trim().min(1),
  displayName: displayNameSchema,
  role: z.enum(['participant', 'spectator']).optional(),
});
export type JoinRequest = z.infer<typeof joinRequestSchema>;
```

В `join-request.fixtures.ts` добавить валидную фикстуру с `role: 'spectator'` и невалидную с `role: 'organizer'` (по образцу существующих пар в файле).

- [ ] **Step 4: Run — GREEN**

Run: `pnpm --filter @mymozhem/sdk test -- join-request`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk
git commit -m "feat(sdk): join-request — необязательная роль participant|spectator (REQ-ID-011)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: SDK — `clientInitiated` в манифесте событий

**Files:**
- Modify: `packages/sdk/src/manifest/manifest.schema.ts:30-33` (`manifestEventSchema`)
- Modify: `packages/sdk/src/manifest/define-app.ts:17-25,118-123` (`AppDefinition.events`, маппинг)
- Modify: `packages/sdk/src/manifest/manifest.fixtures.ts`, `packages/sdk/src/manifest/define-app.fixtures.ts`
- Test: `packages/sdk/src/manifest/manifest.contract.spec.ts`, `define-app.contract.spec.ts`
- Modify (все манифест-литералы в репо — найти `grep -rln "manifestVersion" --include="*.ts" packages apps | grep -v dist | grep -v node_modules`): `apps/server/test/realtime.e2e-spec.ts` (TEST_APP), `packages/core/src/realtime/event-commit.int-spec.ts` (TEST_APP), `packages/core/src/realtime/event-log.int-spec.ts` и `packages/core/src/room/room.service.int-spec.ts` (если содержат манифест-литералы — проверить grep'ом)

**Interfaces:**
- Produces: `manifestEventSchema = { schema, visibility, clientInitiated: boolean }`; `AppDefinition.events` entry = `{ schema: z.ZodType; visibility: Visibility; clientInitiated: boolean }`. Consumed by Task 6 (гейт диспетчера) и Task 9 (манифест квиза).

**REQ:** REQ-CTR-008/009 (реестр типов), design §2 (клиенту открыты только команды).

- [ ] **Step 1: Failing tests**

В `manifest.contract.spec.ts`: фикстура события без `clientInitiated` отклоняется; с `clientInitiated: false` принимается. В `define-app.contract.spec.ts`: `defineApp` проносит флаг в зарегистрированный манифест:

```typescript
it('carries clientInitiated into the registered manifest', () => {
  const manifest = defineApp({
    appId: 'flag-app',
    manifestVersion: 1,
    appSettings: z.strictObject({ label: z.string() }),
    events: {
      'note.posted': { schema: z.strictObject({ n: z.number() }), visibility: 'public', clientInitiated: true },
      'note.derived': { schema: z.strictObject({ n: z.number() }), visibility: 'public', clientInitiated: false },
    },
  });
  expect(manifest.events['note.posted']?.clientInitiated).toBe(true);
  expect(manifest.events['note.derived']?.clientInitiated).toBe(false);
});
```

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/sdk test -- manifest`
Expected: FAIL (поле отсутствует/отклоняется strictObject'ом).

- [ ] **Step 3: Implement**

`manifest.schema.ts`:

```typescript
// Per-type exposure ceiling is mandatory (REQ-CTR-009, ADR-008 §2). clientInitiated
// (фаза 2): только типы с true открыты для клиентского publish; производные типы
// (эмиссия модуля, actorId=null) клиенту закрыты — гейт в app-runtime диспетчере.
export const manifestEventSchema = z.strictObject({
  schema: jsonSchemaObjectSchema,
  visibility: visibilitySchema,
  clientInitiated: z.boolean(),
});
```

`define-app.ts` — тип и маппинг:

```typescript
export type AppDefinition = {
  appId: string;
  manifestVersion: number;
  contractRange?: string;
  appSettings: z.ZodType;
  // Short names; the core prefixes the namespace itself (design §4.1).
  // clientInitiated — обязательное явное решение по каждому типу (fail-safe = false).
  events: Record<string, { schema: z.ZodType; visibility: Visibility; clientInitiated: boolean }>;
};
```

```typescript
  const events = Object.fromEntries(
    Object.entries(definition.events).map(([shortName, event]) => [
      shortName,
      { schema: toRegisteredSchema(event.schema), visibility: event.visibility, clientInitiated: event.clientInitiated },
    ]),
  );
```

Обновить фикстуры: каждому событию в `manifest.fixtures.ts` / `define-app.fixtures.ts` добавить `clientInitiated` (валидным — явные true/false; добавить невалидную фикстуру без поля). Обновить все манифест-литералы из grep-списка (test-app'ы: `note.posted`/`secret.recorded` — `clientInitiated: true`, они публикуются e2e напрямую; `round.hinted` — true; производных там нет).

- [ ] **Step 4: Run — GREEN по всему дереву**

Run: `pnpm build && pnpm --filter @mymozhem/sdk test && pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/server test`
Expected: PASS (int не запускать здесь — Task 6/7; но typecheck всего дерева обязателен: `pnpm typecheck`).

- [ ] **Step 5: Commit**

```bash
git add packages apps
git commit -m "feat(sdk): манифест — обязательный clientInitiated на тип события (design 2026-09-09 §2)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: SDK — рантайм-контракт модуля

**Files:**
- Create: `packages/sdk/src/app-runtime/app-commit.ts`
- Create: `packages/sdk/src/app-runtime/app-log-event.ts`
- Create: `packages/sdk/src/app-runtime/app-host-context.ts`
- Create: `packages/sdk/src/app-runtime/app-rejection.ts`
- Create: `packages/sdk/src/app-runtime/app-runtime-module.ts`
- Create: `packages/sdk/src/app-runtime/app-commit.fixtures.ts`
- Test: `packages/sdk/src/app-runtime/app-commit.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`

**Interfaces:**
- Produces (их потребляют Task 6 и Task 9–11):

```typescript
// app-commit.ts — что модуль просит ядро зафиксировать. actor: 'publisher' —
// событие атрибутируется клиенту (membership-гейт и per-actor rate-limit применяются);
// 'server' — эмиссия модуля (actorId=null, гейты не применяются, как в commitAppEvent).
export const appCommitActorSchema = z.enum(['publisher', 'server']);
export const appCommitSchema = z.strictObject({
  shortName: shortEventNameSchema,
  payload: z.record(z.string(), z.unknown()),
  visibility: visibilitySchema,
  actor: appCommitActorSchema,
});
export type AppCommit = z.infer<typeof appCommitSchema>;

// app-log-event.ts — событие лога как его видит модуль при replay. recordedAt —
// ISO-строка, не Date: через границу ходят только JSON-сериализуемые значения
// (REQ-CTR-002); модуль делает Date.parse сам.
export interface AppLogEvent {
  readonly shortName: string;
  readonly payload: Record<string, unknown>;
  readonly actorId: string | null;
  readonly seq: number;
  readonly recordedAt: string;
}

// app-host-context.ts — now тоже ISO-строка (та же причина).
export interface AppHostContext<S> {
  readonly roomId: string;
  readonly actorId: string;
  readonly actorRole: MemberRole;
  readonly settings: unknown;
  readonly state: S;
  readonly now: string;
}

// app-rejection.ts — типизированный отказ модуля; код обязан быть в CONTRACT_ERROR_CODES.
export class AppRejection extends ContractError {
  constructor(code: ContractErrorCode, message: string) {
    super(code, message);
    this.name = 'AppRejection';
  }
}

// app-runtime-module.ts
export interface AppRuntimeModule<S = unknown> {
  readonly appId: string;
  readonly manifestVersion: number;
  readonly manifest: AppManifest;
  initialState(): S;
  reduce(state: S, event: AppLogEvent): S;
  handlePublish(
    ctx: AppHostContext<S>,
    shortName: string,
    payload: Record<string, unknown>,
  ): AppCommit[] | Promise<AppCommit[]>;
}
```

**REQ:** REQ-CTR-002/003/005.

- [ ] **Step 1: Failing contract test**

`app-commit.contract.spec.ts`: валидные фикстуры проходят `appCommitSchema`, невалидные (лишний ключ, невалидный shortName `Quiz.x`, неизвестная visibility, actor вне enum) отклоняются. Фикстуры — в `app-commit.fixtures.ts` (пары valid/invalid по образцу `visibility.fixtures.ts`).

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/sdk test -- app-commit`
Expected: FAIL (модуль не существует).

- [ ] **Step 3: Implement** — файлы из блока Interfaces выше + экспорты в `index.ts` (`export * from './app-runtime/...';` — все пять файлов + fixtures).

- [ ] **Step 4: Run — GREEN**

Run: `pnpm --filter @mymozhem/sdk test && pnpm --filter @mymozhem/sdk typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk
git commit -m "feat(sdk): рантайм-контракт app-модуля — AppRuntimeModule/AppCommit/AppHostContext/AppRejection (REQ-CTR-002/003)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: core — seams реестра в composition root

**Files:**
- Modify: `packages/core/src/app-registry/app-registry.module.ts` — `AppRegistryModule.register(manifests)`, `global: true`
- Modify: `packages/core/src/room/room.module.ts`, `packages/core/src/realtime/realtime.module.ts` — убрать статический импорт `AppRegistryModule` (разрешение через global)
- Modify: `apps/server/src/app.module.ts` — `AppRegistryModule.register([])` (пусто до Task 12)
- Modify: `packages/core/src/index.ts` — экспорт токена уже есть; убедиться что `AppRegistryModule` экспортируется

**Interfaces:**
- Consumes: ничего нового.
- Produces: `AppRegistryModule.register(manifests: readonly unknown[]): DynamicModule` — Task 12 передаёт манифест квиза. `.overrideProvider(APP_MANIFESTS)` в существующих e2e продолжает работать (dynamic module provider переопределяется тем же API).

**Почему global:** RealtimeModule и RoomModule инжектят `AppRegistryService`; если провайдер манифестов задаёт composition root, модуль реестра обязан быть global-динамическим, иначе статический импорт без конфигурации инстанцирует сервис без провайдера `APP_MANIFESTS`.

- [ ] **Step 1: Failing test**

`packages/core/src/app-registry/app-registry.module.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { AppRegistryModule } from './app-registry.module';
import { AppRegistryService } from './app-registry.service';

describe('AppRegistryModule.register', () => {
  it('provides the registry from composition-root manifests', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppRegistryModule.register([])] }).compile();
    expect(moduleRef.get(AppRegistryService)).toBeInstanceOf(AppRegistryService);
  });

  it('fails closed on an invalid manifest at boot', async () => {
    await expect(
      Test.createTestingModule({ imports: [AppRegistryModule.register([{ appId: 'core' }])] }).compile(),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/core test -- app-registry.module`
Expected: FAIL (register не существует).

- [ ] **Step 3: Implement**

`app-registry.module.ts`:

```typescript
import { Module, type DynamicModule } from '@nestjs/common';
import { AppRegistryService } from './app-registry.service';
import { APP_MANIFESTS } from './app-registry.tokens';

// Seam фазы 2 (design 2026-09-09 §2): манифесты задаёт composition root, модуль —
// global, чтобы Room/Realtime не импортировали сконфигурированный инстанс повторно.
// Статический импорт AppRegistryModule (без register) — ошибка сборки DI: провайдера
// APP_MANIFESTS в нём больше нет.
@Module({})
export class AppRegistryModule {
  static register(manifests: readonly unknown[]): DynamicModule {
    return {
      module: AppRegistryModule,
      global: true,
      providers: [{ provide: APP_MANIFESTS, useValue: manifests }, AppRegistryService],
      exports: [AppRegistryService],
    };
  }
}
```

В `room.module.ts` и `realtime.module.ts` удалить `AppRegistryModule` из `imports` (и импорт символа). В `apps/server/src/app.module.ts` — `AppRegistryModule.register([])` вместо `AppRegistryModule`. Прогнать `grep -rn "AppRegistryModule" packages apps --include="*.ts" | grep -v dist | grep -v spec` и убрать оставшиеся статические импорты.

- [ ] **Step 4: Run — GREEN**

Run: `pnpm build && pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/server test`
Expected: PASS (e2e с `overrideProvider(APP_MANIFESTS)` зелёные без изменений).

- [ ] **Step 5: Commit**

```bash
git add packages apps
git commit -m "refactor(core): APP_MANIFESTS-seam в composition root — AppRegistryModule.register, global (design 2026-09-09 §2)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

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

### Task 7: core — gateway на диспетчер

**Files:**
- Modify: `packages/core/src/realtime/realtime.gateway.ts:193-243` (handlePublish, удалить `effectiveVisibility`)
- Modify: `packages/core/src/realtime/realtime.module.ts` — провайдеры без изменений, gateway инжектит `AppRuntimeService` (разрешение через global AppRuntimeModule из Task 6; статический импорт не нужен)
- Modify: `packages/core/src/realtime/realtime.gateway.spec.ts` — моки под новый путь
- Modify: `apps/server/test/realtime.e2e-spec.ts` — регистрация passthrough-модуля для TEST_APP
- Modify: `apps/server/src/app.module.ts` — `AppRuntimeModule.register([])` (пусто до Task 12)

**Interfaces:**
- Consumes: `AppRuntimeService.dispatch` (Task 6).
- Produces: путь publish: gateway → dispatcher. Поле `PublishRequest.visibility` для app-типов более не читается (visibility задаёт модуль в AppCommit; ceiling принуждается commit'ом, REQ-CTR-009) — комментарий в коде.

**Почему passthrough в e2e:** с вводом диспетчера app-тип без рантайм-модуля — `MODULE_UNAVAILABLE` (fail-closed). Существующий realtime.e2e публикует `note.posted` напрямую; его TEST_APP получает модуль-заглушку «коммитить вход как есть» (actor: publisher, visibility из манифеста) — семантика фазы 1 сохранена явно.

- [ ] **Step 1: Failing gateway unit spec**

`realtime.gateway.spec.ts`: publish app-типа вызывает `appRuntime.dispatch` с `{ roomId из подписки, actorId из claims, appId, shortName, payload }`; core-тип — по-прежнему `EVENT_UNKNOWN_TYPE` без вызова dispatch; отказ диспетчера (`AppRejection`) → ack `{code}`.

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/core test -- realtime.gateway`
Expected: FAIL.

- [ ] **Step 3: Implement gateway rewiring**

В `handlePublish` после `resolveTypeOwner` и отказа core-неймспейса:

```typescript
      const owner = resolveTypeOwner(parsed.data.type);
      if (owner.kind === 'core') {
        ack({ code: 'EVENT_UNKNOWN_TYPE' });
        return;
      }
      // Командный хост (design 2026-09-09 §2): app-publish исполняется модулем до
      // коммита. request.visibility здесь не читается — набор и видимость коммитов
      // определяет модуль (AppCommit), потолок принуждается commit'ом (REQ-CTR-009).
      await this.appRuntime.dispatch({
        roomId: sub.roomId,
        actorId: claimsOf(socket).sub,
        appId: owner.appId,
        shortName: owner.shortName,
        payload: parsed.data.payload,
      });
      ack({ ok: true });
```

Удалить `effectiveVisibility` и ставшие неиспользуемыми импорты (`EventLogService`/`EventOutbox`/`AppRegistryService` из конструктора — только если более не нужны: `appRegistry` ещё нужен в subscribe для manifest snapshot; `eventLog`/`outbox` из gateway уходят). Конструктор: `- eventLog, - outbox, + appRuntime: AppRuntimeService`.

- [ ] **Step 4: e2e passthrough**

В `realtime.e2e-spec.ts` рядом с TEST_APP:

```typescript
// Passthrough-модуль фазы-1 семантики (design 2026-09-09 §7): коммитит клиентский
// вход как есть, visibility — декларированный потолок типа.
const TEST_APP_MODULE: AppRuntimeModule = {
  appId: TEST_APP.appId,
  manifestVersion: TEST_APP.manifestVersion,
  manifest: TEST_APP,
  initialState: () => ({}),
  reduce: (state) => state,
  handlePublish: (_ctx, shortName, payload) => [
    { shortName, payload, visibility: TEST_APP.events[shortName]!.visibility, actor: 'publisher' as const },
  ],
};
```

`createApp`: `.overrideProvider(APP_RUNTIME_MODULES).useValue([TEST_APP_MODULE])` (добавить к существующему override APP_MANIFESTS; импорт токена из `@mymozhem/core`).

- [ ] **Step 5: Run — GREEN**

Run: `pnpm build && pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/server test`
Expected: PASS (все realtime e2e зелёные на новом пути).

- [ ] **Step 6: Commit**

```bash
git add packages/core apps/server
git commit -m "feat(core): gateway publish → app-runtime диспетчер; passthrough-модуль в realtime e2e

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: core — membership: join с ролью spectator

**Files:**
- Modify: `packages/core/src/membership/membership.service.ts:145-194` (`join`)
- Modify: `packages/core/src/transport/join.controller.ts:27-28`
- Test: `packages/core/src/membership/membership.service.int-spec.ts`

**Interfaces:**
- Consumes: `JoinRequest.role` (Task 2).
- Produces: `MembershipService.join(params: { code; displayName; ip; role?: 'participant' | 'spectator' })`.

**REQ:** REQ-ID-011 (назначение SPECTATOR), REQ-ID-013 (единообразие отказов не трогается).

- [ ] **Step 1: Failing int tests**

В `membership.service.int-spec.ts`:

```typescript
it('join with role spectator creates SPECTATOR membership', async () => {
  const { membership } = await membership.join({ code, displayName: 'Зритель', ip: '10.0.0.9', role: 'spectator' });
  expect(membership.role).toBe('SPECTATOR');
});

it('spectator does not consume the participant limit', async () => {
  // комната заполнена до ROOM_PARTICIPANT_LIMIT участниками (существующий харнесс лимита);
  // join spectator → успех; join participant → ROOM_PARTICIPANT_LIMIT_REACHED (как раньше).
});

it('default join (no role) stays PARTICIPANT', async () => { /* регрессия */ });
```

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/core test:int -- membership`
Expected: FAIL (join не принимает role).

- [ ] **Step 3: Implement**

`membership.service.ts` — сигнатура и создание:

```typescript
  async join(params: { code: string; displayName: string; ip: string; role?: 'participant' | 'spectator' }): Promise<JoinResult> {
```

```typescript
      const membership = await tx.membership.create({
        data: {
          roomId: room.id,
          identityId: identity.id,
          joinIp: params.ip,
          // REQ-ID-011: самоназначение зрителем (фаза 2). Только два wire-значения
          // (SDK-схема), маппинг здесь — единственная точка.
          role: params.role === 'spectator' ? 'SPECTATOR' : 'PARTICIPANT',
        },
      });
```

Лимит участников не меняется: count уже фильтрует `role: 'PARTICIPANT'` — зритель слота не занимает (осознанно: зритель не нагружает арбитраж). `join.controller.ts`: `const { code, displayName, role } = joinRequestSchema.parse(body);` → `this.membership.join({ code, displayName, role, ip: req.ip })`.

- [ ] **Step 4: Run — GREEN**

Run: `pnpm --filter @mymozhem/core test:int -- membership && pnpm --filter @mymozhem/server test -- transport`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): join с самоназначением SPECTATOR (REQ-ID-011); зритель не занимает лимит участников

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: app-quiz — пакет и манифест

**Files:**
- Create: `packages/app-quiz/package.json`, `tsconfig.json`, `jest.config.js` (зеркало `packages/sdk/*`, имя `@mymozhem/app-quiz`, deps: `@mymozhem/sdk: workspace:*`, `zod: ^4.0.0`)
- Create: `packages/app-quiz/src/quiz-settings.ts`
- Create: `packages/app-quiz/src/quiz-events.ts`
- Create: `packages/app-quiz/src/quiz-manifest.ts`
- Create: `packages/app-quiz/src/quiz-manifest.contract.spec.ts`
- Create: `packages/app-quiz/src/index.ts`

**Interfaces:**
- Produces (потребляют Task 10–13):

```typescript
// quiz-settings.ts — appSettings (design §3 с правкой плана: видимость top-level,
// correctAnswers без аннотации → fail-safe module-private, REQ-CORE-008).
export const quizSettingsSchema = z.strictObject({
  questions: z
    .array(z.strictObject({ text: z.string().min(1), options: z.array(z.string().min(1)).min(2) }))
    .min(1)
    .meta({ 'x-visibility': 'public' }),
  correctAnswers: z.array(z.number().int().min(0)),
  minAnswerIntervalMs: z.number().int().min(0).meta({ 'x-visibility': 'public' }),
  scoring: z
    .strictObject({ base: z.number().int().positive(), step: z.number().int().min(0) })
    .meta({ 'x-visibility': 'public' }),
});
export type QuizSettings = z.infer<typeof quizSettingsSchema>;

// quiz-events.ts — payload-схемы (источник типов для handler'ов и манифеста).
export const questionOpenedPayload = z.strictObject({ questionIndex: z.number().int().min(0) });
export const answerSubmittedPayload = z.strictObject({
  questionIndex: z.number().int().min(0),
  optionIndex: z.number().int().min(0),
});
export const questionClosedPayload = z.strictObject({ questionIndex: z.number().int().min(0) });
export const finishGamePayload = z.strictObject({});
export const answerAcceptedPayload = z.strictObject({
  questionIndex: z.number().int().min(0),
  actorId: z.uuid(),
});
export const scoreEntryPayload = z.strictObject({ actorId: z.uuid(), total: z.number().int() });
export const questionRevealedPayload = z.strictObject({
  questionIndex: z.number().int().min(0),
  // Опционально: отсутствует, когда у вопроса не сконфигурирован правильный ответ
  // (correctAnswers[questionIndex] === undefined) — «нет правильного» не выражается
  // sentinel-значением, поле просто опущено.
  correctIndex: z.number().int().min(0).optional(),
  awarded: z.array(z.strictObject({ actorId: z.uuid(), points: z.number().int().min(0) })),
  totals: z.array(scoreEntryPayload),
});
export const gameFinishedPayload = z.strictObject({
  standings: z.array(scoreEntryPayload.extend({ place: z.number().int().min(1) })),
});

// quiz-manifest.ts
export const QUIZ_APP_ID = 'quiz';
export const QUIZ_MANIFEST_VERSION = 1;
export function buildQuizManifest(): AppManifest {
  return defineApp({
    appId: QUIZ_APP_ID,
    manifestVersion: QUIZ_MANIFEST_VERSION,
    appSettings: quizSettingsSchema,
    events: {
      questionOpened: { schema: questionOpenedPayload, visibility: 'public', clientInitiated: true },
      answerSubmitted: { schema: answerSubmittedPayload, visibility: 'module-private', clientInitiated: true },
      questionClosed: { schema: questionClosedPayload, visibility: 'public', clientInitiated: true },
      finishGame: { schema: finishGamePayload, visibility: 'public', clientInitiated: true },
      answerAccepted: { schema: answerAcceptedPayload, visibility: 'public', clientInitiated: false },
      questionRevealed: { schema: questionRevealedPayload, visibility: 'public', clientInitiated: false },
      gameFinished: { schema: gameFinishedPayload, visibility: 'public', clientInitiated: false },
    },
  });
}
```

**REQ:** REQ-CTR-008/009 (регистрация схем + ceilings), REQ-CORE-008 (correctAnswers module-private), REQ-CTR-005 (контрактные тесты манифеста).

- [ ] **Step 1: Failing contract test**

`quiz-manifest.contract.spec.ts`:
1. `buildQuizManifest()` проходит `appManifestSchema` и содержит все 7 типов с ожидаемыми `visibility`/`clientInitiated` (табличный assert).
2. Зарегистрированная JSON Schema appSettings (через Ajv2020, как ядро: `new Ajv2020({ allErrors: true, strict: false })`) — валидный снапshot настроек проходит; невалидные (пустой questions, minAnswerIntervalMs < 0, лишний ключ, options из одного элемента) отклоняются.
3. JSON Schema событий: валидный/невалидный payload каждого типа (например `answerSubmitted` без `optionIndex` отклоняется, с строковым `questionIndex` отклоняется).
4. Видимость `correctAnswers`: `readPropertyVisibility(manifest.appSettings, 'correctAnswers') === 'module-private'` (fail-safe без аннотации), `questions/minAnswerIntervalMs/scoring === 'public'`.

- [ ] **Step 2: Run — RED**

Run: `pnpm install && pnpm --filter @mymozhem/app-quiz test`
Expected: FAIL (исходников нет).

- [ ] **Step 3: Implement** — файлы выше; `index.ts`: `export * from './quiz-settings'; export * from './quiz-events'; export * from './quiz-manifest';`

- [ ] **Step 4: Run — GREEN + boundary**

Run: `pnpm --filter @mymozhem/app-quiz test && pnpm boundary-check`
Expected: PASS; boundary-check зелёный (app-quiz импортирует только sdk/zod).

- [ ] **Step 5: Commit**

```bash
git add packages/app-quiz pnpm-lock.yaml
git commit -m "feat(app-quiz): пакет квиза — манифест, appSettings (correctAnswers module-private), схемы 7 типов событий

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 10: app-quiz — состояние и редьюсер

**Files:**
- Create: `packages/app-quiz/src/quiz-state.ts`
- Test: `packages/app-quiz/src/quiz-state.spec.ts`

**Interfaces:**
- Consumes: `AppLogEvent` (Task 4).
- Produces (потребляет Task 11):

```typescript
export interface QuizState {
  readonly currentQuestion: number | null;
  readonly accepting: boolean;
  readonly openedAt: string | null; // ISO из recordedAt questionOpened — серверное время
  readonly answers: Readonly<Record<string, { optionIndex: number; seq: number }>>; // текущий вопрос, key=actorId
  readonly totals: Readonly<Record<string, number>>;
  readonly finished: boolean;
}
export function initialQuizState(): QuizState;
export function reduceQuiz(state: QuizState, event: AppLogEvent): QuizState;
```

Семантика reduce (чистая, immutable-обновления):
- `questionOpened` → `{ currentQuestion: p.questionIndex, accepting: true, openedAt: event.recordedAt, answers: {} }`
- `answerSubmitted` → `answers[event.actorId] = { optionIndex: p.optionIndex, seq: event.seq }` (actorId не-null по контракту команды)
- `questionClosed` → `accepting: false`
- `questionRevealed` → totals += awarded points
- `gameFinished` → `finished: true`
- `finishGame`, `answerAccepted` → без изменений состояния
- неизвестный shortName → state без изменений (защитная ветка: реестр гарантирует типы, но редьюсер не падает)

**REQ:** ADR-005 (проекция из лога), REQ-CORE-004.

- [ ] **Step 1: Failing unit tests**

`quiz-state.spec.ts`: начальное состояние; открытие вопроса (answers сбрасываются, openedAt из события); запись ответов двух игроков с seq; повторное открытие другого вопроса сбрасывает ответы; начисление очков через `questionRevealed` (суммирование по двум раундам); финиш; неизвестный тип — no-op; иммутабельность (входной state не мутирован — `expect(Object.isFrozen(...))` не требуется, достаточно `expect(state).not.toBe(next)` + глубокое равенство исходного).

- [ ] **Step 2: Run — RED** / **Step 3: Implement** / **Step 4: GREEN**

Run: `pnpm --filter @mymozhem/app-quiz test -- quiz-state`

- [ ] **Step 5: Commit**

```bash
git add packages/app-quiz
git commit -m "feat(app-quiz): состояние и чистый редьюсер проекции (ADR-005)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 11: app-quiz — handlers команд и фабрика рантайм-модуля

**Files:**
- Create: `packages/app-quiz/src/quiz-handlers.ts`
- Create: `packages/app-quiz/src/quiz-runtime.ts`
- Test: `packages/app-quiz/src/quiz-handlers.spec.ts`
- Modify: `packages/app-quiz/src/index.ts`

**Interfaces:**
- Consumes: Tasks 4, 9, 10.
- Produces (потребляют Task 12–13):

```typescript
// quiz-runtime.ts
export function createQuizRuntime(): AppRuntimeModule<QuizState>;
export function createQuizApp(): { manifest: AppManifest; runtime: AppRuntimeModule<QuizState> };
```

Логика `handlePublish(ctx, shortName, payload)` (payload уже проверен схемой диспетчером — каст через `as` к выведенному типу допустим и локален):

- Общее: `settings = quizSettingsSchema.parse(ctx.settings)` (валидировано при configure/activate — повторный parse здесь защитный и дешёвый).
- `questionOpened` (ORGANIZER только — иначе `AppRejection('PUBLISH_FORBIDDEN')`; аналогично `questionClosed`, `finishGame`):
  - `ctx.state.finished` → `ROUND_NOT_OPEN` («игра завершена»); `state.accepting` → `ROUND_NOT_OPEN` («прежний вопрос не закрыт»); `questionIndex >= settings.questions.length` → `QUESTION_UNKNOWN`.
  - commits: `[{ shortName: 'questionOpened', payload, visibility: 'public', actor: 'publisher' }]`.
- `answerSubmitted`:
  - `ctx.actorRole !== 'PARTICIPANT'` → `PUBLISH_FORBIDDEN` (организатор не играет; SPECTATOR отсечён ядром раньше — защитная ветка).
  - `!state.accepting || state.currentQuestion === null` → `ROUND_NOT_OPEN`.
  - `payload.questionIndex !== state.currentQuestion` → `QUESTION_UNKNOWN`.
  - `payload.optionIndex >= settings.questions[state.currentQuestion].options.length` → `OPTION_UNKNOWN`.
  - `state.answers[ctx.actorId] !== undefined` → `ALREADY_ANSWERED`.
  - REQ-RT-013: `minAnswerIntervalMs > 0 && state.openedAt !== null && Date.parse(ctx.now) - Date.parse(state.openedAt) < settings.minAnswerIntervalMs` → `ANSWER_TOO_FAST`.
  - commits: `[answerSubmitted (module-private, publisher), answerAccepted { questionIndex, actorId } (public, server)]`.
- `questionClosed`:
  - `!state.accepting || payload.questionIndex !== state.currentQuestion` → `ROUND_NOT_OPEN`.
  - Скоринг: правильные ответы (`optionIndex === settings.correctAnswers[qi]`; отсутствующий `correctAnswers[qi]` → правильных нет) ранжируются по `seq`; k-й (0-based) получает `max(base − k·step, 0)`. `totals` — из state + awarded.
  - commits: `[questionClosed (public, publisher), questionRevealed { questionIndex, awarded, totals, ...(correctAnswers[qi] !== undefined ? { correctIndex: correctAnswers[qi] } : {}) } (public, server)]` — `correctIndex` опущен, когда ответ не сконфигурирован (схема — Task 9, поле optional).
- `finishGame`:
  - `state.finished` → `ROUND_NOT_OPEN`; (открытый вопрос можно не закрывать — закрытие валится в standings как есть; осознанное упрощение MVP).
  - standings: `Object.entries(state.totals)` по убыванию total, place = 1-based с разделением мест при равенстве (плотный ранг: 1,2,2,3).
  - commits: `[finishGame (public, publisher), gameFinished { standings } (public, server)]`.

**REQ:** REQ-RT-013 (анти-бот), REQ-RT-009 (actorId из ctx), REQ-ID-011 (ролевые гейты), REQ-CTR-009 (visibility явно, в пределах ceiling).

- [ ] **Step 1: Failing unit tests** — `quiz-handlers.spec.ts`, фабрика ctx:

```typescript
const ctx = (over: Partial<AppHostContext<QuizState>>): AppHostContext<QuizState> => ({
  roomId: 'r', actorId: ORG, actorRole: 'ORGANIZER', settings: SETTINGS,
  state: initialQuizState(), now: '2026-09-09T12:00:00.000Z', ...over,
});
```

Тесты (таблица): каждая ветка отказа выше (код ошибки); счастливые пути (точный состав commits включая actor/visibility); анти-бот границы (`interval-1` → отказ, `interval` → принят, `0` → контроль выключен); скоринг (3 правильных по seq → 1000/900/800 при base 1000 step 100; неправильный — 0 и сгорает: повторный `answerSubmitted` → ALREADY_ANSWERED); dense-rank standings; двойной finishGame → отказ; открытие второго вопроса при открытом первом → отказ.

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/app-quiz test -- quiz-handlers`
Expected: FAIL.

- [ ] **Step 3: Implement** handlers + runtime-фабрика (`reduce: reduceQuiz`, `initialState: initialQuizState`, `manifest: buildQuizManifest()`).

- [ ] **Step 4: Run — GREEN + boundary**

Run: `pnpm --filter @mymozhem/app-quiz test && pnpm boundary-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app-quiz
git commit -m "feat(app-quiz): handlers команд квиза — ролевые гейты, анти-бот REQ-RT-013, скоростная шкала, standings

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 12: wiring — квиз в composition root

**Files:**
- Modify: `apps/server/src/app.module.ts`
- Modify: `apps/server/package.json` (dep `@mymozhem/app-quiz: workspace:*`)

**Interfaces:**
- Consumes: `createQuizApp` (Task 11), `AppRegistryModule.register` (Task 5), `AppRuntimeModule.register` (Task 6).

- [ ] **Step 1: Implement**

`app.module.ts`:

```typescript
import { createQuizApp } from '@mymozhem/app-quiz';

const quiz = createQuizApp();

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AppRegistryModule.register([quiz.manifest]),
    AppRuntimeModule.register([quiz.runtime]),
    RoomModule,
    IdentityModule,
    MembershipModule,
    RealtimeModule,
    TransportModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Run — GREEN**

Run: `pnpm install && pnpm build && pnpm typecheck && pnpm --filter @mymozhem/server test`
Expected: PASS (существующие e2e на override'ах не затронуты; `realtime.e2e` override'ит оба токена своими — Quiz в них не участвует).

- [ ] **Step 3: Commit**

```bash
git add apps/server pnpm-lock.yaml
git commit -m "feat(server): квиз в composition root — манифест и рантайм-модуль через register

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 13: quiz e2e — приёмка фазы 2

**Files:**
- Create: `apps/server/test/quiz.e2e-spec.ts`

**Interfaces:**
- Consumes: всё выше; харнесс `realtime.e2e-spec.ts` (createApp/connect/emitAck/waitEvent/seedIdentity, `app.get(RoomService)` и т.д.).

Содержание (каждый `it` — сценарий; общий `beforeAll`: testcontainers БД, app с overrides `APP_MANIFESTS=[quiz manifest]`, `APP_RUNTIME_MODULES=[createQuizRuntime()]`, `seedIdentity(ORG)`). Базовые helper'ы:

```typescript
// Комната квиза в ACTIVE (сервисный путь, прецедент realtime.e2e: configure обязателен
// до activate; HTTP-эндпоинта configure нет — срез его не добавляет, design §1).
async function activeQuizRoom(settings: QuizSettings): Promise<string> {
  const room = await roomService.create(ORG);
  await roomService.configure(room.id, { appId: QUIZ_APP_ID, manifestVersion: QUIZ_MANIFEST_VERSION, settings });
  await roomService.activate(room.id);
  return room.id;
}

const QUIZ_SETTINGS: QuizSettings = {
  questions: [
    { text: '2+2?', options: ['3', '4'] },
    { text: 'Столица Франции?', options: ['Лион', 'Париж'] },
  ],
  correctAnswers: [1, 1],
  minAnswerIntervalMs: 0,
  scoring: { base: 1000, step: 100 },
};

// Гость через HTTP (транспортный путь): POST /rooms/join → accessToken → connect.
async function joinGuest(roomCode: string, name: string, role?: 'spectator'): Promise<{ socket: ClientSocket; token: string }> {
  const res = await app.inject({
    method: 'POST', url: '/rooms/join',
    payload: { code: roomCode, displayName: name, ...(role ? { role } : {}) },
  });
  const { accessToken } = res.json() as { accessToken: string };
  return { socket: await connect(port, accessToken), token: accessToken };
}
```

Организатор на ws: токен через `app.get(TokenService).issueRegisteredTokens(ORG)` (прецедент realtime.e2e «путь развёрнут вручную»); `roomService.create(ORG)` требует REGISTERED-identity — `seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' })`.

Сценарии:

1. **Полная игра** (приёмочный сценарий): настройки `QUIZ_SETTINGS`, 2 гостя (P1, P2) + организатор на ws, все подписаны. Организатор `questionOpened(0)` → оба отвечают: P1 верно (optionIndex 1), P2 неверно (0) → live `answerAccepted` у всех (public, без optionIndex) → `questionClosed(0)` → live `questionRevealed` с `correctIndex: 1` и `awarded: [{ P1, 1000 }]` → `questionOpened(1)` → оба отвечают верно, P2 первым (упорядочить через await ack P2 до publish P1) → close → `questionRevealed`: awarded=[{P2,1000},{P1,900}] → `finishGame` → `gameFinished` standings: P1 total 1900 place 1, P2 total 1000 place 2. Гость, не отвечавший ни разу (P3), присутствует в standings с total 0 только если отвечал хоть раз — нет: standings строятся из totals редьюсера, P3 в них не попадает (зафиксировать это поведение в assert). Порядок live-событий у клиента совпадает с порядком в логе (`readRoomLog`).
2. **Чит-тест** (критерий выхода): в сценарии 1 до `questionRevealed` — ни один кадр/ack/snapshot, полученный участником, не содержит значение correctIndex (проверка сериализацией: `JSON.stringify(frame)` не содержит `"correctIndex"`; snapshot.appSettings не содержит `correctAnswers`). Повторный `subscribe` (replay) после первого раунда: в snapshot есть `questionRevealed` раунда 0 (раскрыт легально), нет `answerSubmitted` (module-private) и нет `correctAnswers`. Организаторский snapshot тоже без `correctAnswers` (module-private не отдаётся никому).
3. **Late-join участника** в ACTIVE в середине раунда: snapshot содержит текущий открытый вопрос (public), участник отвечает успешно.
4. **Late-join зрителя**: join `role: 'spectator'` → subscribe ok, snapshot public; publish `answerSubmitted` → ack `{ code: 'PUBLISH_FORBIDDEN' }`; в логе ничего не прибавилось.
5. **Анти-бот (REQ-RT-013)**: комната с `minAnswerIntervalMs: 60_000` → ответ сразу после открытия → `{ code: 'ANSWER_TOO_FAST' }`, в логе нет answerSubmitted. Комната с `0` → ответ принят.
6. **Конкурентный double-answer одного участника**: два параллельных publish → ровно один `ok`, другой `ALREADY_ANSWERED`; `readRoomLog` — ровно один `quiz.answerSubmitted` от этого actorId.
7. **Ролевые гейты**: участник publish `questionOpened` → `PUBLISH_FORBIDDEN`; участник `finishGame` → `PUBLISH_FORBIDDEN`.
8. **Пересоздание проекции**: после раунда 0 `app.get(AppRuntimeService).invalidateProjection(roomId)` → следующий `answerSubmitted` обрабатывается (replay восстановил состояние), очки в `questionRevealed` сходятся с ожиданием (включают раунд 0).
9. **Запечатанная комната**: `RoomService.transition` в COMPLETED (как в существующих тестах) → publish → отказ (`ROOM_LOG_SEALED`).

- [ ] **Step 1: Failing e2e (скелет сценария 1)**

Run: `pnpm --filter @mymozhem/server test -- quiz`
Expected: FAIL (файла нет → после создания: зелёный прогон = критерий).

- [ ] **Step 2: Implement все сценарии; прогон до зелёного.** Ожидаемые красные точки: тайминги (использовать `waitEvent` до `emitAck`, как в realtime.e2e), standings при нулевых очках (гость без правильных ответов присутствует в standings с total 0 — включить в сценарий 1).

- [ ] **Step 3: Run — GREEN**

Run: `pnpm --filter @mymozhem/server test -- quiz`
Expected: 9/9 PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server
git commit -m "test(app-quiz): приёмочные e2e квиза — полная игра, чит-тест, анти-бот, гонки, SPECTATOR, replay (критерии фазы 2)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 14: Финал среза — полный конвейер + handoff

- [ ] **Step 1:** `pnpm build && pnpm lint && pnpm typecheck && pnpm boundary-check && pnpm guardrails && pnpm test:int && pnpm test` — всё зелёное. Если `scripts/verify-guardrails.mjs` содержит список пакетов/правил — дополнить `app-quiz` по образцу (прочитать скрипт перед прогоном).
- [ ] **Step 2:** Двухстадийное ревью среза (superpowers:requesting-code-review): стадия 1 — spec-compliance против REQ-CTR-001/002/003/004/005/008/009, REQ-CORE-004/005/008, REQ-RT-004/007/009/013, REQ-ID-011 (SPECTATOR) и критериев выхода фазы 2 (пакет §5); стадия 2 — code-quality.
- [ ] **Step 3:** Обновить HANDOFF: срез закрыт, сверка критериев фазы 2 (по образцу `2026-09-09-phase-1-exit-audit.md`), LOC-снапшот, следующий срез — выбор владельца. Push НЕ выполнять.
- [ ] **Step 4: Commit** handoff.

```bash
git add docs
git commit -m "docs(handoff): Quiz-срез закрыт — сверка критериев фазы 2, следующее — решение владельца

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
