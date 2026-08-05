# Realtime read/handshake (полный duplex) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Realtime-транспорт ядра: handshake по access JWT, subscribe/replay видимой проекции (события + appSettings), live-доставка через tx-outbox на AsyncLocalStorage, publish app-событий в `commitAppEvent` с actorId из auth-контекста, таблица маппинга core→contract кодов ошибок.

**Architecture:** Socket.io gateway внутри `packages/core/src/realtime/` (REQ-RT-006: транспорт скрыт за модулем; boundary-правило `socketio-only-in-realtime` уже существует). Post-commit fan-out — подход A из дизайна: `EventOutbox` (ALS-staging, fail-closed) + in-process `RealtimeBus` (одна реплика, REQ-OPS-005). Проекции строит `ProjectionService` (REQ-CORE-005: никакой ручной фильтрации). Wire-конверты и коды — zod-схемы SDK (minor-бамп 1.2.0).

**Tech Stack:** NestJS 11 (@nestjs/websockets + @nestjs/platform-socket.io), socket.io 4.x, Prisma 7.8 (adapter-pg), zod 4, AsyncLocalStorage, Jest 29 + testcontainers, socket.io-client для e2e.

**Spec:** `docs/sessions/2026-08-05-realtime-read-handshake-design.md` — решения владельца §0 не переоткрывать.

**Закрываемые REQ-\* (первая стадия ревью сверяется с ними):** REQ-RT-003, REQ-RT-006, REQ-RT-009, REQ-RT-011(a) (объём amendment v1.3), REQ-RT-015 (объём v1.3: базовый потолок, без бэкоффа), REQ-CORE-005, REQ-CORE-008, REQ-SEC-003 (гейт + hook разрыва; flow исключения — другой срез), REQ-SEC-006, REQ-OPS-005, REQ-OPS-003, REQ-CTR-004, REQ-CTR-005, REQ-ID-016 (scope гостя). Критерии выхода ф.1: late-join replay, видимость по каналам realtime/replay, потолок reconnect/replay.

## Global Constraints

- **Решения владельца (design §0):** полный duplex; REQ-SEC-003 — hook + реестр сейчас; fan-out — ALS-outbox fail-closed; `EVENT_EMIT_RATE_LIMITED → EVENT_RATE_LIMITED` (НЕ `RATE_LIMITED`); новый контрактный код `ACTOR_NOT_MEMBER`; дефолт `visibility` в publish = декларированный потолок типа; per-event re-check членства в live-доставке НЕ делаем.
- Core-имена ошибок event-commit (`realtime.errors.ts`) НЕ переименовываются — перевод только в `error-mapping.ts`.
- Наружу ровно `{code}` (REQ-SEC-006); message — только в серверный лог.
- `projectedEventSchema` — единственная наружная форма события: seq/visibility/cursor отсутствуют структурно (REQ-RT-011a).
- Один lockfile: зависимости добавляются через `pnpm add` в конкретный пакет + `pnpm install` в корне.
- Jest-фильтр БЕЗ `--` (ловушка «0 tests, exit 0»): рабочая форма `pnpm --filter @mymozhem/core test:int -t "имя"`; любой фильтр проверять на >0 матчей в выводе.
- Перед `pnpm --filter @mymozhem/server test` обязателен `pnpm build` — e2e резолвит `@mymozhem/core` из dist (поймано дважды в прошлых срезах). Аналогично core резолвит `@mymozhem/sdk` из dist — после правок SDK: `pnpm --filter @mymozhem/sdk build`.
- Int/e2e поднимают контейнеры Postgres — Docker Desktop запущен; хост-порт 5432 занят чужим `lt-pg` (не трогать).
- Замороженные миграции не меняются; этот срез миграций НЕ добавляет (схема БД не меняется).
- Prisma 7.8 adapter-pg: `$queryRaw` не десериализует void-выражения (`$executeRaw` для locks); `$queryRaw` отдаёт сырое DB-значение enum.
- Коммиты на русском/английском в стиле прошлых срезов (`type(scope): описание`), в конце — `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Состояние — только в полях экземпляров провайдеров (REQ-CORE-004): лимитеры, реестры, ALS — поля классов, не module-level мутабельные значения.

---

### Task 1: Конфиг `RECONNECT_RATE_LIMIT_PER_MIN`

**Files:**
- Modify: `packages/core/src/config/config.schema.ts` (после `EVENT_EMIT_RATE_LIMIT_PER_MIN`, ~line 26)
- Modify: `packages/core/src/config/config.schema.spec.ts` (в конец describe)
- Modify: `packages/core/src/testing/test-config.ts`

**Interfaces:**
- Consumes: ничего из новых задач.
- Produces: `AppConfig.RECONNECT_RATE_LIMIT_PER_MIN: number` — используется фабрикой лимитера в Task 6 и env-override'ом в e2e (Task 8).

- [ ] **Step 1: Failing test — дефолт и коэрсия нового параметра**

Добавить в конец `describe('loadConfig')` в `packages/core/src/config/config.schema.spec.ts`:

```ts
  it('applies §4 default for reconnect ceiling (REQ-RT-015)', () => {
    const cfg = configSchema.parse({
      DATABASE_URL: 'postgresql://x',
      JWT_SECRET: 'x'.repeat(32),
    });
    expect(cfg.RECONNECT_RATE_LIMIT_PER_MIN).toBe(10);
  });

  it('coerces RECONNECT_RATE_LIMIT_PER_MIN from string and rejects 0', () => {
    const envBase = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 'x'.repeat(32) };
    expect(
      configSchema.parse({ ...envBase, RECONNECT_RATE_LIMIT_PER_MIN: '5' })
        .RECONNECT_RATE_LIMIT_PER_MIN,
    ).toBe(5);
    expect(
      configSchema.safeParse({ ...envBase, RECONNECT_RATE_LIMIT_PER_MIN: 0 }).success,
    ).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/core test config.schema`
Expected: FAIL — `RECONNECT_RATE_LIMIT_PER_MIN` is undefined (проверить, что оба теста реально матчатся: в выводе 2 failed, не «0 tests»).

- [ ] **Step 3: Implementation**

В `packages/core/src/config/config.schema.ts` после строки `EVENT_EMIT_RATE_LIMIT_PER_MIN` добавить:

```ts
  // REQ-RT-015 (§4 reconnect_rate_limit): базовый per-identity потолок на
  // reconnect/replay, 10/мин. Объём amendment v1.3: потолок — ф.1; экспоненциальный
  // бэкофф и конфигурируемый режим — ф.4.
  RECONNECT_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(10),
```

В `packages/core/src/testing/test-config.ts` добавить поле (после `MAX_EVENT_PAYLOAD_BYTES`):

```ts
  RECONNECT_RATE_LIMIT_PER_MIN: 10,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/core test config.schema`
Expected: PASS, все 16+ тестов файла.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config/config.schema.ts packages/core/src/config/config.schema.spec.ts packages/core/src/testing/test-config.ts
git commit -m "feat(core): конфиг RECONNECT_RATE_LIMIT_PER_MIN (REQ-RT-015, объём v1.3)"
```

---

### Task 2: SDK — код `ACTOR_NOT_MEMBER`, wire-схемы realtime, версия 1.2.0

**Files:**
- Modify: `packages/sdk/src/errors/error-codes.ts`
- Create: `packages/sdk/src/realtime/realtime-messages.ts`
- Create: `packages/sdk/src/realtime/realtime-messages.fixtures.ts`
- Create: `packages/sdk/src/realtime/realtime-messages.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/sdk/src/contract-version.ts:7` (`'1.1.0'` → `'1.2.0'`)
- Modify: `packages/sdk/package.json` (`"version": "1.1.0"` → `"1.2.0"`)

**Interfaces:**
- Consumes: существующие `eventTypeSchema`, `projectedEventSchema`, `visibilitySchema`, `contractErrorPayloadSchema`.
- Produces (нужны Task 3, 4, 7, 8): `ACTOR_NOT_MEMBER` в `CONTRACT_ERROR_CODES`; `REALTIME_MESSAGES = { SUBSCRIBE: 'subscribe', PUBLISH: 'publish', EVENT: 'event' } as const`; `subscribeRequestSchema`/`SubscribeRequest`; `roomSnapshotSchema`/`RoomSnapshot`; `subscribeOkAckSchema`/`SubscribeOkAck`; `publishRequestSchema`/`PublishRequest`; `publishOkAckSchema`/`PublishOkAck`; `CONTRACT_VERSION = '1.2.0'`.

- [ ] **Step 1: Failing contract tests — конверты, фикстуры, новый код**

`packages/sdk/src/realtime/realtime-messages.fixtures.ts`:

```ts
import type { PublishRequest, RoomSnapshot, SubscribeRequest } from './realtime-messages';

export const validSubscribeRequest: SubscribeRequest = {
  roomId: '11111111-1111-4111-8111-111111111111',
};

export const validPublishRequests: PublishRequest[] = [
  { type: 'quiz.answer.submitted', payload: { roundId: 'r1', choice: 2 } },
  {
    type: 'quiz.answer.submitted',
    payload: { roundId: 'r1', choice: 2 },
    visibility: 'organizer',
  },
];

export const validSnapshot: RoomSnapshot = {
  events: [
    {
      type: 'core.room.activated',
      payload: { appId: 'quiz', manifestVersion: 1 },
      actorId: null,
    },
    {
      type: 'quiz.answer.submitted',
      payload: { roundId: 'r1', choice: 2 },
      actorId: '22222222-2222-4222-8222-222222222222',
    },
  ],
  appSettings: { roundsCount: 5 },
};

export const invalidSubscribeRequestCases: { name: string; value: unknown }[] = [
  { name: 'extra key (strictObject)', value: { ...validSubscribeRequest, since: 'x' } },
  { name: 'roomId not a uuid', value: { roomId: 'room-1' } },
];

export const invalidPublishRequestCases: { name: string; value: unknown }[] = [
  {
    name: 'type without namespace',
    value: { type: 'activated', payload: {} },
  },
  {
    name: 'visibility outside the enum',
    value: { type: 'quiz.answer.submitted', payload: {}, visibility: 'friends-only' },
  },
  {
    name: 'extra key (strictObject)',
    value: { type: 'quiz.answer.submitted', payload: {}, actorId: 'spoof' },
  },
];

export const invalidSnapshotCases: { name: string; value: unknown }[] = [
  {
    name: 'event carrying seq outward (REQ-RT-011a)',
    value: {
      ...validSnapshot,
      events: [{ ...validSnapshot.events[0], seq: 7 }],
    },
  },
  {
    name: 'replay cursor field (no cursor exists in MVP)',
    value: { ...validSnapshot, cursor: 'eyJzZXEiOjQyfQ==' },
  },
];
```

`packages/sdk/src/realtime/realtime-messages.contract.spec.ts`:

```ts
import { contractErrorCodeSchema } from '../errors/error-codes';
import {
  publishOkAckSchema,
  publishRequestSchema,
  roomSnapshotSchema,
  subscribeOkAckSchema,
  subscribeRequestSchema,
} from './realtime-messages';
import {
  invalidPublishRequestCases,
  invalidSnapshotCases,
  invalidSubscribeRequestCases,
  validPublishRequests,
  validSnapshot,
  validSubscribeRequest,
} from './realtime-messages.fixtures';

describe('realtime messages contract', () => {
  it('accepts the valid subscribe request', () => {
    expect(subscribeRequestSchema.safeParse(validSubscribeRequest).success).toBe(true);
  });

  it.each(invalidSubscribeRequestCases.map((c) => [c.name, c.value] as const))(
    'rejects subscribe request: %s',
    (_name, value) => {
      expect(subscribeRequestSchema.safeParse(value).success).toBe(false);
    },
  );

  it.each(validPublishRequests.map((r, i) => [i, r] as const))(
    'accepts valid publish request #%i',
    (_i, request) => {
      expect(publishRequestSchema.safeParse(request).success).toBe(true);
    },
  );

  it.each(invalidPublishRequestCases.map((c) => [c.name, c.value] as const))(
    'rejects publish request: %s',
    (_name, value) => {
      expect(publishRequestSchema.safeParse(value).success).toBe(false);
    },
  );

  it('accepts the valid snapshot and the ok acks', () => {
    expect(roomSnapshotSchema.safeParse(validSnapshot).success).toBe(true);
    expect(subscribeOkAckSchema.safeParse({ ok: true, snapshot: validSnapshot }).success).toBe(true);
    expect(publishOkAckSchema.safeParse({ ok: true }).success).toBe(true);
  });

  it.each(invalidSnapshotCases.map((c) => [c.name, c.value] as const))(
    'rejects snapshot: %s',
    (_name, value) => {
      expect(roomSnapshotSchema.safeParse(value).success).toBe(false);
    },
  );

  it('ACTOR_NOT_MEMBER is a contract error code (design §0.5)', () => {
    expect(contractErrorCodeSchema.safeParse('ACTOR_NOT_MEMBER').success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk test realtime-messages`
Expected: FAIL — модуля `./realtime-messages` не существует (проверить >0 тестов матчатся).

- [ ] **Step 3: Implementation**

`packages/sdk/src/realtime/realtime-messages.ts`:

```ts
import { z } from 'zod';
import { eventTypeSchema } from '../events/event-type';
import { projectedEventSchema } from '../events/projected-event.schema';
import { visibilitySchema } from '../visibility/visibility';

// Socket.io message names of the realtime contract (REQ-RT-006, design §3): one
// source for the core gateway and any client.
export const REALTIME_MESSAGES = {
  SUBSCRIBE: 'subscribe',
  PUBLISH: 'publish',
  EVENT: 'event',
} as const;

export const subscribeRequestSchema = z.strictObject({
  roomId: z.uuid(),
});
export type SubscribeRequest = z.infer<typeof subscribeRequestSchema>;

// Full visible projection, no cursor (MVP, design §3): replay returns everything
// the requester's level may see. Room status is learned from lifecycle events in
// the same stream (REQ-RT-010) — deliberately no status field. strictObject: an
// extra key (seq, cursor) is a core bug, and loud rejection beats silent strip.
export const roomSnapshotSchema = z.strictObject({
  events: z.array(projectedEventSchema),
  appSettings: z.record(z.string(), z.unknown()),
});
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

export const subscribeOkAckSchema = z.strictObject({
  ok: z.literal(true),
  snapshot: roomSnapshotSchema,
});
export type SubscribeOkAck = z.infer<typeof subscribeOkAckSchema>;

// visibility is optional: the default is the type's declared ceiling (fail-safe,
// design §0.6); a weaker-than-declared value is rejected at commit (REQ-CTR-009).
// Error acks reuse contractErrorPayloadSchema ({code}) — REQ-SEC-006.
export const publishRequestSchema = z.strictObject({
  type: eventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  visibility: visibilitySchema.optional(),
});
export type PublishRequest = z.infer<typeof publishRequestSchema>;

// The ack carries no seq and no event body: the publisher sees its own event via
// the same fan-out as every subscriber (design §5).
export const publishOkAckSchema = z.strictObject({
  ok: z.literal(true),
});
export type PublishOkAck = z.infer<typeof publishOkAckSchema>;
```

В `packages/sdk/src/errors/error-codes.ts` добавить `'ACTOR_NOT_MEMBER'` в `CONTRACT_ERROR_CODES` — строкой после `'ROOM_SETTINGS_FROZEN',` (до комментария про transport-facing коды).

В `packages/sdk/src/index.ts` добавить после строки `export * from './auth/token-response';`:

```ts
export * from './realtime/realtime-messages';
```

В `packages/sdk/src/contract-version.ts`: `CONTRACT_VERSION = '1.2.0'` (комментарий выше оставить — он про механизм). В `packages/sdk/package.json`: `"version": "1.2.0"`. Аддитивное расширение → minor (REQ-CTR-004); контрактный тест держит package.json и CONTRACT_VERSION равными.

- [ ] **Step 4: Run tests + build**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: PASS (включая существующий contract-version spec на паритет версий).
Run: `pnpm --filter @mymozhem/sdk build`
Expected: успех — dist обновлён (core резолвит SDK из dist).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk
git commit -m "feat(sdk): realtime wire-конверты + код ACTOR_NOT_MEMBER, контракт 1.2.0 (REQ-CTR-004/005, REQ-RT-006/009)"
```

---

### Task 3: Таблица маппинга core→contract кодов

**Files:**
- Create: `packages/core/src/realtime/error-mapping.ts`
- Create: `packages/core/src/realtime/error-mapping.spec.ts`
- Modify: `packages/core/src/realtime/realtime.errors.ts:1-3` (header-комментарий) и `:9-10` (комментарий паритета)

**Interfaces:**
- Consumes: `ACTOR_NOT_MEMBER`/`EVENT_RATE_LIMITED` из SDK (Task 2, dist собран); `RealtimeError`, `RealtimeErrorCode`, `REALTIME_ERROR_CODES` из `./realtime.errors`.
- Produces: `contractCodeFor(error: RealtimeError): ContractErrorCode` — используется gateway в Task 7.

- [ ] **Step 1: Failing test — полная таблица (design §3)**

`packages/core/src/realtime/error-mapping.spec.ts`:

```ts
import { contractErrorCodeSchema, type ContractErrorCode } from '@mymozhem/sdk';
import { contractCodeFor } from './error-mapping';
import { REALTIME_ERROR_CODES, RealtimeError } from './realtime.errors';

// Таблица — решение владельца 2026-08-05 (design §3, §0.4/§0.5): core-имена не
// переименовываются, перевод только здесь.
const EXPECTED: Record<string, ContractErrorCode> = {
  [REALTIME_ERROR_CODES.ROOM_NOT_ACTIVE]: 'ROOM_LOG_SEALED',
  [REALTIME_ERROR_CODES.EVENT_EMIT_RATE_LIMITED]: 'EVENT_RATE_LIMITED',
  [REALTIME_ERROR_CODES.EVENT_PAYLOAD_TOO_LARGE]: 'EVENT_PAYLOAD_TOO_LARGE',
  [REALTIME_ERROR_CODES.EVENT_TYPE_UNKNOWN]: 'EVENT_UNKNOWN_TYPE',
  [REALTIME_ERROR_CODES.EVENT_PAYLOAD_INVALID]: 'EVENT_PAYLOAD_INVALID',
  [REALTIME_ERROR_CODES.EVENT_VISIBILITY_EXCEEDED]: 'EVENT_VISIBILITY_WEAKER_THAN_DECLARED',
  [REALTIME_ERROR_CODES.ACTOR_NOT_MEMBER]: 'ACTOR_NOT_MEMBER',
};

describe('contractCodeFor', () => {
  it.each(Object.entries(EXPECTED))('maps %s → %s', (coreCode, contractCode) => {
    expect(contractCodeFor(new RealtimeError(coreCode as never, 'm'))).toBe(contractCode);
  });

  it('covers every core code exactly once', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.values(REALTIME_ERROR_CODES).sort());
  });

  it.each(Object.values(EXPECTED))('target %s is a valid contract code', (code) => {
    expect(contractErrorCodeSchema.safeParse(code).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/core test error-mapping`
Expected: FAIL — `./error-mapping` не существует.

- [ ] **Step 3: Implementation**

`packages/core/src/realtime/error-mapping.ts`:

```ts
import type { ContractErrorCode } from '@mymozhem/sdk';
import { REALTIME_ERROR_CODES, RealtimeError, type RealtimeErrorCode } from './realtime.errors';

// Единственная точка перевода core→contract кодов event-commit (design §3).
// Core-имена (design event-commit §6, утверждены) НЕ переименовываются — перевод
// только здесь, на границе. EVENT_EMIT_RATE_LIMITED → EVENT_RATE_LIMITED (доменный
// лимит REQ-RT-014), НЕ RATE_LIMITED — тот остаётся транспортным (HTTP, handshake-
// потолок), решение владельца §0.4. Полнота принуждается компилятором: новый член
// REALTIME_ERROR_CODES ломает сборку, пока не добавлена строка маппинга.
const CONTRACT_CODE_BY_CORE_CODE = {
  [REALTIME_ERROR_CODES.ROOM_NOT_ACTIVE]: 'ROOM_LOG_SEALED',
  [REALTIME_ERROR_CODES.EVENT_EMIT_RATE_LIMITED]: 'EVENT_RATE_LIMITED',
  [REALTIME_ERROR_CODES.EVENT_PAYLOAD_TOO_LARGE]: 'EVENT_PAYLOAD_TOO_LARGE',
  [REALTIME_ERROR_CODES.EVENT_TYPE_UNKNOWN]: 'EVENT_UNKNOWN_TYPE',
  [REALTIME_ERROR_CODES.EVENT_PAYLOAD_INVALID]: 'EVENT_PAYLOAD_INVALID',
  [REALTIME_ERROR_CODES.EVENT_VISIBILITY_EXCEEDED]: 'EVENT_VISIBILITY_WEAKER_THAN_DECLARED',
  [REALTIME_ERROR_CODES.ACTOR_NOT_MEMBER]: 'ACTOR_NOT_MEMBER',
} as const satisfies Record<RealtimeErrorCode, ContractErrorCode>;

export const contractCodeFor = (error: RealtimeError): ContractErrorCode =>
  CONTRACT_CODE_BY_CORE_CODE[error.code];
```

В `packages/core/src/realtime/realtime.errors.ts` заменить header (строки 1-3):

```ts
// Core-internal typed errors of the event-commit chain (design §6). Не часть
// SDK-контракта: wire-маппинг — error-mapping.ts (EVENT_EMIT_RATE_LIMITED →
// EVENT_RATE_LIMITED, решение владельца 2026-08-05, design realtime §0.4).
```

И комментарий строк 9-10:

```ts
  // Строковый паритет с кодом ContractError SDK (commitCoreEvent): транспорт
  // отображает code→code 1:1 в error-mapping.ts.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/core test error-mapping`
Expected: PASS (17 тестов).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/realtime/error-mapping.ts packages/core/src/realtime/error-mapping.spec.ts packages/core/src/realtime/realtime.errors.ts
git commit -m "feat(core): таблица маппинга core→contract кодов event-commit (design §3)"
```

---

### Task 4: ProjectionService

**Files:**
- Create: `packages/core/src/realtime/projection.service.ts`
- Create: `packages/core/src/realtime/projection.service.spec.ts`

**Interfaces:**
- Consumes: `appSettingsVisibilityMap`, `projectedEventSchema`, типы `AppManifest`, `ProjectedEvent`, `Visibility` из SDK; `LogEvent` из `@prisma/client`.
- Produces (Task 7): `ProjectionService` с `projectEvent(event: Pick<LogEvent,'type'|'payload'|'actorId'>): ProjectedEvent`, `projectEvents(events: readonly LogEvent[], level: OutwardLevel): ProjectedEvent[]`, `projectAppSettings(settings: unknown, manifest: AppManifest | undefined, level: OutwardLevel): Record<string, unknown>`; тип `OutwardLevel = 'public' | 'organizer'`.

- [ ] **Step 1: Failing test — уровни событий и appSettings**

`packages/core/src/realtime/projection.service.spec.ts`:

```ts
import type { LogEvent } from '@prisma/client';
import type { AppManifest } from '@mymozhem/sdk';
import { ProjectionService } from './projection.service';

const ROW = {
  roomId: '11111111-1111-4111-8111-111111111111',
  seq: 1,
  schemaVersion: 1,
  recordedAt: new Date('2026-08-05T00:00:00Z'),
};

const events = [
  { ...ROW, seq: 1, type: 'core.room.activated', payload: { appId: 'quiz', manifestVersion: 1 }, actorId: null, visibility: 'PUBLIC' },
  { ...ROW, seq: 2, type: 'quiz.round.opened', payload: { round: 1 }, actorId: null, visibility: 'ORGANIZER' },
  { ...ROW, seq: 3, type: 'quiz.answer.recorded', payload: { ok: true }, actorId: '22222222-2222-4222-8222-222222222222', visibility: 'MODULE_PRIVATE' },
] as unknown as LogEvent[];

// Манифест с аннотациями x-visibility (REQ-CORE-008): rounds — public,
// seed — organizer, answers — без аннотации (fail-safe module-private).
const MANIFEST: AppManifest = {
  appId: 'quiz',
  manifestVersion: 1,
  contractRange: '^1.0.0',
  appSettings: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      rounds: { type: 'number', 'x-visibility': 'public' },
      seed: { type: 'string', 'x-visibility': 'organizer' },
      answers: { type: 'object' },
    },
  },
  events: {},
};

const SETTINGS = { rounds: 5, seed: 's3cret', answers: { r1: 2 } };

describe('ProjectionService', () => {
  const projection = new ProjectionService();

  it('public level sees only public events, without seq/visibility (REQ-RT-011a)', () => {
    const out = projection.projectEvents(events, 'public');
    expect(out).toEqual([
      { type: 'core.room.activated', payload: { appId: 'quiz', manifestVersion: 1 }, actorId: null },
    ]);
  });

  it('organizer level sees public + organizer, never module-private (REQ-CORE-005)', () => {
    const out = projection.projectEvents(events, 'organizer');
    expect(out.map((e) => e.type)).toEqual(['core.room.activated', 'quiz.round.opened']);
  });

  it('projected shape carries exactly type/payload/actorId', () => {
    const out = projection.projectEvents(events, 'organizer');
    for (const e of out) expect(Object.keys(e).sort()).toEqual(['actorId', 'payload', 'type']);
  });

  it('participant gets only public appSettings properties; unannotated is hidden (REQ-CORE-008)', () => {
    expect(projection.projectAppSettings(SETTINGS, MANIFEST, 'public')).toEqual({ rounds: 5 });
  });

  it('organizer gets public + organizer properties, never module-private', () => {
    expect(projection.projectAppSettings(SETTINGS, MANIFEST, 'organizer')).toEqual({
      rounds: 5,
      seed: 's3cret',
    });
  });

  it('property present in settings but absent from the schema is hidden (fail-safe)', () => {
    expect(
      projection.projectAppSettings({ ...SETTINGS, smuggled: true }, MANIFEST, 'organizer'),
    ).toEqual({ rounds: 5, seed: 's3cret' });
  });

  it('no manifest (unpinned DRAFT) or non-object settings → empty projection', () => {
    expect(projection.projectAppSettings(SETTINGS, undefined, 'organizer')).toEqual({});
    expect(projection.projectAppSettings(null, MANIFEST, 'organizer')).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/core test projection.service`
Expected: FAIL — `./projection.service` не существует.

- [ ] **Step 3: Implementation**

`packages/core/src/realtime/projection.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { LogEvent } from '@prisma/client';
import {
  appSettingsVisibilityMap,
  projectedEventSchema,
  type AppManifest,
  type ProjectedEvent,
  type Visibility,
} from '@mymozhem/sdk';

// Наружные уровни запрашивающего (design §2): module-private — уровень ядра/модуля,
// наружу не проецируется НИКОГДА (REQ-CORE-005), поэтому уровня подписчика всего два.
export type OutwardLevel = 'public' | 'organizer';

const VISIBLE_TO: Record<OutwardLevel, readonly LogEvent['visibility'][]> = {
  public: ['PUBLIC'],
  organizer: ['PUBLIC', 'ORGANIZER'],
};

const SETTINGS_VISIBLE_TO: Record<OutwardLevel, readonly Visibility[]> = {
  public: ['public'],
  organizer: ['public', 'organizer'],
};

// Единственное место построения видимости наружу (REQ-CORE-005): ручная фильтрация
// чувствительных полей в обработчиках как механизм сокрытия запрещена нормой —
// gateway (Task 7) пользуется только этими тремя функциями.
@Injectable()
export class ProjectionService {
  // Одно событие → наружная форма. parse по strictObject: лишний ключ — громкий
  // отказ, не тихий strip (конвенция SDK).
  projectEvent(event: Pick<LogEvent, 'type' | 'payload' | 'actorId'>): ProjectedEvent {
    return projectedEventSchema.parse({
      type: event.type,
      payload: event.payload as Record<string, unknown>,
      actorId: event.actorId,
    });
  }

  projectEvents(events: readonly LogEvent[], level: OutwardLevel): ProjectedEvent[] {
    const visible = VISIBLE_TO[level];
    return events
      .filter((event) => visible.includes(event.visibility))
      .map((event) => this.projectEvent(event));
  }

  // REQ-CORE-008: appSettings проецируются по уровню запрашивающего наравне с
  // состоянием и событиями. Карта уровней — appSettingsVisibilityMap из SDK;
  // неаннотированное свойство и свойство вне схемы — module-private (fail-safe).
  projectAppSettings(
    settings: unknown,
    manifest: AppManifest | undefined,
    level: OutwardLevel,
  ): Record<string, unknown> {
    if (manifest === undefined || typeof settings !== 'object' || settings === null) {
      return {};
    }
    const visibilityMap = appSettingsVisibilityMap(manifest.appSettings);
    const allowed = SETTINGS_VISIBLE_TO[level];
    return Object.fromEntries(
      Object.entries(settings as Record<string, unknown>).filter(([key]) =>
        allowed.includes(visibilityMap[key] ?? 'module-private'),
      ),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/core test projection.service`
Expected: PASS (7 тестов).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/realtime/projection.service.ts packages/core/src/realtime/projection.service.spec.ts
git commit -m "feat(core): ProjectionService — проекции событий и appSettings по уровню запрашивающего (REQ-CORE-005/008)"
```

---

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

### Task 6: SubscriptionRegistry + MembershipService.findActiveMembership + токен лимитера

**Files:**
- Create: `packages/core/src/realtime/subscription-registry.ts`
- Create: `packages/core/src/realtime/subscription-registry.spec.ts`
- Create: `packages/core/src/realtime/realtime.tokens.ts`
- Modify: `packages/core/src/membership/membership.service.ts` (метод)
- Modify: `packages/core/src/membership/membership.service.int-spec.ts` (int-тест метода)

**Interfaces:**
- Consumes: `OutwardLevel` (Task 4); `JoinRateLimiter` (существующий, переиспользуется класс — отдельный инстанс по конвенции REFRESH_RATE_LIMITER).
- Produces (Task 7): `SubscriptionRegistry` с `add(sub: Subscription): void`, `get(socketId: string): Subscription | undefined`, `remove(socketId: string): void`, `socketsOf(identityId: string, roomId: string): readonly string[]`; интерфейс `Subscription { socketId, identityId, roomId, level: OutwardLevel }`; `RECONNECT_RATE_LIMITER` (Symbol DI-токен); `MembershipService.findActiveMembership(roomId: string, identityId: string): Promise<Membership | null>`.

- [ ] **Step 1: Failing unit test — реестр**

`packages/core/src/realtime/subscription-registry.spec.ts`:

```ts
import { SubscriptionRegistry } from './subscription-registry';

const SUB_A = { socketId: 's1', identityId: 'u1', roomId: 'r1', level: 'public' as const };
const SUB_B = { socketId: 's2', identityId: 'u1', roomId: 'r1', level: 'organizer' as const };
const SUB_C = { socketId: 's3', identityId: 'u2', roomId: 'r1', level: 'public' as const };

describe('SubscriptionRegistry', () => {
  it('add/get/remove round-trip', () => {
    const registry = new SubscriptionRegistry();
    registry.add(SUB_A);
    expect(registry.get('s1')).toEqual(SUB_A);
    registry.remove('s1');
    expect(registry.get('s1')).toBeUndefined();
  });

  it('socketsOf groups by (identityId, roomId) for the revoke hook', () => {
    const registry = new SubscriptionRegistry();
    registry.add(SUB_A);
    registry.add(SUB_B);
    registry.add(SUB_C);
    expect([...registry.socketsOf('u1', 'r1')].sort()).toEqual(['s1', 's2']);
    expect(registry.socketsOf('u2', 'r1')).toEqual(['s3']);
    expect(registry.socketsOf('u1', 'r2')).toEqual([]);
  });

  it('remove cleans the membership index; empty sets are dropped', () => {
    const registry = new SubscriptionRegistry();
    registry.add(SUB_A);
    registry.add(SUB_B);
    registry.remove('s1');
    expect(registry.socketsOf('u1', 'r1')).toEqual(['s2']);
    registry.remove('s2');
    expect(registry.socketsOf('u1', 'r1')).toEqual([]);
  });

  it('removing an unknown socket is a no-op', () => {
    const registry = new SubscriptionRegistry();
    expect(() => registry.remove('nope')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/core test subscription-registry`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Implementation — реестр + токен**

`packages/core/src/realtime/subscription-registry.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { OutwardLevel } from './projection.service';

export interface Subscription {
  readonly socketId: string;
  readonly identityId: string;
  readonly roomId: string;
  readonly level: OutwardLevel;
}

// Реестр подписок (design §2): источник «кто что слушает» для fan-out и hook'а
// разрыва (REQ-SEC-003). In-memory легален при одной реплике (REQ-OPS-005);
// состояние — поле экземпляра (REQ-CORE-004). Индекс по (identityId, roomId)
// поддерживается синхронно с bySocket — менять только вместе.
@Injectable()
export class SubscriptionRegistry {
  private readonly bySocket = new Map<string, Subscription>();
  private readonly socketsByMembership = new Map<string, Set<string>>();

  private static key(identityId: string, roomId: string): string {
    return `${identityId}:${roomId}`;
  }

  add(sub: Subscription): void {
    this.bySocket.set(sub.socketId, sub);
    const key = SubscriptionRegistry.key(sub.identityId, sub.roomId);
    const set = this.socketsByMembership.get(key) ?? new Set<string>();
    set.add(sub.socketId);
    this.socketsByMembership.set(key, set);
  }

  get(socketId: string): Subscription | undefined {
    return this.bySocket.get(socketId);
  }

  remove(socketId: string): void {
    const sub = this.bySocket.get(socketId);
    if (sub === undefined) return;
    this.bySocket.delete(socketId);
    const key = SubscriptionRegistry.key(sub.identityId, sub.roomId);
    const set = this.socketsByMembership.get(key);
    set?.delete(socketId);
    if (set?.size === 0) this.socketsByMembership.delete(key);
  }

  socketsOf(identityId: string, roomId: string): readonly string[] {
    return [...(this.socketsByMembership.get(SubscriptionRegistry.key(identityId, roomId)) ?? [])];
  }
}
```

`packages/core/src/realtime/realtime.tokens.ts`:

```ts
// DI-токен per-identity лимитера reconnect/replay (REQ-RT-015, объём v1.3).
// Отдельный инстанс JoinRateLimiter — состояние не делится с join/refresh
// лимитерами (конвенция REFRESH_RATE_LIMITER транспортного среза).
export const RECONNECT_RATE_LIMITER = Symbol('RECONNECT_RATE_LIMITER');
```

- [ ] **Step 4: Run unit test**

Run: `pnpm --filter @mymozhem/core test subscription-registry`
Expected: PASS (4 теста).

- [ ] **Step 5: findActiveMembership — failing int-test**

Добавить describe в `packages/core/src/membership/membership.service.int-spec.ts` (внутри существующего beforeAll-контекста с db; посев — по образцу существующих тестов файла: комната через RoomService, членство через `db.prisma.membership.create`):

```ts
  describe('findActiveMembership', () => {
    it('returns the membership of a live member in a live room', async () => {
      const room = await rooms.create(ORG);
      await db.prisma.membership.create({
        data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' },
      });
      const found = await membership.findActiveMembership(room.id, P1);
      expect(found?.role).toBe('PARTICIPANT');
    });

    it('returns null for a non-member', async () => {
      const room = await rooms.create(ORG);
      expect(await membership.findActiveMembership(room.id, P1)).toBeNull();
    });

    it('returns null when the room is soft-deleted (REQ-SEC-003)', async () => {
      const room = await rooms.create(ORG);
      await db.prisma.membership.create({
        data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' },
      });
      await rooms.softDelete(room.id);
      expect(await membership.findActiveMembership(room.id, P1)).toBeNull();
    });
  });
```

(Имена переменных `rooms`/`membership`/`P1` — выровнять по фактическим в файле спеки; визит в файл обязателен до вставки.)

- [ ] **Step 6: Run to fail, implement, run to pass**

Run: `pnpm --filter @mymozhem/core test:int membership.service -t "findActiveMembership"`
Expected: FAIL — метод не существует.

В `packages/core/src/membership/membership.service.ts` после `createOrganizerMembership` добавить:

```ts
  // Read-path realtime-среза (REQ-SEC-003): живое членство в живой комнате.
  // Мягкое удаление комнаты гасит членство для чтения; мягкого удаления самой
  // membership в схеме пока нет — появится со срезом исключения (там же hook
  // SubscriptionRegistry.revokeRoomAccess получит вызывающего).
  async findActiveMembership(roomId: string, identityId: string): Promise<Membership | null> {
    const membership = await this.prisma.membership.findUnique({
      where: { roomId_identityId: { roomId, identityId } },
      include: { room: true },
    });
    if (!membership || membership.room.deletedAt !== null) return null;
    return membership;
  }
```

Run: `pnpm --filter @mymozhem/core test:int membership.service`
Expected: PASS всего файла.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/realtime/subscription-registry.ts packages/core/src/realtime/subscription-registry.spec.ts packages/core/src/realtime/realtime.tokens.ts packages/core/src/membership/membership.service.ts packages/core/src/membership/membership.service.int-spec.ts
git commit -m "feat(core): SubscriptionRegistry + findActiveMembership + токен reconnect-лимитера (REQ-SEC-003, REQ-RT-015)"
```

---

### Task 7: RealtimeGateway + ConfigurableIoAdapter + wiring

**Files:**
- Modify: `packages/core/package.json` (deps: `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`)
- Create: `packages/core/src/realtime/realtime.gateway.ts`
- Create: `packages/core/src/realtime/realtime.gateway.spec.ts`
- Create: `packages/core/src/realtime/io-adapter.ts`
- Modify: `packages/core/src/realtime/realtime.module.ts` (gateway, registry, projection, лимитер, импорты Auth/Membership)
- Modify: `packages/core/src/index.ts` (экспорты gateway/adapter/registry/projection/tokens)
- Modify: `apps/server/src/main.ts` (useWebSocketAdapter)

**Interfaces:**
- Consumes: всё из Tasks 1-6 (`ProjectionService`, `SubscriptionRegistry`, `EventOutbox`, `RealtimeBus`, `contractCodeFor`, `RECONNECT_RATE_LIMITER`, `findActiveMembership`, SDK Task 2).
- Produces (Task 8): работающий Socket.io endpoint на том же HTTP-сервере; `RealtimeGateway` с `handleSubscribe(socket, payload, ack)`, `handlePublish(socket, payload, ack)`, `revokeRoomAccess(identityId: string, roomId: string): void`; `ConfigurableIoAdapter` (конструктор `(config: AppConfig)`), экспортированный из barrel для `main.ts` и e2e.

- [ ] **Step 1: Зависимости**

```bash
pnpm --filter @mymozhem/core add socket.io@^4.8.1 @nestjs/websockets@^11.0.0 @nestjs/platform-socket.io@^11.0.0
pnpm install
```

Проверка: `pnpm --filter @mymozhem/core exec node -e "require('socket.io/package.json')" ` не падает. Boundary-правило `socketio-only-in-realtime` уже разрешает импорт из `packages/core/src/realtime`.

- [ ] **Step 2: Failing unit test — gateway на фейках**

`packages/core/src/realtime/realtime.gateway.spec.ts`. Gateway тестируется без socket.io: методы публичные, socket — структурный фейк (прецедент ReplyLike в http-exception.filter).

```ts
import type { AccessClaims } from '../auth/token.service';
import { RealtimeGateway } from './realtime.gateway';
import { SubscriptionRegistry } from './subscription-registry';
import { ProjectionService } from './projection.service';
import { REALTIME_MESSAGES } from '@mymozhem/sdk';

const GUEST_CLAIMS: AccessClaims = {
  sub: '22222222-2222-4222-8222-222222222222',
  sid: '33333333-3333-4333-8333-333333333333',
  kind: 'GUEST',
  roomId: '11111111-1111-4111-8111-111111111111',
};
const ROOM = GUEST_CLAIMS.roomId as string;

function fakeSocket(claims: AccessClaims = GUEST_CLAIMS) {
  return {
    id: 'socket-1',
    data: { claims },
    handshake: { auth: { token: 'x' } },
    joined: [] as string[],
    left: [] as string[],
    disconnected: false as boolean | unknown,
    join(room: string) { this.joined.push(room); },
    leave(room: string) { this.left.push(room); },
    disconnect(close?: boolean) { this.disconnected = close ?? true; },
  };
}
type FakeSocket = ReturnType<typeof fakeSocket>;

type Ack = (value: unknown) => void;

function makeGateway(overrides: {
  membership?: { findActiveMembership: jest.Mock };
  prisma?: { room: { findUnique: jest.Mock }; logEvent: { findMany: jest.Mock } };
  eventLog?: { commitAppEvent: jest.Mock };
  outbox?: { run: jest.Mock };
  registry?: SubscriptionRegistry;
  tokens?: { verifyAccessToken: jest.Mock };
  reconnectLimiter?: { tryAcquire: jest.Mock };
}) {
  const membership = overrides.membership ?? { findActiveMembership: jest.fn().mockResolvedValue({ role: 'PARTICIPANT' }) };
  const prisma = overrides.prisma ?? {
    room: { findUnique: jest.fn().mockResolvedValue({ appId: 'quiz', manifestVersion: 1, appSettings: null }) },
    logEvent: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const eventLog = overrides.eventLog ?? { commitAppEvent: jest.fn().mockResolvedValue({}) };
  const outbox = overrides.outbox ?? { run: jest.fn((fn: (tx: unknown) => unknown) => fn('tx')) };
  const tokens = overrides.tokens ?? { verifyAccessToken: jest.fn().mockReturnValue(GUEST_CLAIMS) };
  const reconnectLimiter = overrides.reconnectLimiter ?? { tryAcquire: jest.fn().mockReturnValue(true) };
  const gateway = new RealtimeGateway(
    tokens as never,
    prisma as never,
    membership as never,
    { getManifest: jest.fn().mockReturnValue(undefined), getEventDefinition: jest.fn().mockReturnValue(undefined) } as never,
    eventLog as never,
    outbox as never,
    new ProjectionService(),
    overrides.registry ?? new SubscriptionRegistry(),
    { subscribe: jest.fn(), publish: jest.fn() } as never,
    reconnectLimiter as never,
    {} as never,
  );
  return { gateway, membership, prisma, eventLog, outbox, tokens, reconnectLimiter };
}

const ackOf = () => {
  const calls: unknown[] = [];
  const ack: Ack = (v) => calls.push(v);
  return { ack, calls };
};

describe('RealtimeGateway.handleSubscribe', () => {
  it('rejects malformed payloads with REQUEST_INVALID', async () => {
    const { gateway } = makeGateway({});
    const { ack, calls } = ackOf();
    await gateway.handleSubscribe(fakeSocket() as never, { roomId: 'nope' }, ack);
    expect(calls).toEqual([{ code: 'REQUEST_INVALID' }]);
  });

  it('guest cannot subscribe to a room outside the token scope (REQ-ID-016)', async () => {
    const { gateway } = makeGateway({});
    const { ack, calls } = ackOf();
    await gateway.handleSubscribe(fakeSocket() as never, { roomId: '99999999-9999-4999-8999-999999999999' }, ack);
    expect(calls).toEqual([{ code: 'ACTOR_NOT_MEMBER' }]);
  });

  it('non-member gets ACTOR_NOT_MEMBER (REQ-SEC-003)', async () => {
    const { gateway } = makeGateway({ membership: { findActiveMembership: jest.fn().mockResolvedValue(null) } });
    const { ack, calls } = ackOf();
    await gateway.handleSubscribe(fakeSocket() as never, { roomId: ROOM }, ack);
    expect(calls).toEqual([{ code: 'ACTOR_NOT_MEMBER' }]);
  });

  it('participant joins the room channel with a public snapshot', async () => {
    const registry = new SubscriptionRegistry();
    const { gateway } = makeGateway({ registry });
    const socket = fakeSocket();
    const { ack, calls } = ackOf();
    await gateway.handleSubscribe(socket as never, { roomId: ROOM }, ack);
    expect(socket.joined).toEqual([`room:${ROOM}`]);
    expect(calls).toEqual([{ ok: true, snapshot: { events: [], appSettings: {} } }]);
    expect(registry.get('socket-1')).toMatchObject({ identityId: GUEST_CLAIMS.sub, roomId: ROOM, level: 'public' });
  });

  it('organizer joins both channels at organizer level', async () => {
    const { gateway } = makeGateway({ membership: { findActiveMembership: jest.fn().mockResolvedValue({ role: 'ORGANIZER' }) } });
    const socket = fakeSocket();
    const { ack, calls } = ackOf();
    await gateway.handleSubscribe(socket as never, { roomId: ROOM }, ack);
    expect(socket.joined).toEqual([`room:${ROOM}`, `room:${ROOM}:organizer`]);
    expect(calls).toEqual([{ ok: true, snapshot: { events: [], appSettings: {} } }]);
  });

  it('second subscription of the same socket to another room is REQUEST_INVALID', async () => {
    const registry = new SubscriptionRegistry();
    registry.add({ socketId: 'socket-1', identityId: GUEST_CLAIMS.sub, roomId: ROOM, level: 'public' });
    const { gateway } = makeGateway({ registry });
    const { ack, calls } = ackOf();
    await gateway.handleSubscribe(fakeSocket() as never, { roomId: ROOM }, ack); // re-subscribe в ту же — ок
    expect(calls[0]).toMatchObject({ ok: true });
    const claims2 = { ...GUEST_CLAIMS, roomId: ROOM };
    void claims2;
    // чужая комната для того же сокета:
    const other = fakeSocket({ ...GUEST_CLAIMS, roomId: '99999999-9999-4999-8999-999999999999' });
    const { ack: ack2, calls: calls2 } = ackOf();
    await gateway.handleSubscribe(other as never, { roomId: '99999999-9999-4999-8999-999999999999' }, ack2);
    expect(calls2).toEqual([{ code: 'REQUEST_INVALID' }]);
  });
});

describe('RealtimeGateway.handlePublish', () => {
  const SUBSCRIBED_ROOM = ROOM;

  function subscribedGateway(overrides: Parameters<typeof makeGateway>[0] = {}) {
    const registry = new SubscriptionRegistry();
    registry.add({ socketId: 'socket-1', identityId: GUEST_CLAIMS.sub, roomId: SUBSCRIBED_ROOM, level: 'public' });
    return makeGateway({ ...overrides, registry });
  }

  it('rejects malformed payloads with REQUEST_INVALID', async () => {
    const { gateway } = subscribedGateway();
    const { ack, calls } = ackOf();
    await gateway.handlePublish(fakeSocket() as never, { type: 'bad', payload: {} }, ack);
    expect(calls).toEqual([{ code: 'REQUEST_INVALID' }]);
  });

  it('unsubscribed socket gets ACTOR_NOT_MEMBER', async () => {
    const { gateway } = makeGateway({});
    const { ack, calls } = ackOf();
    await gateway.handlePublish(fakeSocket() as never, { type: 'quiz.answer.submitted', payload: {} }, ack);
    expect(calls).toEqual([{ code: 'ACTOR_NOT_MEMBER' }]);
  });

  it('core namespace is closed for clients (EVENT_UNKNOWN_TYPE)', async () => {
    const { gateway } = subscribedGateway();
    const { ack, calls } = ackOf();
    await gateway.handlePublish(fakeSocket() as never, { type: 'core.room.completed', payload: {} }, ack);
    expect(calls).toEqual([{ code: 'EVENT_UNKNOWN_TYPE' }]);
  });

  it('maps commit-chain errors via the mapping table (REQ-SEC-006)', async () => {
    const { RoomNotActiveError } = await import('./realtime.errors');
    const outbox = { run: jest.fn().mockRejectedValue(new RoomNotActiveError('sealed')) };
    const { gateway } = subscribedGateway({ outbox });
    const { ack, calls } = ackOf();
    await gateway.handlePublish(fakeSocket() as never, { type: 'quiz.answer.submitted', payload: { c: 1 } }, ack);
    expect(calls).toEqual([{ code: 'ROOM_LOG_SEALED' }]);
  });

  it('commits with actorId from claims, roomId from the subscription (REQ-RT-009)', async () => {
    const eventLog = { commitAppEvent: jest.fn().mockResolvedValue({}) };
    const outbox = { run: jest.fn((fn: (tx: unknown) => unknown) => fn('tx')) };
    const { gateway } = subscribedGateway({ eventLog, outbox });
    const { ack, calls } = ackOf();
    await gateway.handlePublish(fakeSocket() as never, { type: 'quiz.answer.submitted', payload: { c: 1 }, visibility: 'public' }, ack);
    expect(calls).toEqual([{ ok: true }]);
    expect(eventLog.commitAppEvent).toHaveBeenCalledWith(
      'tx', SUBSCRIBED_ROOM, 'answer.submitted', { c: 1 }, 'public', GUEST_CLAIMS.sub,
    );
  });

  it('defaults visibility to the type ceiling when omitted (design §0.6)', async () => {
    const eventLog = { commitAppEvent: jest.fn().mockResolvedValue({}) };
    const outbox = { run: jest.fn((fn: (tx: unknown) => unknown) => fn('tx')) };
    const appRegistry = {
      getManifest: jest.fn(),
      getEventDefinition: jest.fn().mockReturnValue({ visibility: 'organizer', schema: {}, version: 1 }),
    };
    const registry = new SubscriptionRegistry();
    registry.add({ socketId: 'socket-1', identityId: GUEST_CLAIMS.sub, roomId: SUBSCRIBED_ROOM, level: 'public' });
    const gateway = new RealtimeGateway(
      { verifyAccessToken: jest.fn() } as never,
      { room: { findUnique: jest.fn().mockResolvedValue({ manifestVersion: 1 }) }, logEvent: { findMany: jest.fn() } } as never,
      { findActiveMembership: jest.fn() } as never,
      appRegistry as never,
      eventLog as never,
      outbox as never,
      new ProjectionService(),
      registry,
      { subscribe: jest.fn(), publish: jest.fn() } as never,
      { tryAcquire: jest.fn() } as never,
      {} as never,
    );
    const { ack } = ackOf();
    await gateway.handlePublish(fakeSocket() as never, { type: 'quiz.answer.submitted', payload: { c: 1 } }, ack);
    expect(eventLog.commitAppEvent).toHaveBeenCalledWith(
      'tx', SUBSCRIBED_ROOM, 'answer.submitted', { c: 1 }, 'organizer', GUEST_CLAIMS.sub,
    );
  });
});

describe('RealtimeGateway fan-out and revoke', () => {
  function gatewayWithServer() {
    const emitted: { room: string; event: string; payload: unknown }[] = [];
    const sockets = new Map<string, FakeSocket>();
    const server = {
      sockets: { sockets },
      to(room: string) {
        return { emit: (event: string, payload: unknown) => emitted.push({ room, event, payload }) };
      },
    };
    const registry = new SubscriptionRegistry();
    const { gateway } = makeGateway({ registry });
    (gateway as unknown as { server: unknown }).server = server;
    return { gateway, emitted, sockets, registry };
  }

  const EVENT_ROW = {
    roomId: ROOM,
    seq: 5,
    type: 'quiz.answer.submitted',
    payload: { c: 1 },
    actorId: GUEST_CLAIMS.sub,
    schemaVersion: 1,
    recordedAt: new Date(),
  };

  it('fanOut delivers public events to the room, organizer to the organizer channel, module-private nowhere (REQ-CORE-005)', () => {
    const { gateway, emitted } = gatewayWithServer();
    (gateway as unknown as { fanOut(e: unknown[]): void }).fanOut([
      { ...EVENT_ROW, visibility: 'PUBLIC' },
      { ...EVENT_ROW, visibility: 'ORGANIZER' },
      { ...EVENT_ROW, visibility: 'MODULE_PRIVATE' },
    ]);
    expect(emitted.map((e) => e.room)).toEqual([`room:${ROOM}`, `room:${ROOM}:organizer`]);
    expect(emitted[0].event).toBe(REALTIME_MESSAGES.EVENT);
    expect(emitted[0].payload).toEqual({ type: 'quiz.answer.submitted', payload: { c: 1 }, actorId: GUEST_CLAIMS.sub });
  });

  it('revokeRoomAccess disconnects every socket of the identity in the room (REQ-SEC-003 hook)', () => {
    const { gateway, sockets, registry } = gatewayWithServer();
    const s1 = fakeSocket();
    const s2 = { ...fakeSocket(), id: 'socket-2' };
    sockets.set('socket-1', s1);
    sockets.set('socket-2', s2);
    registry.add({ socketId: 'socket-1', identityId: GUEST_CLAIMS.sub, roomId: ROOM, level: 'public' });
    registry.add({ socketId: 'socket-2', identityId: GUEST_CLAIMS.sub, roomId: ROOM, level: 'public' });
    gateway.revokeRoomAccess(GUEST_CLAIMS.sub, ROOM);
    expect(s1.disconnected).toBe(true);
    expect(s2.disconnected).toBe(true);
    expect(registry.socketsOf(GUEST_CLAIMS.sub, ROOM)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/core test realtime.gateway`
Expected: FAIL — `./realtime.gateway` не существует.

- [ ] **Step 4: Implementation — gateway**

`packages/core/src/realtime/realtime.gateway.ts`:

```ts
import { Inject, Logger } from '@nestjs/common';
import { OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import {
  ContractError,
  publishRequestSchema,
  REALTIME_MESSAGES,
  resolveTypeOwner,
  subscribeRequestSchema,
  type ContractErrorCode,
  type ContractErrorPayload,
  type ProjectedEvent,
  type PublishOkAck,
  type PublishRequest,
  type RoomSnapshot,
  type SubscribeOkAck,
  type Visibility,
} from '@mymozhem/sdk';
import type { LogEvent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { TokenService, type AccessClaims } from '../auth/token.service';
import { MembershipService } from '../membership/membership.service';
import { JoinRateLimiter } from '../membership/join-rate-limiter';
import { AppRegistryService } from '../app-registry/app-registry.service';
import { EventLogService } from './event-log.service';
import { EventOutbox } from './event-outbox';
import { ProjectionService, type OutwardLevel } from './projection.service';
import { RealtimeBus } from './realtime-bus';
import { RealtimeError } from './realtime.errors';
import { contractCodeFor } from './error-mapping';
import { SubscriptionRegistry } from './subscription-registry';
import { RECONNECT_RATE_LIMITER } from './realtime.tokens';

type Ack<T> = (result: T | ContractErrorPayload) => void;

// Socket.io-комнаты: общая (все члены) и organizer-канал (design §5). module-private
// канала не существует — уровень наружу не доставляется никогда (REQ-CORE-005).
const roomChannel = (roomId: string): string => `room:${roomId}`;
const organizerChannel = (roomId: string): string => `room:${roomId}:organizer`;

const claimsOf = (socket: Socket): AccessClaims => socket.data.claims as AccessClaims;

// Единственный Socket.io-код ядра (REQ-RT-006; boundary-правило socketio-only-in-realtime).
// Handshake = access JWT (REQ-RT-009: claims — единственный источник actorId).
// Наружу ровно {code} (REQ-SEC-006); причины — только в серверный лог.
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit<Server> {
  private readonly logger = new Logger(RealtimeGateway.name);
  private server!: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
    private readonly appRegistry: AppRegistryService,
    private readonly eventLog: EventLogService,
    private readonly outbox: EventOutbox,
    private readonly projection: ProjectionService,
    private readonly registry: SubscriptionRegistry,
    private readonly bus: RealtimeBus,
    @Inject(RECONNECT_RATE_LIMITER) private readonly reconnectLimiter: JoinRateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  afterInit(server: Server): void {
    this.server = server;
    server.use((socket, next) => this.authenticate(socket, next));
    server.on('connection', (socket) => {
      socket.on(REALTIME_MESSAGES.SUBSCRIBE, (payload: unknown, ack: Ack<SubscribeOkAck>) =>
        void this.handleSubscribe(socket, payload, ack),
      );
      socket.on(REALTIME_MESSAGES.PUBLISH, (payload: unknown, ack: Ack<PublishOkAck>) =>
        void this.handlePublish(socket, payload, ack),
      );
      socket.on('disconnect', () => this.registry.remove(socket.id));
    });
    this.bus.subscribe((events) => this.fanOut(events));
  }

  // Handshake (design §4): отказы аутентификации — один SESSION_INVALID (причины не
  // различаются снаружи, как в refresh); потолок reconnect (REQ-RT-015, объём v1.3)
  // — RATE_LIMITED. Код уходит в message connect_error — он и есть wire-код.
  private authenticate(socket: Socket, next: (err?: Error) => void): void {
    let claims: AccessClaims;
    try {
      const token = (socket.handshake.auth as Record<string, unknown>).token;
      claims = this.tokens.verifyAccessToken(typeof token === 'string' ? token : '');
    } catch (err) {
      this.logger.warn(`socket auth failed: ${(err as Error).message}`);
      next(new Error('SESSION_INVALID'));
      return;
    }
    // Per-identity потолок на успешный handshake: каждый reconnect тянет replay —
    // точка учёта одна и самая ранняя после аутентификации; неаутентифицированные
    // попытки не считаются (identity ещё нет).
    if (!this.reconnectLimiter.tryAcquire(claims.sub)) {
      next(new Error('RATE_LIMITED'));
      return;
    }
    socket.data.claims = claims;
    next();
  }

  async handleSubscribe(socket: Socket, payload: unknown, ack: Ack<SubscribeOkAck>): Promise<void> {
    const parsed = subscribeRequestSchema.safeParse(payload);
    if (!parsed.success) {
      ack({ code: 'REQUEST_INVALID' });
      return;
    }
    const claims = claimsOf(socket);
    const { roomId } = parsed.data;
    // REQ-ID-016: гостевой scope зашит в токен — GUEST подписывается только на свою
    // комнату; REGISTERED (токены — с OAuth-среза) решает membership-гейт.
    if (claims.kind === 'GUEST' && claims.roomId !== roomId) {
      ack({ code: 'ACTOR_NOT_MEMBER' });
      return;
    }
    // Мульти-подписка не строится (design §4): re-subscribe в ту же комнату —
    // идемпотентный повторный snapshot, в чужую — отказ.
    const existing = this.registry.get(socket.id);
    if (existing !== undefined && existing.roomId !== roomId) {
      ack({ code: 'REQUEST_INVALID' });
      return;
    }
    // REQ-SEC-003: чтение подресурсов комнаты — только членам.
    const membership = await this.membership.findActiveMembership(roomId, claims.sub);
    if (!membership) {
      ack({ code: 'ACTOR_NOT_MEMBER' });
      return;
    }
    // MODERATOR в MVP без прав сверх PARTICIPANT (amendment v1.3) → public.
    const level: OutwardLevel = membership.role === 'ORGANIZER' ? 'organizer' : 'public';
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    const events = await this.prisma.logEvent.findMany({
      where: { roomId },
      orderBy: { seq: 'asc' },
    });
    const manifest =
      room?.appId != null && room.manifestVersion != null
        ? this.appRegistry.getManifest(room.appId, room.manifestVersion)
        : undefined;
    const snapshot: RoomSnapshot = {
      events: this.projection.projectEvents(events, level),
      appSettings: this.projection.projectAppSettings(room?.appSettings ?? null, manifest, level),
    };
    this.registry.add({ socketId: socket.id, identityId: claims.sub, roomId, level });
    await socket.join(roomChannel(roomId));
    if (level === 'organizer') await socket.join(organizerChannel(roomId));
    ack({ ok: true, snapshot });
  }

  async handlePublish(socket: Socket, payload: unknown, ack: Ack<PublishOkAck>): Promise<void> {
    const parsed = publishRequestSchema.safeParse(payload);
    if (!parsed.success) {
      ack({ code: 'REQUEST_INVALID' });
      return;
    }
    // roomId — из подписки, actorId — из claims: из payload не берётся ничего,
    // кроме данных самого события (REQ-RT-009, design §5).
    const sub = this.registry.get(socket.id);
    if (sub === undefined) {
      ack({ code: 'ACTOR_NOT_MEMBER' });
      return;
    }
    try {
      // Владелец типа — из имени: core-пространство для клиента закрыто (lifecycle
      // эмитит только ядро); тип чужого app отсутствует в пиннутом манифесте —
      // отсекает шаг 4 commit-цепочки (EVENT_UNKNOWN_TYPE).
      const owner = resolveTypeOwner(parsed.data.type);
      if (owner.kind === 'core') {
        ack({ code: 'EVENT_UNKNOWN_TYPE' });
        return;
      }
      const visibility = await this.effectiveVisibility(sub.roomId, owner.appId, owner.shortName, parsed.data);
      await this.outbox.run((tx) =>
        this.eventLog.commitAppEvent(tx, sub.roomId, owner.shortName, parsed.data.payload, visibility, claimsOf(socket).sub),
      );
      ack({ ok: true });
    } catch (err) {
      ack({ code: this.wireCodeOf(err) });
    }
  }

  // §0.6: умолчание visibility — декларированный потолок типа. Неизвестному типу
  // дефолт безразличен (commit откажет EVENT_UNKNOWN_TYPE) — fail-safe module-private.
  private async effectiveVisibility(
    roomId: string,
    appId: string,
    shortName: string,
    request: PublishRequest,
  ): Promise<Visibility> {
    if (request.visibility !== undefined) return request.visibility;
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { manifestVersion: true },
    });
    const definition =
      room?.manifestVersion != null
        ? this.appRegistry.getEventDefinition(appId, room.manifestVersion, shortName)
        : undefined;
    return definition?.visibility ?? 'module-private';
  }

  // Live-доставка: проекцию строит ProjectionService — ручной фильтрации полей
  // здесь нет и быть не может (REQ-CORE-005).
  private fanOut(events: readonly LogEvent[]): void {
    for (const event of events) {
      const projected: ProjectedEvent = this.projection.projectEvent(event);
      if (event.visibility === 'PUBLIC') {
        this.server.to(roomChannel(event.roomId)).emit(REALTIME_MESSAGES.EVENT, projected);
      } else if (event.visibility === 'ORGANIZER') {
        this.server.to(organizerChannel(event.roomId)).emit(REALTIME_MESSAGES.EVENT, projected);
      }
    }
  }

  // Hook среза исключения (design §4, §0.2): немедленный разрыв всех подписок
  // identity в комнате. Вызывающего пока нет — срез исключения ОБЯЗАН вызвать этот
  // метод (шов, зафиксирован в дизайне §9).
  revokeRoomAccess(identityId: string, roomId: string): void {
    for (const socketId of this.registry.socketsOf(identityId, roomId)) {
      const socket = this.server.sockets.sockets.get(socketId);
      this.registry.remove(socketId);
      if (socket !== undefined) {
        socket.leave(roomChannel(roomId));
        socket.leave(organizerChannel(roomId));
        socket.disconnect(true);
      }
    }
  }

  private wireCodeOf(err: unknown): ContractErrorCode {
    if (err instanceof RealtimeError) return contractCodeFor(err);
    if (err instanceof ContractError) return err.code;
    // REQ-SEC-006: неизвестное — INTERNAL_ERROR, детали только в серверный лог.
    this.logger.error(err);
    return 'INTERNAL_ERROR';
  }
}
```

(Примечание для имплементера: `this.config` в gateway на текущем объёме не читается — CORS живёт в IoAdapter, лимит запечатан в фабрике. Если lint ругнётся на unused private — убрать параметр `config` и `@Inject(APP_CONFIG)` импорт, а не глушить правило.)

- [ ] **Step 5: IoAdapter**

`packages/core/src/realtime/io-adapter.ts`:

```ts
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { AppConfig } from '../config/config.schema';

// CORS сокета повторяет HTTP-политику из того же конфига (design §8); wildcard в
// production запрещён superRefine конфиг-схемы (REQ-SEC-008). Подключается в
// apps/server main.ts и в e2e-boot (там своя копия boot-последовательности).
export class ConfigurableIoAdapter extends IoAdapter {
  constructor(private readonly config: AppConfig) {
    super();
  }

  override createIOServer(port: number, options?: Record<string, unknown>): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.config.CORS_ORIGINS },
    });
  }
}
```

(Если компилятор не согласится с сужением типов override — выровнять сигнатуру по фактической из `@nestjs/platform-socket.io` и зафиксировать отклонение в леджере.)

- [ ] **Step 6: Module wiring + barrel + main.ts**

`packages/core/src/realtime/realtime.module.ts` целиком:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AppRegistryModule } from '../app-registry/app-registry.module';
import { AuthModule } from '../auth/auth.module';
import { MembershipModule } from '../membership/membership.module';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { JoinRateLimiter } from '../membership/join-rate-limiter';
import { EventLogService } from './event-log.service';
import { EventEmitLimiter } from './event-emit-limiter';
import { RealtimeBus } from './realtime-bus';
import { EventOutbox } from './event-outbox';
import { ProjectionService } from './projection.service';
import { SubscriptionRegistry } from './subscription-registry';
import { RealtimeGateway } from './realtime.gateway';
import { RECONNECT_RATE_LIMITER } from './realtime.tokens';

// PrismaModule нужен EventOutbox'у (runner владеет транзакцией); сам примитив
// записи по-прежнему работает на транзакционном клиенте вызывающего — атомарность
// «действие + лог» (REQ-DEV-008) не меняется. Единственный модуль ядра, импортирующий
// socket.io (REQ-RT-006 + boundary-правило).
@Module({
  imports: [ConfigModule, AppRegistryModule, PrismaModule, AuthModule, MembershipModule],
  providers: [
    {
      provide: EventEmitLimiter,
      useFactory: (config: AppConfig) => new EventEmitLimiter(config.EVENT_EMIT_RATE_LIMIT_PER_MIN),
      inject: [APP_CONFIG],
    },
    {
      // REQ-RT-015 (объём v1.3): отдельный инстанс — состояние не делится с
      // join/refresh лимитерами; бэкофф/режимы — ф.4.
      provide: RECONNECT_RATE_LIMITER,
      useFactory: (config: AppConfig) => new JoinRateLimiter(config.RECONNECT_RATE_LIMIT_PER_MIN),
      inject: [APP_CONFIG],
    },
    RealtimeBus,
    EventOutbox,
    EventLogService,
    ProjectionService,
    SubscriptionRegistry,
    RealtimeGateway,
  ],
  exports: [EventLogService, EventOutbox],
})
export class RealtimeModule {}
```

В `packages/core/src/index.ts` после строки `export * from './realtime/event-outbox';` добавить:

```ts
export * from './realtime/projection.service';
export * from './realtime/subscription-registry';
export * from './realtime/realtime.tokens';
export * from './realtime/error-mapping';
export * from './realtime/io-adapter';
export * from './realtime/realtime.gateway';
```

В `apps/server/src/main.ts` — импорт `ConfigurableIoAdapter` из `@mymozhem/core` и строка до `app.listen`:

```ts
  // Socket.io на том же HTTP-сервере; CORS — из того же конфига (design §8).
  app.useWebSocketAdapter(new ConfigurableIoAdapter(config));
```

- [ ] **Step 7: Run unit test + build**

Run: `pnpm --filter @mymozhem/core test realtime.gateway`
Expected: PASS (13 тестов).
Run: `pnpm build && pnpm --filter @mymozhem/core test && pnpm lint && pnpm typecheck`
Expected: всё зелёное (включая существующие спеки).

- [ ] **Step 8: Commit**

```bash
git add packages/core apps/server/src/main.ts pnpm-lock.yaml
git commit -m "feat(core): RealtimeGateway (handshake/subscribe/publish/fan-out/revoke-hook) + ConfigurableIoAdapter (REQ-RT-006/009, REQ-SEC-003/006)"
```

---

### Task 8: e2e realtime (apps/server, socket.io-client)

**Files:**
- Modify: `apps/server/package.json` (devDep `socket.io-client`)
- Create: `apps/server/test/realtime.e2e-spec.ts`

**Interfaces:**
- Consumes: gateway/adapter из Task 7 (dist собран); HTTP join/refresh из транспортного среза; `APP_MANIFESTS` override для манифеста с app-событиями.
- Produces: критерии выхода ф.1 — late-join replay, видимость по каналу realtime, потолок reconnect — подтверждены на проводе.

- [ ] **Step 1: Зависимость**

```bash
pnpm --filter @mymozhem/server add -D socket.io-client@^4.8.1
pnpm install
```

- [ ] **Step 2: e2e spec**

`apps/server/test/realtime.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { io as clientIo, type Socket as ClientSocket } from 'socket.io-client';
import { tokenResponseSchema, REALTIME_MESSAGES, type AppManifest } from '@mymozhem/sdk';
import {
  APP_MANIFESTS,
  ConfigurableIoAdapter,
  EventEmitLimiter,
  EventLogService,
  EventOutbox,
  IdentityService,
  JoinRateLimiter,
  MembershipService,
  RealtimeBus,
  RealtimeGateway,
  RoomService,
  TEST_CONFIG,
  TokenService,
  loadConfig,
  seedIdentity,
  startTestDb,
  type TestDb,
} from '@mymozhem/core';
import { AppModule } from '../src/app.module';

jest.setTimeout(180_000);

const ORG = '00000000-0000-0000-0000-000000000001';

// Манифест с типами всех трёх уровней (design §7): answer — public, round — organizer,
// secret — module-private.
const TEST_APP: AppManifest = {
  appId: 'test-app',
  manifestVersion: 1,
  contractRange: '^1.0.0',
  appSettings: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      label: { type: 'string', 'x-visibility': 'public' },
      answers: { type: 'object' }, // без аннотации → module-private (fail-safe)
    },
  },
  events: {
    'note.posted': {
      schema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
      visibility: 'public',
    },
    'round.hinted': {
      schema: { type: 'object', properties: { hint: { type: 'string' } }, required: ['hint'] },
      visibility: 'organizer',
    },
    'secret.recorded': {
      schema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
      visibility: 'module-private',
    },
  },
};

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

// Boot зеркалит main.ts + websocket-адаптер (transport e2e прецедент); APP_MANIFESTS
// подменён фикстурным манифестом — в фазе 1 провайдер пуст (design §5 шов).
async function createApp(envOverrides: Record<string, string> = {}): Promise<NestFastifyApplication> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(envOverrides)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    const config = loadConfig(process.env);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_MANIFESTS)
      .useValue([TEST_APP])
      .compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie);
    await app.register(fastifyHelmet);
    await app.register(fastifyCors, { origin: config.CORS_ORIGINS });
    app.useWebSocketAdapter(new ConfigurableIoAdapter(config));
    await app.init();
    await app.listen(0, '127.0.0.1');
    return app;
  } finally {
    for (const key of Object.keys(envOverrides)) restoreEnv(key, saved[key]);
  }
}

function portOf(app: NestFastifyApplication): number {
  const address = app.getHttpAdapter().getInstance().server.address();
  if (address === null || typeof address === 'string') throw new Error('no listening address');
  return address.port;
}

function connect(port: number, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = clientIo(`http://127.0.0.1:${port}`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => {
      socket.close();
      reject(err);
    });
  });
}

function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, (res: T) => resolve(res)));
}

function waitEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, (data: T) => resolve(data)));
}

// 4xx-отказ handshake: connect_error.message — wire-код (design §4).
function connectError(port: number, token: string): Promise<string> {
  return connect(port, token).then(
    (socket) => {
      socket.close();
      throw new Error('connected unexpectedly');
    },
    (err: Error) => err.message,
  );
}

describe('Realtime (e2e)', () => {
  let db: TestDb;
  let roomService: RoomService;
  let tokens: TokenService;
  let app: NestFastifyApplication;
  let port: number;
  let savedDatabaseUrl: string | undefined;
  let savedJwtSecret: string | undefined;

  beforeAll(async () => {
    savedDatabaseUrl = process.env.DATABASE_URL;
    savedJwtSecret = process.env.JWT_SECRET;
    db = await startTestDb();
    process.env.JWT_SECRET = TEST_CONFIG.JWT_SECRET;
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    const bus = new RealtimeBus();
    const outbox = new EventOutbox(db.prisma, bus);
    const registry = new (await import('@mymozhem/core')).AppRegistryService([TEST_APP]);
    const eventLog = new EventLogService(registry, new EventEmitLimiter(1000), TEST_CONFIG, outbox);
    roomService = new RoomService(
      db.prisma,
      eventLog,
      outbox,
      registry,
      new MembershipService(db.prisma, new IdentityService(db.prisma), new JoinRateLimiter(1000), TEST_CONFIG),
      TEST_CONFIG,
    );
    tokens = new TokenService(db.prisma, TEST_CONFIG);
    app = await createApp();
    port = portOf(app);
  });

  afterAll(async () => {
    await app.close();
    await db.stop();
    restoreEnv('DATABASE_URL', savedDatabaseUrl);
    restoreEnv('JWT_SECRET', savedJwtSecret);
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE identity."Session", membership."Membership", room."Room" CASCADE',
    );
  });

  // Активная комната с пином TEST_APP + guest join по HTTP → access token участника.
  async function activeRoomWithGuest() {
    const room = await roomService.create(ORG);
    await roomService.configure(room.id, {
      appId: 'test-app',
      manifestVersion: 1,
      settings: { label: 'live', answers: { r1: 2 } },
    });
    await roomService.activate(room.id, ORG);
    const res = await app.inject({
      method: 'POST',
      url: '/rooms/join',
      payload: { code: room.code, displayName: 'Гостя' },
    });
    expect(res.statusCode).toBe(201);
    const { accessToken } = tokenResponseSchema.parse(res.json());
    return { room, accessToken };
  }

  async function organizerToken(roomId: string): Promise<string> {
    const issued = await tokens.issueGuestTokens(ORG, roomId);
    return issued.accessToken;
  }

  it('late-join replay: snapshot несёт видимую проекцию без seq/visibility/cursor (критерий ф.1, REQ-RT-003/011a)', async () => {
    const { room, accessToken } = await activeRoomWithGuest();
    const socket = await connect(port, accessToken);
    const ack = await emitAck<{ ok: true; snapshot: { events: Record<string, unknown>[]; appSettings: Record<string, unknown> } }>(
      socket, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id },
    );
    expect(ack.ok).toBe(true);
    expect(ack.snapshot.events.map((e) => e.type)).toEqual(['core.room.activated']);
    for (const e of ack.snapshot.events) {
      expect(Object.keys(e).sort()).toEqual(['actorId', 'payload', 'type']);
    }
    // appSettings: label — public (виден), answers — module-private (fail-safe, скрыт).
    expect(ack.snapshot.appSettings).toEqual({ label: 'live' });
    socket.close();
  });

  it('publish → commit → live-доставка второму подписчику; actorId из токена (REQ-RT-009)', async () => {
    const { room, accessToken } = await activeRoomWithGuest();
    const pub = await connect(port, accessToken);
    const sub = await connect(port, accessToken);
    await emitAck(pub, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });
    await emitAck(sub, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });

    const received = waitEvent<{ type: string; payload: unknown; actorId: string | null }>(sub, REALTIME_MESSAGES.EVENT);
    const ack = await emitAck<{ ok: true }>(pub, REALTIME_MESSAGES.PUBLISH, {
      type: 'test-app.note.posted',
      payload: { n: 1, actorId: 'spoofed' }, // actorId в payload игнорируется
    });
    expect(ack.ok).toBe(true);
    const event = await received;
    expect(event.type).toBe('test-app.note.posted');
    expect(event.payload).toEqual({ n: 1, actorId: 'spoofed' }); // payload — данные приложения как есть
    const claims = tokens.verifyAccessToken(accessToken);
    expect(event.actorId).toBe(claims.sub); // actorId конверта — только из токена
    pub.close();
    sub.close();
  });

  it('publish в запечатанную комнату → ROOM_LOG_SEALED (REQ-RT-016 через провод)', async () => {
    const { room, accessToken } = await activeRoomWithGuest();
    const socket = await connect(port, accessToken);
    await emitAck(socket, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });
    await roomService.complete(room.id, ORG);
    const ack = await emitAck(socket, REALTIME_MESSAGES.PUBLISH, {
      type: 'test-app.note.posted',
      payload: { n: 1 },
    });
    expect(ack).toEqual({ code: 'ROOM_LOG_SEALED' });
    socket.close();
  });

  it('видимость live: organizer-уровень — только организатору, module-private — никому (REQ-CORE-005, критерий ф.1)', async () => {
    const { room, accessToken } = await activeRoomWithGuest();
    const organizer = await connect(port, await organizerToken(room.id));
    const participant = await connect(port, accessToken);
    await emitAck(organizer, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });
    await emitAck(participant, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });

    const organizerEvents: { type: string }[] = [];
    const participantEvents: { type: string }[] = [];
    organizer.on(REALTIME_MESSAGES.EVENT, (e: { type: string }) => organizerEvents.push(e));
    participant.on(REALTIME_MESSAGES.EVENT, (e: { type: string }) => participantEvents.push(e));

    const pub = await connect(port, accessToken);
    await emitAck(pub, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });
    await emitAck(pub, REALTIME_MESSAGES.PUBLISH, { type: 'test-app.note.posted', payload: { n: 1 } });
    await emitAck(pub, REALTIME_MESSAGES.PUBLISH, { type: 'test-app.round.hinted', payload: { hint: 'h' } });
    await emitAck(pub, REALTIME_MESSAGES.PUBLISH, { type: 'test-app.secret.recorded', payload: { n: 9 } });
    // Доставка асинхронна: ждём public-событие у участника как маркер flush.
    await new Promise<void>((resolve) => {
      participant.once(REALTIME_MESSAGES.EVENT, () => resolve());
      void emitAck(pub, REALTIME_MESSAGES.PUBLISH, { type: 'test-app.note.posted', payload: { n: 2 } });
    });

    expect(participantEvents.map((e) => e.type)).toEqual(['test-app.note.posted', 'test-app.note.posted']);
    expect(organizerEvents.map((e) => e.type)).toEqual([
      'test-app.note.posted',
      'test-app.round.hinted',
      'test-app.note.posted',
    ]);
    organizer.close();
    participant.close();
    pub.close();
  });

  it('гость не подписывается на чужую комнату (scope REQ-ID-016)', async () => {
    const { accessToken } = await activeRoomWithGuest();
    const other = await roomService.create(ORG);
    const socket = await connect(port, accessToken);
    const ack = await emitAck(socket, REALTIME_MESSAGES.SUBSCRIBE, { roomId: other.id });
    expect(ack).toEqual({ code: 'ACTOR_NOT_MEMBER' });
    socket.close();
  });

  it('handshake без валидного токена → SESSION_INVALID', async () => {
    expect(await connectError(port, 'not-a-token')).toBe('SESSION_INVALID');
  });

  it('reconnect-потолок: превышение → RATE_LIMITED (REQ-RT-015, объём v1.3)', async () => {
    const limitedApp = await createApp({ RECONNECT_RATE_LIMIT_PER_MIN: '2' });
    const limitedPort = portOf(limitedApp);
    try {
      const { accessToken } = await activeRoomWithGuest();
      const s1 = await connect(limitedPort, accessToken);
      s1.close();
      const s2 = await connect(limitedPort, accessToken);
      s2.close();
      expect(await connectError(limitedPort, accessToken)).toBe('RATE_LIMITED');
    } finally {
      await limitedApp.close();
    }
  });

  it('revokeRoomAccess разрывает подписки identity в комнате (REQ-SEC-003 hook)', async () => {
    const { room, accessToken } = await activeRoomWithGuest();
    const socket = await connect(port, accessToken);
    await emitAck(socket, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });
    const disconnected = new Promise<void>((resolve) => socket.on('disconnect', () => resolve()));
    const gateway = app.get(RealtimeGateway);
    const claims = tokens.verifyAccessToken(accessToken);
    gateway.revokeRoomAccess(claims.sub, room.id);
    await disconnected;
    // Повторный publish невозможен: подписки нет (сокет отключён сервером).
    expect(socket.connected).toBe(false);
  });
});
```

(Имплементеру: `new (await import('@mymozhem/core')).AppRegistryService` — защита от ленивого резолва named import в jest CJS; если named import `AppRegistryService` уже в шапке работает — использовать его, форму выровнять по первому прогону.)

- [ ] **Step 3: Build + run e2e**

Run: `pnpm build && pnpm --filter @mymozhem/server test`
Expected: PASS всех e2e (transport + health + realtime). Фильтр-прогон для отладки: `pnpm --filter @mymozhem/server test realtime` — проверять >0 матчей.

- [ ] **Step 4: Commit**

```bash
git add apps/server/test/realtime.e2e-spec.ts apps/server/package.json pnpm-lock.yaml
git commit -m "test(server): realtime e2e — replay, видимость live, publish, reconnect-потолок, revoke-hook (критерии ф.1)"
```

---

### Task 9: Финальные гейты

**Files:** любые, затронутые исправлениями.

- [ ] **Step 1: Полный прогон всех гейтов мерджа**

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:int
pnpm boundary-check
pnpm guardrails
```

Expected: всё зелёное. Особое внимание boundary-check: импорт `socket.io` только из `packages/core/src/realtime` (правило уже существует); `socket.io-client` — только в `apps/server/test` (если правило заденет — показать владельцу, не ослаблять молча).

- [ ] **Step 2: LOC-снапшот и HANDOFF — НЕ в этой задаче**

Выполняются по конвенции после мерджа среза (см. HANDOFF.md «LOC-базлайн» и skill handoff) — не часть плана исполнения.

---

## Self-review пройден (заполнено при написании)

- **Spec coverage:** §1 скоуп/REQ — Tasks 1-8 + Global Constraints; §2 компоненты — Tasks 2,4,5,6,7; §3 wire+маппинг — Tasks 2,3; §4 handshake/subscribe/reconnect — Task 7 (+1,6); §5 publish/outbox — Tasks 5,7; §6 проекции — Task 4; §7 тесты — Tasks 2-8; §8 риски — в коде-комментариях и HANDOFF после мерджа; §9 швы — комментарии в revokeRoomAccess/findActiveMembership.
- **Placeholder scan:** TBD/TODO отсутствуют; каждый код-шаг содержит полный код.
- **Type consistency:** `contractCodeFor`, `OutwardLevel`, `RealtimeBus.publish/subscribe`, `EventOutbox.run/stage`, `SubscriptionRegistry.add/get/remove/socketsOf`, `findActiveMembership`, `RECONNECT_RATE_LIMITER`, конструкторы `EventLogService`(4 аргумента)/`RoomService`(6 аргументов, outbox третьим) — сверены между задачами.
