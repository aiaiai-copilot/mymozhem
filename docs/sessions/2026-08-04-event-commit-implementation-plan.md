# Event-commit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Запись app-событий в event log ядра — `EventLogService.commitAppEvent` с полной commit-цепочкой (status-гейт, rate-limit, размер, реестр, схема, видимость, membership) поверх неизменного append-примитива, плюс проводка actorId в lifecycle-эмит.

**Architecture:** Подход A утверждённого дизайна (`docs/sessions/2026-08-03-event-commit-design.md`): цепочка проверок живёт в `EventLogService`, критическая секция (advisory lock + атомарный seq) выносится в приватный общий `appendLocked`, используемый обоими методами. Все проверки — ДО lock (payload-нейтральность, REQ-RT-007). Лимитер — отдельный класс по паттерну `JoinRateLimiter`. Валидация app-схем — в `AppRegistryService` (ajv инкапсулирован там).

**Tech Stack:** NestJS, Prisma (PostgreSQL, multiSchema), zod, ajv (draft 2020-12), jest + testcontainers, pnpm + turbo.

## Global Constraints

- Дизайн утверждён: `docs/sessions/2026-08-03-event-commit-design.md`, §0 — решения владельца (только core-service API, membership-гейт, actorId в lifecycle в скоупе, подход A). Не переоткрывать.
- **Новых миграций НЕТ** — модель `realtime."LogEvent"` достаточна.
- **Новых runtime-зависимостей НЕТ** — ajv уже в core; Buffer — Node API.
- **SDK-контракт не меняется** (остаётся 1.1.0): новых схем/кодов в SDK не добавляем; `isWithinCeiling` и тип `Visibility` переиспользуются из `@mymozhem/sdk`.
- REQ в скоупе: REQ-RT-007, REQ-RT-009 (service-уровень), REQ-RT-012, REQ-RT-014 (объём v1.3: только per-actor хард), REQ-RT-016, REQ-CTR-008, REQ-CTR-009, REQ-OPS-003.
- Эмит только в ACTIVE; DRAFT и терминальные — один код `ROOM_NOT_ACTIVE` (запечатывание REQ-RT-016).
- `actorId = null` допустим (серверные эмиссии): membership-гейт и per-actor лимит не применяются.
- Лимитом считаются **попытки**, не только успешные commit.
- Дефолты конфига из §4 пакета: `EVENT_EMIT_RATE_LIMIT_PER_MIN` = 30 (≥1), `MAX_EVENT_PAYLOAD_BYTES` = 16384 (1024…262144).
- Конвенция порядка блокировок: advisory lock комнаты — всегда leaf-most (HANDOFF «Долгоживущие ограничения»).
- Jest-фильтр: форма `pnpm --filter @mymozhem/core test:int -t "..."` БЕЗ `--` (HANDOFF-ловушка). Проверять, что фильтр матчит >0 тестов.
- Docker Desktop нужен для int-спек (testcontainers).
- Коммит-стиль репозитория: `feat(core): …`, `test(core): …`, `refactor(core): …` с REQ-якорями.

## Отступления от буквы дизайна (implementation-уровень, дух сохранён)

- Helper порядка видимости НЕ создаётся: `isWithinCeiling` уже существует в `packages/sdk/src/visibility/visibility.ts` (дизайн §2 шаг 6 его «предполагал»).
- Метод лимитера называется `tryAcquire` (идиома `JoinRateLimiter`), не `consume` — семантика дизайна §3 та же.
- Фикстурный манифест `test-app@1` — сырым JSON-манифестом в int-спеке (паттерн `validManifests` из SDK), не через `defineApp`: `defineApp` — конвертер zod→JSON Schema для app-модулей, core-тесты оперируют уже конвертированной формой.

---

### Task 1: Конфиг-параметры эмиссии

**Files:**
- Modify: `packages/core/src/config/config.schema.ts`
- Test: `packages/core/src/config/config.schema.spec.ts`
- Modify: `packages/core/src/testing/test-config.ts`

**Interfaces:**
- Produces: `AppConfig.EVENT_EMIT_RATE_LIMIT_PER_MIN: number` (default 30), `AppConfig.MAX_EVENT_PAYLOAD_BYTES: number` (default 16384) — потребляются Task 2 (factory лимитера) и Task 5 (цепочка).

- [ ] **Step 1: Write the failing tests**

В `packages/core/src/config/config.schema.spec.ts` добавить (стиль существующих кейсов файла — посмотреть соседние `it` для формы вызова `configSchema.parse`/`safeParse`):

```ts
it('applies §4 defaults for event emission params', () => {
  const cfg = configSchema.parse({
    DATABASE_URL: 'postgresql://x',
    JWT_SECRET: 'x'.repeat(32),
  });
  expect(cfg.EVENT_EMIT_RATE_LIMIT_PER_MIN).toBe(30);
  expect(cfg.MAX_EVENT_PAYLOAD_BYTES).toBe(16_384);
});

it('rejects out-of-range event emission params (REQ-RT-012/014, §4 bounds)', () => {
  const base = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 'x'.repeat(32) };
  expect(configSchema.safeParse({ ...base, EVENT_EMIT_RATE_LIMIT_PER_MIN: 0 }).success).toBe(false);
  expect(configSchema.safeParse({ ...base, MAX_EVENT_PAYLOAD_BYTES: 512 }).success).toBe(false);
  expect(configSchema.safeParse({ ...base, MAX_EVENT_PAYLOAD_BYTES: 300_000 }).success).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mymozhem/core test -t "event emission params"`
Expected: FAIL — `EVENT_EMIT_RATE_LIMIT_PER_MIN` не существует в типе/выводе. Убедиться, что фильтр матчит 2 теста (`2 failed` в выводе, не `0 tests`).

- [ ] **Step 3: Add the two params to configSchema**

В `packages/core/src/config/config.schema.ts` после `REFRESH_RATE_LIMIT`:

```ts
  // REQ-RT-014 (§4 event_emit_rate_limit): эмиссия app-событий, 30/мин на actor (≥ 1).
  EVENT_EMIT_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(30),
  // REQ-RT-012 (§4 max_event_payload): 16 КБ, диапазон 1 КБ … 256 КБ (байты).
  MAX_EVENT_PAYLOAD_BYTES: z.coerce.number().int().min(1024).max(262_144).default(16_384),
```

И в `packages/core/src/testing/test-config.ts` в литерал `TEST_CONFIG`:

```ts
  EVENT_EMIT_RATE_LIMIT_PER_MIN: 30,
  MAX_EVENT_PAYLOAD_BYTES: 16_384,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @mymozhem/core test -t "event emission params"` → PASS (2 теста).
Run: `pnpm --filter @mymozhem/core test` → весь unit-suite зелёный.
Run: `pnpm typecheck` → зелёный (TEST_CONFIG типизирован `AppConfig` — без Step 3 второй части был бы type error).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config/config.schema.ts packages/core/src/config/config.schema.spec.ts packages/core/src/testing/test-config.ts
git commit -m "feat(core): config params EVENT_EMIT_RATE_LIMIT_PER_MIN/MAX_EVENT_PAYLOAD_BYTES (REQ-RT-012/014, §4)"
```

---

### Task 2: EventEmitLimiter

**Files:**
- Create: `packages/core/src/realtime/event-emit-limiter.ts`
- Test: `packages/core/src/realtime/event-emit-limiter.spec.ts`

**Interfaces:**
- Consumes: `AppConfig.EVENT_EMIT_RATE_LIMIT_PER_MIN` (Task 1 — в factory, Task 4).
- Produces: `class EventEmitLimiter { constructor(limit: number, windowMs?: number, now?: () => number); tryAcquire(key: string): boolean }` — потребляется `EventLogService` (Task 4-5). Паттерн — точная копия дисциплины `packages/core/src/membership/join-rate-limiter.ts`.

- [ ] **Step 1: Write the failing tests**

Создать `packages/core/src/realtime/event-emit-limiter.spec.ts`:

```ts
import { EventEmitLimiter } from './event-emit-limiter';

describe('EventEmitLimiter', () => {
  it('allows up to limit attempts in the window, then rejects (REQ-RT-014)', () => {
    const now = { t: 1_000 };
    const limiter = new EventEmitLimiter(2, 60_000, () => now.t);
    expect(limiter.tryAcquire('room:actor')).toBe(true);
    expect(limiter.tryAcquire('room:actor')).toBe(true);
    expect(limiter.tryAcquire('room:actor')).toBe(false);
  });

  it('resets after the window', () => {
    const now = { t: 1_000 };
    const limiter = new EventEmitLimiter(1, 60_000, () => now.t);
    expect(limiter.tryAcquire('room:actor')).toBe(true);
    expect(limiter.tryAcquire('room:actor')).toBe(false);
    now.t += 61_000;
    expect(limiter.tryAcquire('room:actor')).toBe(true);
  });

  it('isolates keys: one actor\'s flood does not burn another\'s budget', () => {
    const limiter = new EventEmitLimiter(1, 60_000);
    expect(limiter.tryAcquire('room:a')).toBe(true);
    expect(limiter.tryAcquire('room:a')).toBe(false);
    expect(limiter.tryAcquire('room:b')).toBe(true);
    expect(limiter.tryAcquire('other-room:a')).toBe(true);
  });

  it('lazy sweep evicts expired entries at most once per window', () => {
    const now = { t: 1_000 };
    const limiter = new EventEmitLimiter(10, 60_000, () => now.t);
    limiter.tryAcquire('one-shot');
    now.t += 120_000; // два окна спустя sweep обязан вычистить ключ
    limiter.tryAcquire('trigger-sweep');
    expect((limiter as unknown as { attempts: Map<string, unknown> }).attempts.has('one-shot')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mymozhem/core test -t "EventEmitLimiter"`
Expected: FAIL — модуль `./event-emit-limiter` не существует. Фильтр матчит 4 теста.

- [ ] **Step 3: Implement the limiter**

Создать `packages/core/src/realtime/event-emit-limiter.ts`:

```ts
// Per-actor fixed-window limiter for app-event emission (REQ-RT-014,
// event_emit_rate_limit; объём фазы 1 по амендменту v1.3 — только хард per-actor,
// soft cap/алерты/режимы — фаза 4). Дисциплина состояния — как у JoinRateLimiter:
// поле экземпляра, не module-level (REQ-CORE-004); in-memory корректен при одной
// реплике (REQ-OPS-005); рестарт сбрасывает окно — принято. Ключ — `${roomId}:${actorId}`:
// флуд актора жжёт только его бюджет. Ленивый sweep не чаще раза в окно —
// one-shot ключи не копятся на жизнь процесса.
export class EventEmitLimiter {
  private readonly attempts = new Map<string, { windowStart: number; count: number }>();
  private lastSweep: number;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.lastSweep = this.now();
  }

  // Записывает попытку и возвращает, разрешена ли она. Лимитом считаются ПОПЫТКИ,
  // не только успешные commit (design §2 шаг 2): невалидные payload тоже жгут бюджет.
  tryAcquire(key: string): boolean {
    const now = this.now();
    if (now - this.lastSweep >= this.windowMs) {
      for (const [k, entry] of this.attempts) {
        if (now - entry.windowStart >= this.windowMs) this.attempts.delete(k);
      }
      this.lastSweep = now;
    }
    const entry = this.attempts.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.attempts.set(key, { windowStart: now, count: 1 });
      return true;
    }
    if (entry.count >= this.limit) {
      return false;
    }
    entry.count += 1;
    return true;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @mymozhem/core test -t "EventEmitLimiter"` → PASS (4 теста).
Run: `pnpm --filter @mymozhem/core lint` → зелёный.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/realtime/event-emit-limiter.ts packages/core/src/realtime/event-emit-limiter.spec.ts
git commit -m "feat(core): EventEmitLimiter — per-actor hard rate limit эмиссии (REQ-RT-014, объём v1.3)"
```

---

### Task 3: Realtime-ошибки + event-методы AppRegistryService

**Files:**
- Create: `packages/core/src/realtime/realtime.errors.ts`
- Modify: `packages/core/src/app-registry/app-registry.service.ts`
- Test: `packages/core/src/app-registry/app-registry.service.spec.ts`

**Interfaces:**
- Consumes: `AppManifest['events'][string]` (SDK), `isWithinCeiling` из `@mymozhem/sdk` (НЕ тестируется здесь — уже покрыт SDK-спекой).
- Produces:
  - `REALTIME_ERROR_CODES` + классы `RealtimeError`, `RoomNotActiveError`, `EventEmitRateLimitedError`, `EventPayloadTooLargeError`, `EventTypeUnknownError`, `EventPayloadInvalidError`, `EventVisibilityExceededError`, `ActorNotMemberError` — потребляет Task 5.
  - `AppRegistryService.getEventDefinition(appId: string, manifestVersion: number, name: string): AppManifest['events'][string] | undefined`
  - `AppRegistryService.eventValidatorFor(appId: string, manifestVersion: number, name: string, schema: JsonSchemaObject): ValidateFunction`
  - `AppRegistryService.describeEventErrors(validate: ValidateFunction): string`

- [ ] **Step 1: Write the failing tests**

В `packages/core/src/app-registry/app-registry.service.spec.ts` добавить describe (импорты `ValidateFunction` не нужен в спеке — работаем через публичные методы):

```ts
describe('event-commit read-path (REQ-CTR-008/009)', () => {
  it('getEventDefinition returns schema+visibility for a known type, undefined for unknown', () => {
    const svc = new AppRegistryService([validManifests[0]]);
    const def = svc.getEventDefinition('quiz', 1, 'answer.submitted');
    expect(def?.visibility).toBe('module-private');
    expect(def?.schema).toMatchObject({ type: 'object' });
    expect(svc.getEventDefinition('quiz', 1, 'answer.v2')).toBeUndefined();
    expect(svc.getEventDefinition('nope', 1, 'answer.submitted')).toBeUndefined();
  });

  it('eventValidatorFor compiles, caches and validates the registered schema', () => {
    const svc = new AppRegistryService([validManifests[0]]);
    const def = svc.getEventDefinition('quiz', 1, 'answer.submitted');
    if (!def) throw new Error('fixture must define answer.submitted');
    const v1 = svc.eventValidatorFor('quiz', 1, 'answer.submitted', def.schema);
    const v2 = svc.eventValidatorFor('quiz', 1, 'answer.submitted', def.schema);
    expect(v1).toBe(v2); // кэш REQ-CORE-007
    expect(v1({ roundId: 'r1', choice: 2 })).toBe(true);
    expect(v1({ roundId: 'r1', choice: 'x' })).toBe(false);
  });

  it('describeEventErrors renders ajv errors after a failed validation', () => {
    const svc = new AppRegistryService([validManifests[0]]);
    const def = svc.getEventDefinition('quiz', 1, 'answer.submitted');
    if (!def) throw new Error('fixture must define answer.submitted');
    const v = svc.eventValidatorFor('quiz', 1, 'answer.submitted', def.schema);
    expect(v({})).toBe(false);
    expect(svc.describeEventErrors(v)).toMatch(/roundId|required/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mymozhem/core test -t "event-commit read-path"`
Expected: FAIL — `getEventDefinition` не существует. Фильтр матчит 3 теста.

- [ ] **Step 3a: Create realtime errors**

Создать `packages/core/src/realtime/realtime.errors.ts`:

```ts
// Core-internal typed errors of the event-commit chain (design §6). Не часть
// SDK-контракта: wire-маппинг придёт с realtime-транспортом (EVENT_EMIT_RATE_LIMITED
// → единый RATE_LIMITED по конвенции transport-среза).
export const REALTIME_ERROR_CODES = {
  ROOM_NOT_ACTIVE: 'ROOM_NOT_ACTIVE',
  EVENT_EMIT_RATE_LIMITED: 'EVENT_EMIT_RATE_LIMITED',
  EVENT_PAYLOAD_TOO_LARGE: 'EVENT_PAYLOAD_TOO_LARGE',
  EVENT_TYPE_UNKNOWN: 'EVENT_TYPE_UNKNOWN',
  // Строковый паритет с кодом ContractError SDK (commitCoreEvent): будущий транспорт
  // отобразит code→code 1:1.
  EVENT_PAYLOAD_INVALID: 'EVENT_PAYLOAD_INVALID',
  EVENT_VISIBILITY_EXCEEDED: 'EVENT_VISIBILITY_EXCEEDED',
  ACTOR_NOT_MEMBER: 'ACTOR_NOT_MEMBER',
} as const;

export type RealtimeErrorCode = (typeof REALTIME_ERROR_CODES)[keyof typeof REALTIME_ERROR_CODES];

export class RealtimeError extends Error {
  constructor(
    readonly code: RealtimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

// Эмит не в ACTIVE: DRAFT, терминальная (запечатывание REQ-RT-016), удалённая или
// отсутствующая комната — причины свёрнуты в один код (точность — в message).
export class RoomNotActiveError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.ROOM_NOT_ACTIVE, message);
  }
}

// REQ-RT-014: превышен per-actor хард rate-limit эмиссии — отказ, не алерт.
export class EventEmitRateLimitedError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.EVENT_EMIT_RATE_LIMITED, message);
  }
}

// REQ-RT-012: payload больше max_event_payload.
export class EventPayloadTooLargeError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.EVENT_PAYLOAD_TOO_LARGE, message);
  }
}

// REQ-CTR-008: тип события отсутствует в пиннутом манифесте.
export class EventTypeUnknownError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.EVENT_TYPE_UNKNOWN, message);
  }
}

// REQ-CTR-008: payload не соответствует зарегистрированной схеме владельца типа.
export class EventPayloadInvalidError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.EVENT_PAYLOAD_INVALID, message);
  }
}

// REQ-CTR-009: фактическая видимость слабее декларированного для типа потолка.
export class EventVisibilityExceededError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.EVENT_VISIBILITY_EXCEEDED, message);
  }
}

// Membership-гейт (design §0): actorId не член комнаты.
export class ActorNotMemberError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.ACTOR_NOT_MEMBER, message);
  }
}
```

- [ ] **Step 3b: Add event methods to AppRegistryService**

В `packages/core/src/app-registry/app-registry.service.ts` добавить публичные методы (после `validateSettings`):

```ts
  // REQ-CTR-008/009 read-path для event-commit цепочки: схема + декларированный
  // потолок видимости типа из манифеста. undefined = неизвестный тип/манифест.
  getEventDefinition(
    appId: string,
    manifestVersion: number,
    name: string,
  ): AppManifest['events'][string] | undefined {
    return this.registry.getManifest(appId, manifestVersion)?.events[name];
  }

  // Валидаторы app-событий — в том же кэше, что appSettings (REQ-CORE-007), с
  // префиксом ключа, чтобы не пересекаться с ключом настроек `appId@version`.
  eventValidatorFor(
    appId: string,
    manifestVersion: number,
    name: string,
    schema: JsonSchemaObject,
  ): ValidateFunction {
    const key = `event:${appId}@${manifestVersion}:${name}`;
    const cached = this.validators.get(key);
    if (cached) {
      return cached;
    }
    const compiled = this.ajv.compile(schema);
    this.validators.set(key, compiled);
    return compiled;
  }

  describeEventErrors(validate: ValidateFunction): string {
    return this.ajv.errorsText(validate.errors);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @mymozhem/core test -t "event-commit read-path"` → PASS (3 теста).
Run: `pnpm --filter @mymozhem/core test` → весь suite зелёный. `pnpm typecheck` → зелёный.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/realtime/realtime.errors.ts packages/core/src/app-registry/app-registry.service.ts packages/core/src/app-registry/app-registry.service.spec.ts
git commit -m "feat(core): realtime errors + event read-path в AppRegistryService (REQ-CTR-008/009)"
```

---

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

### Task 6: Rate-limit в цепочке — int-тесты

**Files:**
- Test: `packages/core/src/realtime/event-commit.int-spec.ts` (добавить describe)

**Interfaces:**
- Consumes: `commitAppEvent` (Task 5), `EventEmitLimiter` с малым лимитом в конструкции сервиса.

- [ ] **Step 1: Write the failing tests**

В `event-commit.int-spec.ts` добавить второй describe (внешний `afterEach` truncate действует на оба):

```ts
describe('EventLogService.commitAppEvent — rate limit (REQ-RT-014)', () => {
  let db: TestDb;
  let rooms: RoomService;
  let limitedLog: EventLogService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    await seedIdentity(db.prisma, { id: P1, kind: 'GUEST' });
    await seedIdentity(db.prisma, { id: P2, kind: 'GUEST' });
    const registry = new AppRegistryService([TEST_APP]);
    limitedLog = new EventLogService(registry, new EventEmitLimiter(3), TEST_CONFIG);
    rooms = new RoomService(
      db.prisma,
      limitedLog,
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

  async function activeRoomWithP1P2() {
    const room = await rooms.create(ORG);
    await rooms.configure(room.id, { appId: 'test-app', manifestVersion: 1, settings: { label: 'x' } });
    await rooms.activate(room.id);
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' } });
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: P2, role: 'PARTICIPANT' } });
    return room;
  }

  it('4th attempt in the window is rejected; other actor and null actor unaffected', async () => {
    const room = await activeRoomWithP1P2();
    const emit = (actor: string | null) =>
      db.prisma.$transaction((tx) =>
        limitedLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', actor),
      );

    await emit(P1);
    await emit(P1);
    await emit(P1);
    const err = await emit(P1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EventEmitRateLimitedError);

    await emit(P2);   // другой actor — свой бюджет
    await emit(null); // серверная эмиссия — вне per-actor лимита

    const log = await readRoomLog(db.prisma, room.id);
    expect(log).toHaveLength(1 /* activated */ + 3 + 2);
  });

  it('failed attempts burn the budget too (attempts counted, not just successes)', async () => {
    const room = await activeRoomWithP1P2();
    // 3 попытки с невалидным payload (отказ по схеме — после шага лимитера)
    for (let i = 0; i < 3; i++) {
      const e = await db.prisma
        .$transaction((tx) =>
          limitedLog.commitAppEvent(tx, room.id, 'note.posted', { blob: 1 }, 'public', P1),
        )
        .catch((e: unknown) => e);
      expect(e).toBeInstanceOf(EventPayloadInvalidError);
    }
    const err = await db.prisma
      .$transaction((tx) =>
        limitedLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', P1),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EventEmitRateLimitedError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mymozhem/core test:int -t "rate limit"`
Expected: эти тесты ПРОЙДУТ сразу (цепочка Task 5 уже содержит шаг лимитера) — это осознанно: поведение реализовано в Task 5, здесь — характеризующие тесты на граничные семантики (per-actor изоляция, null-actor, подсчёт попыток). Если какой-то падает — чинить `commitAppEvent` до зелёного. Проверить, что фильтр матчит оба новых теста (в выводе jest видно имена).

- [ ] **Step 3: Run full suites**

Run: `pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core test:int` → зелёные.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/realtime/event-commit.int-spec.ts
git commit -m "test(core): rate-limit семантика commitAppEvent — per-actor изоляция, null-actor, подсчёт попыток (REQ-RT-014)"
```

---

### Task 7: actorId в lifecycle-эмит

**Files:**
- Modify: `packages/core/src/room/room.service.ts` (`transition`, `activate`, `complete`, `cancel`)
- Test: `packages/core/src/realtime/event-log.int-spec.ts` (добавить тест)

**Interfaces:**
- Consumes: `commitCoreEvent(tx, roomId, name, payload, actorId)` — 5-й параметр существует.
- Produces: `RoomService.transition(roomId: string, to: RoomStatus, actorId?: string | null)`, `activate/complete/cancel(roomId, actorId?)` — обратная совместимость (дефолт null), callers не ломаются.

- [ ] **Step 1: Write the failing test**

В `packages/core/src/realtime/event-log.int-spec.ts` в существующий describe добавить:

```ts
it('records actorId on lifecycle events when the caller supplies it (REQ-RT-009)', async () => {
  const ACTOR = '00000000-0000-0000-0000-0000000000c3';
  await seedIdentity(db.prisma, { id: ACTOR, email: 'actor@example.test' });
  const room = await rooms.create(ORG);
  await rooms.cancel(room.id, ACTOR);

  const log = await readRoomLog(db.prisma, room.id);
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ type: 'core.room.cancelled', actorId: ACTOR });
});
```

Импорт `seedIdentity` уже есть в файле.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/core test:int -t "records actorId on lifecycle"`
Expected: FAIL — `rooms.cancel` принимает 1 аргумент (TS error), либо actorId в логе null. Фильтр матчит 1 тест.

- [ ] **Step 3: Thread actorId through transition**

В `packages/core/src/room/room.service.ts`:

```ts
  // actorId — актор перехода из auth-контекста вызывающего (REQ-RT-009); null у
  // вызывающих без auth-контекста (seed-скрипт, системные вызовы).
  async transition(roomId: string, to: RoomStatus, actorId: string | null = null): Promise<Room> {
```

Внутри: оба вызова `commitCoreEvent` получают 5-м аргументом `actorId` (ветка `'room.activated'` и ветка `LIFECYCLE_EVENTS[to]`). Обертки:

```ts
  activate(roomId: string, actorId: string | null = null): Promise<Room> {
    return this.transition(roomId, 'ACTIVE', actorId);
  }

  complete(roomId: string, actorId: string | null = null): Promise<Room> {
    return this.transition(roomId, 'COMPLETED', actorId);
  }

  cancel(roomId: string, actorId: string | null = null): Promise<Room> {
    return this.transition(roomId, 'CANCELLED', actorId);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @mymozhem/core test:int -t "records actorId on lifecycle"` → PASS.
Run: `pnpm --filter @mymozhem/core test:int && pnpm --filter @mymozhem/server test` → зелёные (обратная совместимость callers).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/room/room.service.ts packages/core/src/realtime/event-log.int-spec.ts
git commit -m "feat(core): actorId в lifecycle-эмит через transition (REQ-RT-009, service-уровень)"
```

---

### Task 8: Конкуренция и payload-нейтральность (критерий выхода ф.1)

**Files:**
- Test: `packages/core/src/realtime/event-commit.int-spec.ts` (добавить describe)

**Interfaces:**
- Consumes: `commitAppEvent` (Task 5), фикстурный `TEST_APP` (`note.posted` с открытым `blob`).

- [ ] **Step 1: Write the tests**

В `event-commit.int-spec.ts` добавить describe:

```ts
describe('EventLogService.commitAppEvent — concurrency (REQ-RT-007)', () => {
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

  async function activeRoomWithP1P2() {
    const room = await rooms.create(ORG);
    await rooms.configure(room.id, { appId: 'test-app', manifestVersion: 1, settings: { label: 'x' } });
    await rooms.activate(room.id);
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' } });
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: P2, role: 'PARTICIPANT' } });
    return room;
  }

  it('serializes concurrent app commits: dense seqs after activation', async () => {
    const room = await activeRoomWithP1P2();
    const N = 8;

    const committed = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        db.prisma.$transaction((tx) =>
          eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: i }, 'public', P1),
        ),
      ),
    );

    // seq 1 — core.room.activated; app-события занимают ровно {2..N+1}.
    expect(new Set(committed.map((e) => e.seq))).toEqual(
      new Set(Array.from({ length: N }, (_, i) => i + 2)),
    );
    expect((await readRoomLog(db.prisma, room.id)).map((e) => e.seq)).toEqual(
      Array.from({ length: N + 1 }, (_, i) => i + 1),
    );
  });

  it('payload-neutrality: mixed-size races stay dense and all-valid', async () => {
    // Отложенный тест lifecycle-среза (§10). Принуждаемое свойство: валидация —
    // до lock (design §2), поэтому размер payload не меняет исход гонки — обе
    // записи валидны, seq плотные при любом порядке старта. Порядок захвата lock
    // black-box не наблюдаем; детерминированно проверяем контракт на смешанных
    // размерах с чередованием порядка старта.
    const room = await activeRoomWithP1P2();
    const ROUNDS = 20;
    const big = { n: 1, blob: 'x'.repeat(8000) }; // < MAX_EVENT_PAYLOAD_BYTES
    const small = { n: 2 };

    for (let round = 0; round < ROUNDS; round++) {
      const bigFirst = round % 2 === 0;
      const bigEmit = () =>
        db.prisma.$transaction((tx) =>
          eventLog.commitAppEvent(tx, room.id, 'note.posted', big, 'public', P1),
        );
      const smallEmit = () =>
        db.prisma.$transaction((tx) =>
          eventLog.commitAppEvent(tx, room.id, 'note.posted', small, 'public', P2),
        );
      // Чередуем порядок СТАРТА (создания промисов): bigFirst либо smallFirst.
      const first = bigFirst ? bigEmit : smallEmit;
      const second = bigFirst ? smallEmit : bigEmit;
      const [firstEv, secondEv] = await Promise.all([first(), second()]);
      expect(firstEv.seq).not.toBe(secondEv.seq);
    }

    const log = await readRoomLog(db.prisma, room.id);
    expect(log.map((e) => e.seq)).toEqual(Array.from({ length: 1 + ROUNDS * 2 }, (_, i) => i + 1));
    expect(log.filter((e) => e.type === 'test-app.note.posted')).toHaveLength(ROUNDS * 2);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @mymozhem/core test:int -t "concurrency"` → PASS оба теста (реализация уже на месте — характеризующие тесты критерия выхода ф.1). Проверить, что фильтр матчит именно эти 2 теста. Прогнать 3 раза подряд — гонки не должны быть флаки.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/realtime/event-commit.int-spec.ts
git commit -m "test(core): конкурентный seq и payload-нейтральность app-событий (REQ-RT-007, критерий выхода ф.1)"
```

---

### Task 9: Финальные гейты + сверка spec coverage

**Files:**
- Modify (по факту находок): любые

- [ ] **Step 1: Full gates**

Run последовательно, все зелёные:

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:int
pnpm boundary-check
pnpm guardrails
```

Ожидание: build 3/3, unit (включая новые 4+3 тестов), int (включая новые ~14), boundary-check без violations, guardrails живы.

- [ ] **Step 2: Spec coverage сверка**

Сверить с таблицей ниже: каждая строка закрыта задачей и тестом. Пробел — либо задача в плане пропущена (добавить), либо осознанный шов (§10 дизайна).

- [ ] **Step 3: Commit (если были правки)**

```bash
git commit -am "chore(core): final gate fixes для event-commit среза"
```

---

## Spec coverage

| REQ | Что закрывает | Тест |
|---|---|---|
| REQ-RT-016 (запечатывание) | Task 5 шаг 1 | `seals the log in a terminal status` |
| REQ-RT-014 (per-actor хард, объём v1.3) | Tasks 1-2, 5 шаг 2 | limiter unit ×4; `4th attempt…`, `failed attempts burn…` |
| REQ-RT-012 (размер) | Tasks 1, 5 шаг 3 | config spec; `rejects oversized payload` |
| REQ-CTR-008 (реестр+схема) | Tasks 3, 5 шаги 4-5 | registry spec ×3; `unknown event type`, `payload failing the registered schema` |
| REQ-CTR-009 (потолок видимости) | Task 5 шаг 6 (`isWithinCeiling` из SDK) | `visibility weaker than the declared ceiling`, `visibility STRONGER` |
| REQ-RT-007 (seq, payload-нейтральность) | Task 4 (appendLocked, валидация до lock), Task 8 | `serializes concurrent app commits`, `payload-neutrality` |
| REQ-RT-009 (actorId, service-уровень) | Task 7 | `records actorId on lifecycle events`; membership-гейт-тесты Task 5 |
| REQ-OPS-003 (конфиг fail-closed) | Task 1 | config spec ×2 |
| Отложенное lifecycle §10: actorId≠null | Task 7 | тот же тест |
| Отложенное lifecycle §10: payload-нейтральность | Task 8 | `payload-neutrality` |
| Follow-up: шов-комментарий о порядке блокировок | Task 4 | комментарий в `event-log.service.ts` (проверка ревьюером) |
| Membership-гейт (решение владельца §0) | Task 5 шаг 7 | `actor without membership`, `null actor` |

## Швы после среза (не в скоупе — зафиксировать в HANDOFF при завершении)

- Wire-exposure commit (Socket.io `publish`), подстановка actorId из auth-контекста → realtime transport план.
- Маппинг `EVENT_EMIT_RATE_LIMITED` → `RATE_LIMITED`, остальные коды → wire `{code}` → realtime transport план.
- Read-path (проекции, replay, курсор) → realtime read план.
- `soft_room_event_cap`/алерт/`room_event_cap_mode` → фаза 4.
- Права эмита по ролям (SPECTATOR) → app-семантика, фаза 2.
