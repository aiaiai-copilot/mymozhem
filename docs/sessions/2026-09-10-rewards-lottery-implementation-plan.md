# Фаза 3 (Rewards + Lottery + TTL-свип + квиз-начисления) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Подсистема rewards в ядре (призы с фондом, автомат награды, ledger начислений), второй app-модуль (лотерея с CSPRNG-розыгрышем и eligibility), перевод квиза на начисления rewards и догоняющий TTL-свип гостей с приостановкой при открытой награде.

**Architecture:** SDK 1.5.0 → 1.6.0 (minor-аддитивно): `capabilities` в манифесте, `AppEffect` + возврат `handlePublish` → `{ commits, effects }` (старая форма «голый массив» — совместимая), `AppHostContext` += `randomInt`/`drawPool`, реестр `REWARDS_EVENTS`, REST DTO rewards. В ядре — `packages/core/src/rewards/` (PostgreSQL-схема `rewards`: Prize с CHECK + ограниченным декрементом, Award с частичным индексом, PointsGrant-ledger); награждение — эффект коммита в той же транзакции `outbox.run` (эффекты ДО событий), связка «ядро не зависит от rewards» — DI-токены `AWARD_EFFECT_HANDLER` (app-runtime/effects) и `ANONYMIZATION_GUARDS` (identity), точка связки — composition root. Свип гостей — джоба на `@nestjs/schedule` с приостановкой через guard'ы. Связывание модулей — только в `apps/server`.

**Tech Stack:** NestJS 11 (Fastify), Prisma 7.8 (PostgreSQL, multiSchema, testcontainers), zod 4.4, Ajv2020 + ajv-formats, socket.io 4, @nestjs/schedule, pnpm workspaces + turbo, jest/ts-jest.

**Spec:** `docs/sessions/2026-09-10-rewards-lottery-design.md` (утверждён владельцем по секциям 2026-09-10; §0 — решения владельца, §7 — критерии выхода). План аргументирует от дизайна — исполнитель читает оба документа.

**Решения владельца при написании плана (2026-09-10, сессия плана):**
1. **AJV `format: "uuid"` enforcement на commit-гейте — подключить `ajv-formats`** (Task 1; дизайн §8 предлагал, владелец подтвердил). Waiver-вариант отклонён.
2. **Lint-запрет `Math.random` в `packages/app-*` — включён задачей** (Task 11; усиление REQ-RWD-011, дизайн §8).

## Global Constraints

- Контракт: `CONTRACT_VERSION` = `1.6.0` и `packages/sdk/package.json` version = `1.6.0` (паритет проверяется контрактным тестом `contract-version.contract.spec.ts`).
- `packages/app-*` НЕ импортирует `packages/core` (boundary `app-only-through-sdk`, уже вооружено); `@mymozhem/sdk` — лист (`sdk-is-leaf`).
- Ядро не зависит от rewards (REQ-RWD-001): единственные разрешённые связки — DI-токены `AWARD_EFFECT_HANDLER` (объявлен в `core/src/app-runtime/effects.ts`) и `ANONYMIZATION_GUARDS` (объявлен в identity) + barrel `core/src/index.ts`; связка — только в composition root. Принуждается новым boundary-правилом (Task 11).
- App-схемы для `defineApp` — без `.refine()/.superRefine()` и checks вне allowlist `REPRESENTABLE_CHECK_KINDS` (conversion guard отклонит). Схемы эффектов и `REWARDS_EVENTS` — статические zod, в JSON Schema НЕ конвертируются (ограничение на них не распространяется).
- actorId — только из аутентифицированного контекста (REQ-RT-009); наружу ровно `{code}` (REQ-SEC-006). PII не в payload'ах событий — только id (REQ-SEC-009).
- Состояние app-модуля — пересоздаваемая проекция из лога (ADR-005, REQ-CORE-004); своих таблиц у лотереи нет. Состояние rewards — в БД (та же REQ-CORE-004).
- Отказ модуля — до коммита, типизированный код из `CONTRACT_ERROR_CODES`. Отказ эффекта → откат всей транзакции (события не коммитятся).
- Замороженные миграции не трогаем: `20260718061612_room_lifecycle`, `20260722151900_identity_seam`, `20260722153952_room_organizer_fk`, `20260722180147_realtime_log_event`, `20260723090841_room_app_config`, `20260729164500_membership_guest_join`, `20260730101037_auth_sessions`, `20260819154552_membership_exclusion`, `20260902191322_oauth_identity_provider`. Схема БД меняется только новой миграцией.
- Частичные уникальные индексы и CHECK — рукописным SQL в миграции + автотест наличия (REQ-DEV-006), БЕЗ preview `partialIndexes`.
- Порядок блокировок: advisory lock комнаты (внутри `appendLocked`) — всегда leaf-most; захватившая его транзакция после этого НЕ пишет в `room."Room"`. Rewards-транзакции пишут только в схему rewards (+ identity.Session при свипе) — конвенция соблюдена по построению.
- Prisma 7.8 adapter-pg: `$queryRaw` не десериализует void-выражения — для `UPDATE ... WHERE` без RETURNING использовать `$executeRaw` (возвращает число затронутых строк). Падающий raw-запрос — `PrismaClientKnownRequestError` код `P2010`, SQLSTATE в `meta.driverAdapterError.cause.originalCode`.
- Prisma 7 CLI работает только из корня репо: `pnpm exec prisma …` из корня (НЕ `pnpm --filter @mymozhem/core exec prisma …`). `pnpm exec prisma generate` требует `DATABASE_URL` и cwd = корень.
- Тесты: unit — `*.spec.ts` (jest default в пакете), интеграционные — `packages/core/**/*.int-spec.ts` (`pnpm --filter @mymozhem/core test:int`, testcontainers, `maxWorkers: 1`, ~8-10 с/файл, нужен запущенный OrbStack/Docker), e2e — `apps/server/test/*.e2e-spec.ts` (`pnpm --filter @mymozhem/server test`).
- **Перед `pnpm --filter @mymozhem/server test` обязателен `pnpm build`** (server e2e резолвит `@mymozhem/core`, `@mymozhem/sdk`, `@mymozhem/app-quiz`, `@mymozhem/app-lottery` из dist). После правок SDK — `pnpm --filter @mymozhem/sdk build` (core резолвит sdk из dist).
- Jest CLI: форма `pnpm --filter @mymozhem/core test:int -- -t "..."` миспарсится — рабочая форма без `--`. Фильтр всегда проверять на >0 матчей. В worktree testPathPattern матчит ПУТЬ целиком, включая имя worktree — для точечного прогона использовать уникальное имя файла (`-- lottery.e2e`), не слово из имени worktree.
- Live-кадр может прийти раньше ack publish (fan-out синхронен с коммитом) — waiters в e2e навешивать ДО триггерящего publish.
- Сырой `$queryRaw` лога отдаёт visibility lowercase (`'public'`), не Prisma-имя — фильтры по логу в e2e учитывают.
- Коммиты: conventional, по-русски, с `Co-Authored-By: Claude Code <noreply@anthropic.com>`. Push — НЕ выполнять (решение владельца).
- Исполнение — в изолированном worktree (superpowers:using-git-worktrees при старте исполнения): `.worktrees/rewards-lottery`, ветка `rewards-lottery`. Леджер исполнения — `.superpowers/sdd/2026-09-10-rewards-lottery-implementation-plan/progress.md` основного чекаута (не в git).
- **Батчи по 3 задачи, каждый батч — новой сессией** (правило владельца 2026-09-02/09): Batch A = Tasks 1-3, Batch B = Tasks 4-6, Batch C = Tasks 7-9, Batch D = Tasks 10-12, Batch E = Task 13 + финальное ревью. Каждая задача завершается коммитом; каждый батч — зелёным конвейером (`pnpm build && pnpm lint && pnpm boundary-check && pnpm guardrails && pnpm test && pnpm test:int`).
- **Гейт 2 (дизайн §0.1):** старт исполнения — отдельное решение владельца после первого живого события. План написан заранее; исполнение не начинать без этого решения.
- Закрываемые REQ (для двухстадийного ревью каждой задачи): REQ-RWD-001/002a/002b/003/004/005/007/009/010/011/013/014, REQ-ID-003/014 (догон свипа), REQ-CTR-002 (расширение трактовки — randomInt/drawPool в ctx, зафиксировано дизайном §2/§8, НЕ считать дрейфом на ревью), REQ-CTR-004/005, REQ-CORE-004, REQ-SEC-009, REQ-RT-004, REQ-DEV-006, REQ-OPS-005. Каждая задача ниже помечена своими REQ.

---

### Task 1: ajv-formats на commit-гейте (enforcement `format: "uuid"`)

**Files:**
- Modify: `packages/core/package.json` (dep `ajv-formats`)
- Modify: `packages/core/src/app-registry/app-registry.service.ts:20` (подключение addFormats)
- Test: `packages/core/src/app-registry/app-registry.service.spec.ts` (существующий — расширить; если файла нет, создать рядом по общему паттерну `*.spec.ts`)

**Interfaces:**
- Consumes: существующий `AppRegistryService.eventValidatorFor(appId, manifestVersion, name, schema): ValidateFunction` (`app-registry.service.ts:62-79`).
- Produces: commit-гейт принуждает `format: "uuid"` (и прочие строковые форматы ajv-formats) для всех app-схем; невалидный uuid в payload отклоняется `EVENT_PAYLOAD_INVALID` до коммита. Опора для клиентских uuid-полей фазы 3 (`drawId`, `prizeId` — Tasks 3, 9).

**REQ:** REQ-CTR-008 (схема владельца принуждается на гейте), follow-up финального ревью ф.2 (AJV warning `unknown format "uuid" ignored`).

- [ ] **Step 1: Failing test — format uuid принуждается**

В `app-registry.service.spec.ts` добавить:

```typescript
// Фаза 3, Task 1 (решение владельца 2026-09-10): ajv-formats на commit-гейте.
// zod v4 эмитит format: "uuid" для z.uuid(); stock Ajv 8 без ajv-formats его
// игнорировал (warning "unknown format") — невалидный uuid проходил гейт.
describe('eventValidatorFor — string formats', () => {
  const service = new AppRegistryService([]);
  const validate = service.eventValidatorFor('testapp', 1, 'draw.run', {
    type: 'object',
    properties: { drawId: { type: 'string', format: 'uuid' } },
    required: ['drawId'],
    additionalProperties: false,
  });

  it('rejects a non-uuid drawId', () => {
    expect(validate({ drawId: 'not-a-uuid' })).toBe(false);
  });

  it('accepts an RFC 9562 uuid', () => {
    expect(validate({ drawId: '3f6b2b6e-9c5a-4f1e-8b2d-7a9c1e0f2a3b' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/core test -- app-registry`
Expected: FAIL — `rejects a non-uuid drawId` падает (validate вернул true; в stderr warning Ajv `unknown format "uuid" ignored`). Проверить, что фильтр `app-registry` матчит >0 тестов.

- [ ] **Step 3: Implement — подключить ajv-formats**

`packages/core/package.json`, в `dependencies` (рядом с `ajv`): `"ajv-formats": "^3.0.1"`. Затем `pnpm install` из корня (один lockfile, REQ-DEV-002).

`app-registry.service.ts`: импорт и перенос инициализации Ajv в конструктор:

```typescript
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
```

Поле `private readonly ajv = new Ajv2020(...)` (строка 20) заменить на объявление `private readonly ajv: Ajv2020;`, а в конструкторе первой строкой:

```typescript
    // ajv-formats (фаза 3, Task 1): zod v4 эмитит format: "uuid" для z.uuid();
    // без подключённых форматов Ajv 8 их игнорирует — uuid-поля клиентских команд
    // (drawId/prizeId лотереи) не принуждались бы на commit-гейте.
    this.ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(this.ajv);
```

(Существующий комментарий про Ajv2020/strict над полем перенести к объявлению.)

- [ ] **Step 4: Run — GREEN + регрессионный прогон**

Run: `pnpm --filter @mymozhem/core test && pnpm build && pnpm --filter @mymozhem/core test:int`
Expected: PASS. Внимание: enforcement ломает старые invalid-uuid литералы в int/e2e-спеках (известный follow-up-пакет «чистка invalid-uuid литералов» из HANDOFF — закрывается здесь). Если упавшие спеки найдены — заменить литералы на RFC 9562-валидные v4 uuid (прецедент комментария в `apps/server/test/quiz.e2e-spec.ts:26-28`: z.uuid() zod v4 отклоняет версию 0). Прогнать и `pnpm --filter @mymozhem/server test` (после `pnpm build`) — убедиться, что e2e зелёные.

- [ ] **Step 5: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/src/app-registry
git commit -m "feat(core): ajv-formats на commit-гейте — enforcement format: uuid

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: SDK — контракт 1.6.0 + capabilities манифеста + wire-коды фазы 3

**Files:**
- Modify: `packages/sdk/src/contract-version.ts:8` (`CONTRACT_VERSION`)
- Modify: `packages/sdk/package.json` (`version`)
- Modify: `packages/sdk/src/errors/error-codes.ts` (новые коды)
- Modify: `packages/sdk/src/manifest/manifest.schema.ts` (capabilities)
- Modify: `packages/sdk/src/manifest/define-app.ts` (AppDefinition += capabilities)
- Modify: `packages/sdk/src/manifest/manifest.fixtures.ts` (переделка кейса capabilities)
- Test: `packages/sdk/src/errors/error-codes.contract.spec.ts`, `packages/sdk/src/manifest/manifest.contract.spec.ts`, `packages/sdk/src/manifest/define-app.contract.spec.ts` (существующие — расширить)

**Interfaces:**
- Produces: `APP_CAPABILITIES` (`['rewards'] as const`), `appCapabilitySchema`, тип `AppCapability`; поле `capabilities?: AppCapability[]` в `AppManifest` и `AppDefinition`; коды `'ROOM_NOT_ACTIVE'`, `'CAPABILITY_UNAVAILABLE'`, `'PRIZE_UNKNOWN'`, `'PRIZE_FUND_EXHAUSTED'`, `'DRAW_POOL_EMPTY'`, `'AWARD_UNKNOWN'`, `'REWARD_ALREADY_RESOLVED'` в `ContractErrorCode`. Потребители: Tasks 3, 5, 6, 7, 9, 10.

**REQ:** REQ-RWD-001/005 (capability как форма делегирования), REQ-CTR-004 (версионирование), REQ-CTR-005 (фикстуры).

- [ ] **Step 1: Failing test — новые wire-коды**

В `error-codes.contract.spec.ts` добавить:

```typescript
it.each([
  'ROOM_NOT_ACTIVE',
  'CAPABILITY_UNAVAILABLE',
  'PRIZE_UNKNOWN',
  'PRIZE_FUND_EXHAUSTED',
  'DRAW_POOL_EMPTY',
  'AWARD_UNKNOWN',
  'REWARD_ALREADY_RESOLVED',
] as const)('accepts phase-3 code %s', (code) => {
  expect(contractErrorCodeSchema.safeParse(code).success).toBe(true);
});
```

Примечание: `ROOM_NOT_ACTIVE` — вывод на wire существующего внутреннего кода realtime (`REALTIME_ERROR_CODES.ROOM_NOT_ACTIVE`, realtime.errors.ts:5) для REST-контура rewards (терминальная комната при создании приза, Task 6); строковый паритет — существующий паттерн (`EVENT_PAYLOAD_INVALID`).

- [ ] **Step 2: Failing test — capabilities в манифесте**

В `manifest.contract.spec.ts` добавить:

```typescript
it('accepts a manifest with known capabilities', () => {
  const m = validManifests[0];
  expect(appManifestSchema.safeParse({ ...m, capabilities: ['rewards'] }).success).toBe(true);
});

it('rejects unknown capability values', () => {
  const m = validManifests[0];
  expect(appManifestSchema.safeParse({ ...m, capabilities: ['teleport'] }).success).toBe(false);
});

it('capabilities remain optional', () => {
  expect(appManifestSchema.safeParse(validManifests[0]).success).toBe(true);
});
```

В `define-app.contract.spec.ts` добавить:

```typescript
it('passes capabilities from the definition into the manifest', () => {
  const manifest = defineApp({
    appId: 'lottery',
    manifestVersion: 1,
    capabilities: ['rewards'],
    appSettings: z.strictObject({}),
    events: {
      'draw.completed': {
        schema: z.strictObject({ drawId: z.uuid() }),
        visibility: 'public',
        clientInitiated: false,
      },
    },
  });
  expect(manifest.capabilities).toEqual(['rewards']);
});
```

- [ ] **Step 3: Run — RED**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: FAIL (коды не принимаются; capabilities отклоняются strictObject'ом — сейчас за это отвечает фикстура `invalidManifestCases` в manifest.fixtures.ts:92-95 «manifest carries a capabilities field (rewards is phase 3)»).

- [ ] **Step 4: Implement**

`error-codes.ts` — перед `'INTERNAL_ERROR'` добавить блок:

```typescript
  // Фаза 3 (design 2026-09-10): rewards/lottery + REST-контур фонда.
  'ROOM_NOT_ACTIVE',
  'CAPABILITY_UNAVAILABLE',
  'PRIZE_UNKNOWN',
  'PRIZE_FUND_EXHAUSTED',
  'DRAW_POOL_EMPTY',
  'AWARD_UNKNOWN',
  'REWARD_ALREADY_RESOLVED',
```

`manifest.schema.ts` — перед `appManifestSchema`:

```typescript
// Capability манифеста (REQ-RWD-001/005): точка расширения, заложенная в ф.2
// (strictObject сознательно отвергал поле до фазы 3). Неизвестное значение —
// отказ валидации манифеста.
export const APP_CAPABILITIES = ['rewards'] as const;
export const appCapabilitySchema = z.enum(APP_CAPABILITIES);
export type AppCapability = z.infer<typeof appCapabilitySchema>;
```

и в `appManifestSchema` добавить поле `capabilities: z.array(appCapabilitySchema).optional(),` (комментарий строк 38-40 про «strictObject отклонит capabilities до фазы 3» переписать: поле принято с фазы 3, enum принуждает известные значения).

`define-app.ts`: в `AppDefinition` добавить `readonly capabilities?: readonly AppCapability[];` (импорт типа из `./manifest.schema`); в `defineApp` при сборке объекта манифеста добавить spread:

```typescript
    ...(definition.capabilities ? { capabilities: [...definition.capabilities] } : {}),
```

`manifest.fixtures.ts`: убрать кейс «capabilities field» из `invalidManifestCases`; в `validManifests` добавить манифест с `capabilities: ['rewards']`; в `invalidManifestCases` добавить `{ name: 'unknown capability value', value: { ...validManifests[0], capabilities: ['teleport'] } }`.

`contract-version.ts`: `export const CONTRACT_VERSION = '1.6.0';`. `packages/sdk/package.json`: `"version": "1.6.0"`.

Внимание: grep `capabilities` по `packages/sdk/src/**/*.spec.ts` — если где-то есть тест, фиксирующий отказ поля (кроме fixtures-итераций), обновить его на новое поведение.

- [ ] **Step 5: Run — GREEN**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: PASS, включая parity-тест версии (`pkg.version === CONTRACT_VERSION`).

- [ ] **Step 6: Commit**

```bash
git add packages/sdk
git commit -m "feat(sdk): контракт 1.6.0 — capabilities манифеста, wire-коды фазы 3

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---
### Task 3: SDK — AppEffect, AppPublishResult, хост-примитивы ctx, REWARDS_EVENTS, REST DTO rewards

**Files:**
- Create: `packages/sdk/src/app-runtime/app-effect.ts` (+ `app-effect.fixtures.ts`, `app-effect.contract.spec.ts`)
- Create: `packages/sdk/src/app-runtime/app-publish-result.ts`
- Modify: `packages/sdk/src/app-runtime/app-host-context.ts` (randomInt, drawPool, DrawPoolEntry)
- Modify: `packages/sdk/src/app-runtime/app-runtime-module.ts:15-19` (сигнатура handlePublish)
- Create: `packages/sdk/src/events/rewards-events.ts` (+ `rewards-events.contract.spec.ts`)
- Create: `packages/sdk/src/rewards/create-prize-request.ts` (+ fixtures/spec), `packages/sdk/src/rewards/prize-response.ts`, `packages/sdk/src/rewards/award-response.ts`, `packages/sdk/src/rewards/list-rewards-response.ts` (+ общий fixtures/spec для response-схем)
- Modify: `packages/sdk/src/index.ts` (barrel-экспорты)
- Modify: `packages/core/src/app-runtime/app-runtime.service.ts:109-126` (нормализация возврата, заполнение ctx-полей заглушками; исполнение эффектов — Task 7)
- Modify: `packages/app-quiz/src/quiz-handlers.spec.ts` (ctx-хелпер += randomInt/drawPool заглушки — typecheck, поведение не меняется)
- Test: `packages/core/src/app-runtime/app-runtime.int-spec.ts` (нормализация старой формы + отказ эффектов до готовности исполнителя)

**Interfaces:**
- Consumes: `AppCommit`/`appCommitSchema` (sdk app-runtime/app-commit.ts), `EventTypeDefinition` (sdk events/core-events.ts:9-13), `composeEventType` (events/event-type.ts), коды из Task 2.
- Produces:
  - `appEffectSchema` / `AppEffect` = `{ kind: 'award.prize', prizeId: uuid, winnerId: uuid } | { kind: 'award.points', identityId: uuid, points: int>0, reason?: string }` — исполняет Task 7 (через `AWARD_EFFECT_HANDLER`), эмитят Tasks 9/10.
  - `AppPublishResult` = `{ commits: readonly AppCommit[]; effects: readonly AppEffect[] }`, `normalizePublishResult(result)` — диспетчер (Tasks 3/7) и модули (Tasks 9/10).
  - `AppHostContext<S>` += `readonly randomInt: (boundExclusive: number) => number` и `readonly drawPool: readonly DrawPoolEntry[]`; `DrawPoolEntry = { identityId: string; kind: 'REGISTERED' | 'GUEST' }` — наполнение в Task 7, потребитель Task 9.
  - `REWARDS_EVENTS` / `RewardsEventName` / `rewardsEventType(name)` / `REWARDS_NAMESPACE = 'rewards'` — коммитит `EventLogService.commitRewardsEvent` (Task 5).
  - REST DTO: `createPrizeRequestSchema`, `prizeResponseSchema`, `awardResponseSchema`, `listRewardsResponseSchema` — контроллер Task 6.

**REQ:** REQ-RWD-002a/b (два вида эффектов), REQ-RWD-005, REQ-RWD-011 (randomInt как единственный санкционированный источник), REQ-SEC-009 (payload'ы — только id), REQ-CTR-002/004/005.

- [ ] **Step 1: Failing contract tests — AppEffect**

`packages/sdk/src/app-runtime/app-effect.contract.spec.ts`:

```typescript
import { appEffectSchema } from './app-effect';
import { validAppEffects, invalidAppEffects } from './app-effect.fixtures';

describe('appEffectSchema', () => {
  it.each(validAppEffects.map((v) => [JSON.stringify(v), v] as const))('accepts %s', (_l, v) => {
    expect(appEffectSchema.safeParse(v).success).toBe(true);
  });
  it.each(invalidAppEffects.map((v) => [JSON.stringify(v), v] as const))('rejects %s', (_l, v) => {
    expect(appEffectSchema.safeParse(v).success).toBe(false);
  });
});
```

`app-effect.fixtures.ts`:

```typescript
const UUID_A = '3f6b2b6e-9c5a-4f1e-8b2d-7a9c1e0f2a3b';
const UUID_B = '00000000-0000-4000-8000-000000000001';

export const validAppEffects: unknown[] = [
  { kind: 'award.prize', prizeId: UUID_A, winnerId: UUID_B },
  { kind: 'award.points', identityId: UUID_B, points: 100 },
  { kind: 'award.points', identityId: UUID_B, points: 900, reason: 'quiz.round' },
];

export const invalidAppEffects: unknown[] = [
  { kind: 'award.prize', prizeId: 'not-a-uuid', winnerId: UUID_B }, // невалидный uuid
  { kind: 'award.prize', prizeId: UUID_A }, // нет winnerId
  { kind: 'award.points', identityId: UUID_B, points: 0 }, // points строго положительные (MVP)
  { kind: 'award.points', identityId: UUID_B, points: -50 }, // отрицательные начисления вне MVP
  { kind: 'award.points', identityId: UUID_B, points: 1.5 }, // не int
  { kind: 'award.prize', prizeId: UUID_A, winnerId: UUID_B, extra: 1 }, // strictObject
  { kind: 'award.unknown', identityId: UUID_B }, // неизвестный kind
];
```

- [ ] **Step 2: Failing contract tests — REWARDS_EVENTS и REST DTO**

`packages/sdk/src/events/rewards-events.contract.spec.ts`:

```typescript
import { REWARDS_EVENTS, rewardsEventType } from './rewards-events';

describe('REWARDS_EVENTS (REQ-SEC-009: только id, без PII)', () => {
  it('declares the three public types of the award lifecycle', () => {
    expect(Object.keys(REWARDS_EVENTS).sort()).toEqual([
      'reward.awarded',
      'reward.fulfilled',
      'reward.revoked',
    ]);
    for (const def of Object.values(REWARDS_EVENTS)) {
      expect(def.visibility).toBe('public');
      expect(def.version).toBe(1);
    }
  });

  it('parses the reward.awarded payload (nullable prizeId — REQ-RWD-002b)', () => {
    const p = {
      awardId: '3f6b2b6e-9c5a-4f1e-8b2d-7a9c1e0f2a3b',
      prizeId: null,
      winnerId: '00000000-0000-4000-8000-000000000001',
      sourceAppId: 'lottery',
    };
    expect(REWARDS_EVENTS['reward.awarded'].schema.safeParse(p).success).toBe(true);
    expect(REWARDS_EVENTS['reward.awarded'].schema.safeParse({ ...p, displayName: 'Петя' }).success).toBe(false);
  });

  it('parses fulfill/revoke payloads', () => {
    const p = { awardId: '3f6b2b6e-9c5a-4f1e-8b2d-7a9c1e0f2a3b' };
    expect(REWARDS_EVENTS['reward.fulfilled'].schema.safeParse(p).success).toBe(true);
    expect(REWARDS_EVENTS['reward.revoked'].schema.safeParse(p).success).toBe(true);
    expect(REWARDS_EVENTS['reward.revoked'].schema.safeParse({}).success).toBe(false);
  });

  it('composes the wire type under the rewards namespace', () => {
    expect(rewardsEventType('reward.awarded')).toBe('rewards.reward.awarded');
  });
});
```

`packages/sdk/src/rewards/rewards-dto.contract.spec.ts` (один spec на все REST DTO rewards):

```typescript
import { createPrizeRequestSchema } from './create-prize-request';
import { awardResponseSchema } from './award-response';
import { listRewardsResponseSchema } from './list-rewards-response';
import { prizeResponseSchema } from './prize-response';

const UUID = '3f6b2b6e-9c5a-4f1e-8b2d-7a9c1e0f2a3b';

describe('rewards REST DTO', () => {
  it('accepts a valid createPrize request', () => {
    expect(createPrizeRequestSchema.safeParse({ name: 'iPhone', quantity: 3 }).success).toBe(true);
  });
  it.each([
    { name: '', quantity: 1 }, // пустое имя
    { name: 'iPhone', quantity: 0 }, // неположительный фонд
    { name: 'iPhone', quantity: 1.5 }, // не int
    { name: 'iPhone', quantity: 1, extra: true }, // strictObject
  ])('rejects %j', (v) => {
    expect(createPrizeRequestSchema.safeParse(v).success).toBe(false);
  });

  it('parses award/prize/list responses', () => {
    const award = {
      id: UUID, roomId: UUID, prizeId: null, winnerId: UUID,
      status: 'AWARDED', sourceAppId: 'lottery',
      createdAt: '2026-09-10T12:00:00.000Z', fulfilledAt: null, revokedAt: null,
    };
    expect(awardResponseSchema.safeParse(award).success).toBe(true);
    expect(listRewardsResponseSchema.safeParse({ awards: [award] }).success).toBe(true);
    const prize = { id: UUID, roomId: UUID, name: 'iPhone', quantityTotal: 3, quantity: 2, createdAt: '2026-09-10T12:00:00.000Z', updatedAt: '2026-09-10T12:00:00.000Z' };
    expect(prizeResponseSchema.safeParse(prize).success).toBe(true);
  });

  it('rejects unknown award status', () => {
    const award = { id: UUID, roomId: UUID, prizeId: null, winnerId: UUID, status: 'CLAIMED', sourceAppId: 'lottery', createdAt: '2026-09-10T12:00:00.000Z', fulfilledAt: null, revokedAt: null };
    expect(awardResponseSchema.safeParse(award).success).toBe(false); // CLAIMED отложен (ADR-007)
  });
});
```

- [ ] **Step 3: Run — RED**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: FAIL (модули не существуют).

- [ ] **Step 4: Implement — схемы и реестры SDK**

`packages/sdk/src/app-runtime/app-effect.ts`:

```typescript
import { z } from 'zod';

// Эффекты награждения (design 2026-09-10 §2, подход A): возвращаются модулем из
// handlePublish вместе с коммитами и исполняются диспетчером в той же транзакции
// outbox.run ДО коммита событий. Это статические zod-схемы: эффекты не входят в
// манифест и в JSON Schema не конвертируются.
export const awardPrizeEffectSchema = z.strictObject({
  kind: z.literal('award.prize'),
  prizeId: z.uuid(),
  winnerId: z.uuid(),
});
export const awardPointsEffectSchema = z.strictObject({
  kind: z.literal('award.points'),
  identityId: z.uuid(),
  points: z.number().int().positive(), // REQ-RWD-002a: начисления в MVP только положительные
  reason: z.string().min(1).optional(),
});
export const appEffectSchema = z.discriminatedUnion('kind', [
  awardPrizeEffectSchema,
  awardPointsEffectSchema,
]);
export type AppEffect = z.infer<typeof appEffectSchema>;
```

`packages/sdk/src/app-runtime/app-publish-result.ts`:

```typescript
import type { AppCommit } from './app-commit';
import type { AppEffect } from './app-effect';

// Возврат handlePublish (design §2): коммиты + эффекты. Старая форма «голый
// массив AppCommit[]» читается как { commits, effects: [] } — обратная
// совместимость для модулей, написанных под контракт 1.5.0 (квиз v1).
export interface AppPublishResult {
  readonly commits: readonly AppCommit[];
  readonly effects: readonly AppEffect[];
}

export function normalizePublishResult(
  result: readonly AppCommit[] | AppPublishResult,
): AppPublishResult {
  return Array.isArray(result) ? { commits: result, effects: [] } : result;
}
```

`app-host-context.ts` — заменить интерфейс:

```typescript
import type { MemberRole } from '../membership/member-role';

// Снапшот пула розыгрыша (design §2, вариант A2): активные PARTICIPANT-членства
// комнаты. Наполняется диспетчером только для модулей с capability 'rewards'.
export interface DrawPoolEntry {
  readonly identityId: string;
  readonly kind: 'REGISTERED' | 'GUEST';
}

export interface AppHostContext<S> {
  readonly roomId: string;
  readonly actorId: string;
  readonly actorRole: MemberRole;
  readonly settings: unknown;
  readonly state: S;
  readonly now: string; // ISO
  // Хост-примитивы (design §2): randomInt — над crypto.randomInt (node:crypto,
  // CSPRNG по построению, REQ-RWD-011); иного санкционированного источника
  // случайности у модуля нет. Зафиксированное расширение трактовки REQ-CTR-002
  // (прецедент функций в контракте — reduce/handlePublish).
  readonly randomInt: (boundExclusive: number) => number;
  readonly drawPool: readonly DrawPoolEntry[];
}
```

`app-runtime-module.ts` — сигнатура handlePublish:

```typescript
  handlePublish(
    ctx: AppHostContext<S>,
    shortName: string,
    payload: Record<string, unknown>,
  ): AppCommit[] | AppPublishResult | Promise<AppCommit[] | AppPublishResult>;
```

`packages/sdk/src/events/rewards-events.ts`:

```typescript
import { z } from 'zod';
import { composeEventType } from './event-type';
import type { EventTypeDefinition } from './core-events';

// Core-owned события контура rewards (design 2026-09-10 §2): коммитит rewards-модуль
// ядра через EventLogService.commitRewardsEvent в той же транзакции, что и запись
// состояния. Публичные (участники видят вручение по realtime); payload — только id
// (REQ-SEC-009); отображаемое имя клиент берёт из membership-проекции.
export const REWARDS_NAMESPACE = 'rewards';

export const REWARDS_EVENTS = {
  'reward.awarded': {
    schema: z.strictObject({
      awardId: z.uuid(),
      prizeId: z.uuid().nullable(), // REQ-RWD-002b: победитель без сущности приза
      winnerId: z.uuid(),
      sourceAppId: z.string().min(1),
    }),
    visibility: 'public',
    version: 1,
  },
  'reward.fulfilled': {
    schema: z.strictObject({ awardId: z.uuid() }),
    visibility: 'public',
    version: 1,
  },
  'reward.revoked': {
    schema: z.strictObject({ awardId: z.uuid() }),
    visibility: 'public',
    version: 1,
  },
} as const satisfies Record<string, EventTypeDefinition>;

export type RewardsEventName = keyof typeof REWARDS_EVENTS;

export const rewardsEventType = (name: RewardsEventName): string =>
  composeEventType(REWARDS_NAMESPACE, name);
```

`packages/sdk/src/rewards/create-prize-request.ts`:

```typescript
import { z } from 'zod';

export const createPrizeRequestSchema = z.strictObject({
  name: z.string().min(1).max(200),
  quantity: z.number().int().positive().max(10_000),
});
export type CreatePrizeRequest = z.infer<typeof createPrizeRequestSchema>;
```

`packages/sdk/src/rewards/prize-response.ts`:

```typescript
import { z } from 'zod';

export const prizeResponseSchema = z.strictObject({
  id: z.uuid(),
  roomId: z.uuid(),
  name: z.string(),
  quantityTotal: z.number().int(),
  quantity: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PrizeResponse = z.infer<typeof prizeResponseSchema>;
```

`packages/sdk/src/rewards/award-response.ts`:

```typescript
import { z } from 'zod';

export const AWARD_STATUSES = ['AWARDED', 'FULFILLED', 'REVOKED'] as const;
export const awardStatusSchema = z.enum(AWARD_STATUSES);

export const awardResponseSchema = z.strictObject({
  id: z.uuid(),
  roomId: z.uuid(),
  prizeId: z.uuid().nullable(),
  winnerId: z.uuid(),
  status: awardStatusSchema,
  sourceAppId: z.string(),
  createdAt: z.string(),
  fulfilledAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type AwardResponse = z.infer<typeof awardResponseSchema>;
```

`packages/sdk/src/rewards/list-rewards-response.ts`:

```typescript
import { z } from 'zod';
import { awardResponseSchema } from './award-response';

export const listRewardsResponseSchema = z.strictObject({
  awards: z.array(awardResponseSchema),
});
export type ListRewardsResponse = z.infer<typeof listRewardsResponseSchema>;
```

`index.ts` barrel += строки (в соответствующие группы):

```typescript
export * from './events/rewards-events';
export * from './app-runtime/app-effect';
export * from './app-runtime/app-publish-result';
export * from './rewards/create-prize-request';
export * from './rewards/prize-response';
export * from './rewards/award-response';
export * from './rewards/list-rewards-response';
```

- [ ] **Step 5: Implement — минимальная адаптация ядра и квиза (typecheck, семантика исполнения — Task 7)**

`pnpm --filter @mymozhem/sdk build` — затем в core:

`packages/core/src/app-runtime/app-runtime.service.ts`:
1. Импорты: `import { randomInt } from 'node:crypto';` и из sdk: `appEffectSchema`, `normalizePublishResult`, `type AppEffect`.
2. В `dispatchLocked`, построение ctx (строки 109-116) — добавить два поля:

```typescript
      // Хост-примитивы (design 2026-09-10 §2). drawPool наполняется только для
      // модулей с capability 'rewards' — в Task 7; до него всегда пуст (ни один
      // модуль с capability ещё не зарегистрирован).
      randomInt: (boundExclusive: number) => randomInt(boundExclusive),
      drawPool: [],
```

3. Вызов модуля (строки 119-126) — нормализация и fail-closed на эффектах до исполнителя:

```typescript
    const result = await mod.handlePublish(ctx, params.shortName, params.payload);
    const { commits, effects } = normalizePublishResult(result);
    for (const effect of effects) {
      const parsed = appEffectSchema.safeParse(effect);
      if (!parsed.success) {
        // Баг модуля, не клиента: эффект обязан соответствовать appEffectSchema.
        throw new ContractError(
          'EVENT_PAYLOAD_INVALID',
          `malformed effect from ${mod.appId}@${mod.manifestVersion}: ${parsed.error.message}`,
        );
      }
    }
    if (effects.length > 0) {
      // Исполнитель эффектов — Task 7 (AWARD_EFFECT_HANDLER + capability-гейт).
      // До него любой эффект — типизированный отказ, коммитов не было (fail-closed).
      throw new ContractError(
        'CAPABILITY_UNAVAILABLE',
        'award effects are not executable in this deployment',
      );
    }
```

(переменную `commits` в цикле коммита оставить как есть — теперь она из деструктуризации).

В `packages/app-quiz/src/quiz-handlers.spec.ts` хелпер `ctx(over)` — добавить заглушки:

```typescript
  randomInt: () => 0,
  drawPool: [],
```

- [ ] **Step 6: Run — GREEN по всем затронутым пакетам**

Run: `pnpm --filter @mymozhem/sdk test && pnpm build && pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/app-quiz test`
Expected: PASS. Затем полная лана: `pnpm --filter @mymozhem/core test:int && pnpm --filter @mymozhem/server test` — регрессий нет (сигнатурная дельта совместима: квиз возвращает массив, нормализация его читает).

- [ ] **Step 7: Commit**

```bash
git add packages/sdk packages/core/src/app-runtime packages/app-quiz
git commit -m "feat(sdk,core): эффекты и хост-примитивы контракта 1.6.0 — AppEffect, AppPublishResult, randomInt/drawPool, REWARDS_EVENTS, REST DTO rewards

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

**Конец Batch A.** Зелёный конвейер батча: `pnpm build && pnpm lint && pnpm boundary-check && pnpm guardrails && pnpm test && pnpm test:int`. Дальше — новой сессией (правило владельца).

---
### Task 4: Prisma-схема rewards + миграция + автотесты + параметр CLEANUP_INTERVAL

**Files:**
- Modify: `packages/core/prisma/schema.prisma` (schemas list + 3 модели + enum + обратные связи)
- Create: `packages/core/prisma/migrations/<timestamp>_rewards_schema/migration.sql` (рукописные CHECK + частичный индекс)
- Test: `packages/core/src/rewards/rewards-schema.int-spec.ts` (новый)
- Modify: `packages/core/src/config/config.schema.ts:20` (CLEANUP_INTERVAL), `packages/core/src/config/config.schema.spec.ts`
- Modify: `packages/core/src/testing/test-config.ts` (TEST_CONFIG += CLEANUP_INTERVAL)

**Interfaces:**
- Produces: Prisma-модели `prize`, `award`, `pointsGrant` (client API `prisma.prize/.award/.pointsGrant`), enum `AwardStatus` (`'AWARDED' | 'FULFILLED' | 'REVOKED'` — uppercase в БД, БЕЗ `@map`, под дословный SQL дизайна §3); частичный индекс `"Award_single_active_winner_per_prize_key"`; CHECK `"Prize_quantity_nonnegative"`; конфиг-ключ `CLEANUP_INTERVAL` (секунды, 300…86400, дефолт 3600) — потребляет Task 8 (свип).

**REQ:** REQ-RWD-002a/b (Award.prizeId nullable), REQ-RWD-003 (частичный индекс), REQ-RWD-010 (CHECK + декремент), REQ-DEV-006 (SQL-миграция + автотест), REQ-ID-010 (cleanup_interval — §4 пакета).

- [ ] **Step 1: Failing test — наличие индекса и CHECK (REQ-DEV-006)**

`packages/core/src/rewards/rewards-schema.int-spec.ts` (по образцу `packages/core/src/identity/identity-schema.int-spec.ts:21-34`; харнесс `startTestDb` из `packages/core/src/testing/postgres.testcontainer.ts`):

```typescript
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';

describe('rewards schema (REQ-DEV-006, REQ-RWD-003/010)', () => {
  let db: TestDb;
  beforeAll(async () => { db = await startTestDb(); }, 120_000);
  afterAll(async () => { await db.stop(); });

  it('has the partial unique index on active awards', async () => {
    const rows = await db.prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'rewards' AND indexname = 'Award_single_active_winner_per_prize_key'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/^CREATE UNIQUE INDEX/);
    expect(rows[0].indexdef).toContain('"roomId"');
    expect(rows[0].indexdef).toContain('"prizeId"');
    expect(rows[0].indexdef).toContain('"winnerId"');
    expect(rows[0].indexdef).toContain("'AWARDED'");
    expect(rows[0].indexdef).toContain("'FULFILLED'");
  });

  it('has the CHECK quantity >= 0 on Prize (REQ-RWD-010)', async () => {
    const rows = await db.prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conname = 'Prize_quantity_nonnegative' AND connamespace = 'rewards'::regnamespace
    `;
    expect(rows).toHaveLength(1);
  });

  // Поведенческие кейсы индекса: сиды комнаты/приза/победителя.
  // Полный набор полей Room/Prize/Award сверить с schema.prisma при исполнении.
  async function seedRoomPrizeWinner() {
    const org = await seedIdentity(db.prisma, { email: 'org@example.test' });
    const winner = await seedIdentity(db.prisma, { kind: 'GUEST', displayName: 'Гость' });
    const room = await db.prisma.room.create({ data: { code: 'RWD12345', organizerId: org.id } });
    const prize = await db.prisma.prize.create({
      data: { roomId: room.id, name: 'Приз', quantityTotal: 2, quantity: 2 },
    });
    return { room, prize, winner };
  }

  it('blocks a second active award of the same prize to the same winner; revoke frees the slot; fulfilled does not', async () => {
    const { room, prize, winner } = await seedRoomPrizeWinner();
    const first = await db.prisma.award.create({
      data: { roomId: room.id, prizeId: prize.id, winnerId: winner.id, sourceAppId: 'lottery' },
    });
    // Дубль по активной записи — конфликт индекса.
    await expect(
      db.prisma.award.create({
        data: { roomId: room.id, prizeId: prize.id, winnerId: winner.id, sourceAppId: 'lottery' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    // Отзыв освобождает место.
    await db.prisma.award.update({ where: { id: first.id }, data: { status: 'REVOKED', revokedAt: new Date() } });
    const second = await db.prisma.award.create({
      data: { roomId: room.id, prizeId: prize.id, winnerId: winner.id, sourceAppId: 'lottery' },
    });
    // FULFILLED — нет: слот по-прежнему занят.
    await db.prisma.award.update({ where: { id: second.id }, data: { status: 'FULFILLED', fulfilledAt: new Date() } });
    await expect(
      db.prisma.award.create({
        data: { roomId: room.id, prizeId: prize.id, winnerId: winner.id, sourceAppId: 'lottery' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('CHECK rejects a negative quantity and the guarded decrement stops at zero', async () => {
    const { prize } = await seedRoomPrizeWinner();
    await expect(
      db.prisma.$executeRaw`UPDATE rewards."Prize" SET quantity = -1 WHERE id = ${prize.id}::uuid`,
    ).rejects.toMatchObject({ code: 'P2010' }); // SQLSTATE 23514 check_violation (форма adapter-pg — HANDOFF)
    const zero = await db.prisma.prize.update({ where: { id: prize.id }, data: { quantity: 0 } });
    const n = await db.prisma.$executeRaw`UPDATE rewards."Prize" SET quantity = quantity - 1 WHERE id = ${zero.id}::uuid AND quantity >= 1`;
    expect(n).toBe(0);
  });
});
```

(Если `seedIdentity` не принимает `kind`/`displayName` — свериться с `testing/seed-identity.ts` и передать поддерживаемые поля; GUEST-сид по умолчанию уже может существовать.)

Также failing unit на конфиг — `config.schema.spec.ts`:

```typescript
it('accepts CLEANUP_INTERVAL within the §4 range and defaults to 1 hour', () => {
  const base = validEnv(); // существующий хелпер валидного env в спеке
  expect(loadConfig({ ...base, CLEANUP_INTERVAL: '600' }).CLEANUP_INTERVAL).toBe(600);
  expect(loadConfig(base).CLEANUP_INTERVAL).toBe(3600);
  expect(() => loadConfig({ ...base, CLEANUP_INTERVAL: '60' })).toThrow(); // < 5 мин
  expect(() => loadConfig({ ...base, CLEANUP_INTERVAL: '90000' })).toThrow(); // > 24 ч
});
```

(Имя хелпера валидного env сверить со спеком; если его нет — собрать минимальный валидный env по соседним кейсам.)

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/core test -- config.schema` и `pnpm --filter @mymozhem/core test:int -- rewards-schema`
Expected: FAIL (конфиг-ключа нет — typecheck/throw; таблицы rewards не существуют).

- [ ] **Step 3: Implement — schema.prisma**

В datasource-блоке (строки 5-8) добавить `"rewards"` в `schemas = [...]`. В конец файла:

```prisma
// === Фаза 3: rewards (design 2026-09-10 §3) ===

model Prize {
  id            String   @id @default(uuid()) @db.Uuid
  roomId        String   @db.Uuid
  name          String
  quantityTotal Int // исходный фонд, для «раздано X из Y»
  quantity      Int    // остаток; CHECK (quantity >= 0) — рукописной миграцией (REQ-RWD-010)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  room   Room    @relation(fields: [roomId], references: [id], onDelete: Restrict)
  awards Award[]

  @@schema("rewards")
}

// БЕЗ @map: значения в БД uppercase, под дословный SQL частичного индекса
// (design §3; прецедент MemberRole).
enum AwardStatus {
  AWARDED
  FULFILLED
  REVOKED

  @@schema("rewards")
}

model Award {
  id          String      @id @default(uuid()) @db.Uuid
  roomId      String      @db.Uuid
  prizeId     String?     @db.Uuid // REQ-RWD-002b: победитель без сущности приза
  winnerId    String      @db.Uuid
  status      AwardStatus @default(AWARDED)
  sourceAppId String // 'lottery', 'quiz'
  createdAt   DateTime    @default(now())
  fulfilledAt DateTime?
  revokedAt   DateTime?

  room   Room     @relation(fields: [roomId], references: [id], onDelete: Restrict)
  prize  Prize?   @relation(fields: [prizeId], references: [id], onDelete: Restrict)
  winner Identity @relation(fields: [winnerId], references: [id], onDelete: Restrict)

  // Единичность победителя по активным записям — частичный уникальный индекс
  // "Award_single_active_winner_per_prize_key", рукописной миграцией (REQ-RWD-003,
  // REQ-DEV-006). NULL prizeId не конфликтует (SQL NULLs distinct) — осознанно.
  @@index([roomId])
  @@schema("rewards")
}

model PointsGrant {
  id          String   @id @default(uuid()) @db.Uuid
  roomId      String   @db.Uuid
  identityId  String   @db.Uuid
  points      Int // только положительные в MVP (принуждается appEffectSchema)
  reason      String? // 'quiz.round', …
  sourceAppId String
  createdAt   DateTime @default(now())

  room     Room     @relation(fields: [roomId], references: [id], onDelete: Restrict)
  identity Identity @relation(fields: [identityId], references: [id], onDelete: Restrict)

  // Агрегат «баллы участника» — проекция по ledger'у, не хранимый счётчик.
  @@index([roomId, identityId])
  @@schema("rewards")
}
```

Обратные связи: в модель `Room` добавить `prizes Prize[]`, `awards Award[]`, `pointsGrants PointsGrant[]`; в модель `Identity` — `awardsWon Award[]`, `pointsGrants PointsGrant[]`. (Отношения разных моделей к Room/Identity конфликтов имён не создают; если Prisma потребует именованных relation — назвать и зафиксировать отклонение в леджере.)

- [ ] **Step 4: Implement — миграция с рукописными частями**

Из корня репозитория (Prisma 7 CLI; нужна dev-БД в `DATABASE_URL`):

```bash
DATABASE_URL=<dev-db-url> pnpm exec prisma migrate dev --name rewards_schema
```

В сгенерированный `migration.sql` ДОБАВИТЬ в конец (рукописные части, прецеденты `20260722151900_identity_seam/migration.sql:24-26` и `20260723090841_room_app_config/migration.sql`):

```sql
-- REQ-RWD-010: ограниченность призового фонда — DB-инвариант (рукописной CHECK;
-- preview-функцию Prisma partialIndexes/checkConstraints НЕ использовать, REQ-DEV-006).
ALTER TABLE rewards."Prize" ADD CONSTRAINT "Prize_quantity_nonnegative" CHECK (quantity >= 0);

-- REQ-RWD-003 + REQ-DEV-006: единичность победителя по активным записям.
-- «Активная» = не отозванная: отзыв освобождает место (приз можно переразыграть),
-- вручённая — нет. Сетевой повтор того же награждения конфликтует по индексу →
-- типизированный no-op в RewardsService (Task 5).
CREATE UNIQUE INDEX "Award_single_active_winner_per_prize_key"
  ON rewards."Award" ("roomId", "prizeId", "winnerId")
  WHERE "status" IN ('AWARDED', 'FULFILLED');
```

Затем `DATABASE_URL=<dev-db-url> pnpm exec prisma migrate reset --skip-seed` НЕ нужен — достаточно повторного `migrate dev` (он применит доработанную миграцию после `--create-only`-цикла; если CLI уже применил миграцию до правки — откатить её в dev-БД и прогнать заново, либо использовать форму `migrate dev --create-only` → правка SQL → `migrate dev`). Зафиксировать выбранную последовательность в леджере.

`DATABASE_URL=<dev-db-url> pnpm exec prisma generate` — регенерация клиента (CLI не всегда регенерирует сам — HANDOFF).

- [ ] **Step 5: Implement — CLEANUP_INTERVAL**

`config.schema.ts` после `GUEST_TTL` (строка 20):

```typescript
  // §4: cleanup_interval — 1 ч, 5 мин … 24 ч (секунды). Интервал регламентных
  // джоб (REQ-ID-010); фаза 3 — свип анонимизации гостей (REQ-ID-003/014, Task 8).
  CLEANUP_INTERVAL: z.coerce.number().int().min(300).max(86_400).default(3_600),
```

`testing/test-config.ts`: в `TEST_CONFIG` добавить `CLEANUP_INTERVAL: 3_600,` (структурно полный AppConfig — без ключа упадёт typecheck, это ожидаемый сигнал).

- [ ] **Step 6: Run — GREEN**

Run: `pnpm --filter @mymozhem/core test -- config.schema && pnpm --filter @mymozhem/core test:int -- rewards-schema`
Expected: PASS (testcontainers поднимает Postgres, `migrate deploy` применяет новую миграцию). Затем `pnpm build && pnpm --filter @mymozhem/core test:int` — вся лана зелёная.

- [ ] **Step 7: Commit**

```bash
git add packages/core/prisma packages/core/src/config packages/core/src/testing packages/core/src/rewards
git commit -m "feat(core): схема rewards — Prize/Award/PointsGrant, CHECK фонда, частичный индекс единичности, CLEANUP_INTERVAL

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: RewardsService — эффекты и автомат награды + commitRewardsEvent

**Files:**
- Create: `packages/core/src/rewards/rewards.errors.ts`
- Create: `packages/core/src/rewards/rewards.service.ts`
- Create: `packages/core/src/rewards/rewards.module.ts` (пока без контроллера и handler-провайдера — Tasks 6/11)
- Modify: `packages/core/src/realtime/event-log.service.ts` (refactor к commitStaticEvent + `commitRewardsEvent`)
- Modify: `packages/core/src/index.ts` (barrel: RewardsModule, RewardsService, ошибки)
- Test: `packages/core/src/rewards/rewards.int-spec.ts` (транзакционные сценарии), `packages/core/src/realtime/event-log.int-spec.ts` (существующий — кейс commitRewardsEvent)

**Interfaces:**
- Consumes: Prisma-модели Task 4; `REWARDS_EVENTS`/`RewardsEventName`/`rewardsEventType` Task 3; `EventOutbox.run`/`EventLogService`/`appendLocked` (realtime); коды Task 2.
- Produces:
  - `RewardsService.executeEffects(tx, roomId, sourceAppId, effects: readonly AppEffect[]): Promise<void>` — вызывает диспетчер внутри своего `outbox.run` (Task 7); реализация интерфейса `AwardEffectHandler` (токен объявляется в Task 7, здесь сигнатура уже совместима). `sourceAppId` — appId пиннутого модуля, его передаёт диспетчер (`'lottery'`, `'quiz'`).
  - `RewardsService.createPrize(roomId, actorId, input: CreatePrizeRequest): Promise<Prize>`; `listAwards(roomId, actorId): Promise<Award[]>`; `fulfill(roomId, awardId, actorId): Promise<Award>`; `revoke(roomId, awardId, actorId): Promise<Award>` — REST-контур Task 6.
  - `EventLogService.commitRewardsEvent(tx, roomId, name: RewardsEventName, payload, actorId = null): Promise<LogEvent>`.
  - Ошибки: `PrizeUnknownError` (PRIZE_UNKNOWN), `PrizeFundExhaustedError` (PRIZE_FUND_EXHAUSTED), `AwardUnknownError` (AWARD_UNKNOWN), `RewardAlreadyResolvedError` (REWARD_ALREADY_RESOLVED) — все `extends ContractError`.

**REQ:** REQ-RWD-003 (атомарность, идемпотентный no-op по индексу), REQ-RWD-007 (автомат, идемпотентные переходы), REQ-RWD-010 (ограниченный декремент), REQ-RWD-002b (award.points без приза), REQ-SEC-009 (события — только id).

- [ ] **Step 1: Failing int-tests — транзакционные инварианты**

`packages/core/src/rewards/rewards.int-spec.ts`. Бутстрап — Nest testing module (DI-контейнер, прецедент T7-рулинга Quiz-среза: сервис через контейнер, не вручную):

```typescript
import { Test } from '@nestjs/testing';
import { AppRegistryModule } from '../app-registry/app-registry.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '../config/config.module';
import { MembershipModule } from '../membership/membership.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { EventOutbox } from '../realtime/event-outbox';
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import { RewardsModule } from './rewards.module';
import { RewardsService } from './rewards.service';
import { PrizeFundExhaustedError } from './rewards.errors';
import type { AppEffect } from '@mymozhem/sdk';

describe('RewardsService (int)', () => {
  let db: TestDb;
  let rewards: RewardsService;
  let outbox: EventOutbox;

  beforeAll(async () => {
    db = await startTestDb();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule, PrismaModule, AppRegistryModule.register([]),
        MembershipModule, RealtimeModule, RewardsModule,
      ],
    }).compile();
    rewards = moduleRef.get(RewardsService);
    outbox = moduleRef.get(EventOutbox);
  }, 120_000);

  afterAll(async () => { await db.stop(); });
  afterEach(async () => {
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE rewards."PointsGrant", rewards."Award", rewards."Prize", identity."Session", membership."Membership", room."Room" CASCADE',
    );
  });

  // Хелпер: комната DRAFT с организатором + приз с фондом quantity.
  // Поля Room.create сверить с schema.prisma (code unique, organizerId FK).
  async function seedPrize(quantity: number) {
    const org = await seedIdentity(db.prisma, { email: `org-${crypto.randomUUID()}@example.test` });
    const room = await db.prisma.room.create({ data: { code: crypto.randomUUID().slice(0, 8).toUpperCase(), organizerId: org.id } });
    const prize = await db.prisma.prize.create({ data: { roomId: room.id, name: 'Приз', quantityTotal: quantity, quantity } });
    return { org, room, prize };
  }
  const guest = () => seedIdentity(db.prisma, { kind: 'GUEST', displayName: 'Гость' });
  const prizeEffect = (prizeId: string, winnerId: string): AppEffect => ({ kind: 'award.prize', prizeId, winnerId });
```

Тесты:

```typescript
  it('award.prize: декремент + insert + событие reward.awarded одной транзакцией', async () => {
    const { room, prize } = await seedPrize(2);
    const winner = await guest();
    await outbox.run((tx) => rewards.executeEffects(tx, room.id, 'lottery', [prizeEffect(prize.id, winner.id)]));
    expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(1);
    const awards = await db.prisma.award.findMany({ where: { roomId: room.id } });
    expect(awards).toHaveLength(1);
    expect(awards[0].status).toBe('AWARDED');
    const log = await db.prisma.$queryRaw<{ type: string; visibility: string; payload: { winnerId: string } }[]>`
      SELECT type, "visibility"::text AS visibility, payload FROM realtime."LogEvent" WHERE "roomId" = ${room.id}::uuid ORDER BY seq`;
    expect(log).toHaveLength(1);
    expect(log[0].type).toBe('rewards.reward.awarded');
    expect(log[0].visibility).toBe('public'); // сырое DB-значение lowercase (HANDOFF)
    expect(log[0].payload.winnerId).toBe(winner.id);
    expect(log[0].payload).not.toHaveProperty('displayName'); // REQ-SEC-009
  });

  it('K > quantity конкурентных награждений разным identity → ровно quantity успехов, без минуса (REQ-RWD-010)', async () => {
    const { room, prize } = await seedPrize(2);
    const winners = await Promise.all(Array.from({ length: 5 }, () => guest()));
    const results = await Promise.allSettled(
      winners.map((w) => outbox.run((tx) => rewards.executeEffects(tx, room.id, 'lottery', [prizeEffect(prize.id, w.id)]))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(PrizeFundExhaustedError);
    }
    expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(0);
    expect(await db.prisma.award.count({ where: { prizeId: prize.id } })).toBe(2);
  });

  it('конкурентный дубль одного награждения → один победитель, quantity −1 ровно раз (REQ-RWD-003)', async () => {
    const { room, prize } = await seedPrize(5);
    const winner = await guest();
    const results = await Promise.allSettled([
      outbox.run((tx) => rewards.executeEffects(tx, room.id, 'lottery', [prizeEffect(prize.id, winner.id)])),
      outbox.run((tx) => rewards.executeEffects(tx, room.id, 'lottery', [prizeEffect(prize.id, winner.id)])),
    ]);
    // Оба завершились успешно: повтор — типизированный no-op, не отказ.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await db.prisma.award.count({ where: { prizeId: prize.id } })).toBe(1);
    expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(4);
  });

  it('повторное вручение — типизированный no-op; cross-переход (revoke после fulfill) — REWARD_ALREADY_RESOLVED (REQ-RWD-007)', async () => {
    const { org, room, prize } = await seedPrize(1);
    const winner = await guest();
    await outbox.run((tx) => rewards.executeEffects(tx, room.id, 'lottery', [prizeEffect(prize.id, winner.id)]));
    const award = (await db.prisma.award.findFirstOrThrow({ where: { roomId: room.id } }));
    const done1 = await rewards.fulfill(room.id, award.id, org.id);
    const done2 = await rewards.fulfill(room.id, award.id, org.id);
    expect(done2.status).toBe('FULFILLED');
    expect(done2.fulfilledAt).toEqual(done1.fulfilledAt);
    await expect(rewards.revoke(room.id, award.id, org.id)).rejects.toMatchObject({ code: 'REWARD_ALREADY_RESOLVED' });
  });

  it('двойной отзыв возвращает quantity один раз; отозванный приз можно переразыграть тому же победителю (REQ-RWD-007/003)', async () => {
    const { org, room, prize } = await seedPrize(1);
    const winner = await guest();
    await outbox.run((tx) => rewards.executeEffects(tx, room.id, 'lottery', [prizeEffect(prize.id, winner.id)]));
    const award = await db.prisma.award.findFirstOrThrow({ where: { roomId: room.id } });
    await rewards.revoke(room.id, award.id, org.id);
    expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(1);
    const again = await rewards.revoke(room.id, award.id, org.id); // no-op
    expect(again.status).toBe('REVOKED');
    expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(1);
    // Место освобождено: повторное награждение того же победителя тем же призом проходит.
    await outbox.run((tx) => rewards.executeEffects(tx, room.id, 'lottery', [prizeEffect(prize.id, winner.id)]));
    expect(await db.prisma.award.count({ where: { prizeId: prize.id, status: 'AWARDED' } })).toBe(1);
    expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(0);
  });

  it('award.points: ledger-запись без приза и фонда, события нет (design §5)', async () => {
    const { room } = await seedPrize(0);
    const p = await guest();
    await outbox.run((tx) =>
      rewards.executeEffects(tx, room.id, 'quiz', [{ kind: 'award.points', identityId: p.id, points: 900, reason: 'quiz.round' }]),
    );
    const grants = await db.prisma.pointsGrant.findMany({ where: { roomId: room.id } });
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ identityId: p.id, points: 900, reason: 'quiz.round', sourceAppId: 'quiz' });
  });

  it('отказ эффекта откатывает транзакцию целиком — награды и события нет (подход A)', async () => {
    const { room } = await seedPrize(1);
    const winner = await guest();
    await expect(
      outbox.run((tx) =>
        rewards.executeEffects(tx, room.id, 'lottery', [prizeEffect(crypto.randomUUID(), winner.id)]),
      ),
    ).rejects.toMatchObject({ code: 'PRIZE_UNKNOWN' });
    expect(await db.prisma.award.count({ where: { roomId: room.id } })).toBe(0);
    expect(await db.prisma.logEvent.count({ where: { roomId: room.id } })).toBe(0);
  });
});
```

Примечание к последнему тесту: `logEvent` — клиентское имя модели лога; сверить с schema.prisma (`realtime."LogEvent"` → `prisma.logEvent`).

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/core test:int -- rewards.int-spec`
Expected: FAIL (RewardsModule не существует — компиляция).

- [ ] **Step 3: Implement**

`packages/core/src/rewards/rewards.errors.ts`:

```typescript
import { ContractError } from '@mymozhem/sdk';

// Типизированные отказы контура rewards (design 2026-09-10 §3). Wire-маппинг —
// HttpExceptionFilter (Task 6); над socket — ack с {code} (REQ-SEC-006).
export class PrizeUnknownError extends ContractError {
  constructor(prizeId: string) {
    super('PRIZE_UNKNOWN', `no prize ${prizeId} in this room`);
  }
}

export class PrizeFundExhaustedError extends ContractError {
  constructor(prizeId: string) {
    super('PRIZE_FUND_EXHAUSTED', `prize fund of ${prizeId} is exhausted`);
  }
}

export class AwardUnknownError extends ContractError {
  constructor(awardId: string) {
    super('AWARD_UNKNOWN', `no award ${awardId} in this room`);
  }
}

export class RewardAlreadyResolvedError extends ContractError {
  constructor(awardId: string, status: string) {
    super('REWARD_ALREADY_RESOLVED', `award ${awardId} is already ${status}`);
  }
}
```

`packages/core/src/rewards/rewards.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AppEffect, CreatePrizeRequest } from '@mymozhem/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipService } from '../membership/membership.service';
import { ActorNotOrganizerError, ActorNotMemberError } from '../membership/membership.errors';
import { EventLogService } from '../realtime/event-log.service';
import { EventOutbox } from '../realtime/event-outbox';
import { RoomNotActiveError } from '../realtime/realtime.errors';
import {
  AwardUnknownError,
  PrizeFundExhaustedError,
  PrizeUnknownError,
  RewardAlreadyResolvedError,
} from './rewards.errors';

// Контур rewards (design 2026-09-10 §2/§3). Два входа:
// 1) executeEffects — из диспетчера app-runtime, ВНУТРИ его outbox.run (вложенный
//    run запрещён — поэтому tx приходит параметром); отказ → откат всей транзакции.
// 2) REST-методы (createPrize/listAwards/fulfill/revoke) — свои outbox.run.
// События rewards.* коммитятся в той же транзакции (лог — нотификация и аудит,
// ADR-005; таблицы остаются источником состояния).
@Injectable()
export class RewardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
    private readonly eventLog: EventLogService,
    private readonly outbox: EventOutbox,
  ) {}

  // --- Вход 1: эффекты из app-runtime (чужая транзакция) ---

  async executeEffects(
    tx: Prisma.TransactionClient,
    roomId: string,
    sourceAppId: string,
    effects: readonly AppEffect[],
  ): Promise<void> {
    for (const effect of effects) {
      if (effect.kind === 'award.prize') {
        await this.awardPrize(tx, roomId, sourceAppId, effect.prizeId, effect.winnerId);
      } else {
        await tx.pointsGrant.create({
          data: {
            roomId,
            identityId: effect.identityId,
            points: effect.points,
            reason: effect.reason ?? null,
            sourceAppId,
          },
        });
      }
    }
  }

  // Порядок «insert Award → декремент» (не наоборот): конфликт частичного индекса
  // — типизированный no-op (REQ-RWD-003), и он НЕ должен списывать фонд; отказ
  // декремента откатывает insert вместе со всей транзакцией (REQ-RWD-010).
  private async awardPrize(
    tx: Prisma.TransactionClient,
    roomId: string,
    sourceAppId: string,
    prizeId: string,
    winnerId: string,
  ): Promise<void> {
    const prize = await tx.prize.findFirst({ where: { id: prizeId, roomId } });
    if (!prize) throw new PrizeUnknownError(prizeId);
    let awardId: string;
    try {
      const award = await tx.award.create({
        data: { roomId, prizeId, winnerId, sourceAppId },
      });
      awardId = award.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return; // сетевой повтор того же награждения — типизированный no-op
      }
      throw err;
    }
    const decremented = await tx.$executeRaw`
      UPDATE rewards."Prize" SET quantity = quantity - 1, "updatedAt" = now()
      WHERE id = ${prizeId}::uuid AND quantity >= 1`;
    if (decremented === 0) throw new PrizeFundExhaustedError(prizeId); // откатит insert
    await this.eventLog.commitRewardsEvent(tx, roomId, 'reward.awarded', {
      awardId,
      prizeId,
      winnerId,
      sourceAppId,
    });
  }

  // --- Вход 2: REST-контур организатора ---

  async createPrize(roomId: string, actorId: string, input: CreatePrizeRequest) {
    await this.assertOrganizer(roomId, actorId);
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    // Добавление призов — в не-терминальной комнате (design §2: призы добавляют
    // на ходу; fulfill/revoke при COMPLETED — отдельная норма REQ-RWD-009).
    if (!room || room.deletedAt !== null || (room.status !== 'DRAFT' && room.status !== 'ACTIVE')) {
      throw new RoomNotActiveError(`room ${roomId} does not accept new prizes`);
    }
    return this.prisma.prize.create({
      data: { roomId, name: input.name, quantity: input.quantity, quantityTotal: input.quantity },
    });
  }

  async listAwards(roomId: string, actorId: string) {
    await this.assertOrganizer(roomId, actorId);
    // REQ-RWD-009: организатор видит все награды, включая оставшиеся AWARDED
    // при COMPLETED — статус комнаты здесь сознательно не гейтится.
    return this.prisma.award.findMany({ where: { roomId }, orderBy: { createdAt: 'asc' } });
  }

  async fulfill(roomId: string, awardId: string, actorId: string) {
    return this.outbox.run(async (tx) => {
      await this.assertOrganizer(roomId, actorId, tx);
      const award = await tx.award.findFirst({ where: { id: awardId, roomId } });
      if (!award) throw new AwardUnknownError(awardId);
      if (award.status === 'FULFILLED') return award; // типизированный no-op (REQ-RWD-007)
      if (award.status !== 'AWARDED') throw new RewardAlreadyResolvedError(awardId, award.status);
      const n = await tx.$executeRaw`
        UPDATE rewards."Award" SET status = 'FULFILLED', "fulfilledAt" = now()
        WHERE id = ${awardId}::uuid AND status = 'AWARDED'`;
      if (n === 0) return tx.award.findUniqueOrThrow({ where: { id: awardId } }); // гонка — перечитать
      await this.eventLog.commitRewardsEvent(tx, roomId, 'reward.fulfilled', { awardId }, actorId);
      return tx.award.findUniqueOrThrow({ where: { id: awardId } });
    });
  }

  async revoke(roomId: string, awardId: string, actorId: string) {
    return this.outbox.run(async (tx) => {
      await this.assertOrganizer(roomId, actorId, tx);
      const award = await tx.award.findFirst({ where: { id: awardId, roomId } });
      if (!award) throw new AwardUnknownError(awardId);
      if (award.status === 'REVOKED') return award; // no-op: quantity НЕ возвращаем повторно
      if (award.status !== 'AWARDED') throw new RewardAlreadyResolvedError(awardId, award.status);
      const n = await tx.$executeRaw`
        UPDATE rewards."Award" SET status = 'REVOKED', "revokedAt" = now()
        WHERE id = ${awardId}::uuid AND status = 'AWARDED'`;
      if (n === 0) return tx.award.findUniqueOrThrow({ where: { id: awardId } }); // гонка
      // Возврат quantity — только если переход состоялся (двойной отзыв не
      // возвращает quantity дважды, REQ-RWD-007); у безпризовой награды возвращать нечего.
      if (award.prizeId !== null) {
        await tx.$executeRaw`
          UPDATE rewards."Prize" SET quantity = quantity + 1, "updatedAt" = now()
          WHERE id = ${award.prizeId}::uuid`;
      }
      await this.eventLog.commitRewardsEvent(tx, roomId, 'reward.revoked', { awardId }, actorId);
      return tx.award.findUniqueOrThrow({ where: { id: awardId } });
    });
  }

  // Проверка роли — в домене, не в транспорте (прецедент MembershipService.exclude).
  private async assertOrganizer(
    roomId: string,
    actorId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const membership = await this.membership.findActiveMembership(roomId, actorId);
    if (!membership) throw new ActorNotMemberError(`identity ${actorId} is not a member of room ${roomId}`);
    if (membership.role !== 'ORGANIZER') throw new ActorNotOrganizerError(`identity ${actorId} is not the organizer of room ${roomId}`);
    void tx; // findActiveMembership читает своим клиентом; tx-вариант — при первой гонке (follow-up)
  }
}
```

Примечание исполнителю: точные имена/сигнатуры `ActorNotMemberError`/`ActorNotOrganizerError` и аргументы `findActiveMembership` сверить с `membership/membership.errors.ts` и `membership.service.ts:64-71`; если `findActiveMembership` не принимает tx — вызов как есть (прецедент exclude делает проверку вне tx). Если assertOrganizer остаётся одноклиентным — параметр tx убрать, отразить в леджере.

`rewards.module.ts` (контроллер — Task 6, handler-провайдер и @Global — Task 11):

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MembershipModule } from '../membership/membership.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RewardsService } from './rewards.service';

@Module({
  imports: [PrismaModule, MembershipModule, RealtimeModule],
  providers: [RewardsService],
  exports: [RewardsService],
})
export class RewardsModule {}
```

`event-log.service.ts` — refactor к общему пути (тела `commitCoreEvent` заменить делегированием; поведение не меняется):

```typescript
  async commitCoreEvent(
    tx: Prisma.TransactionClient,
    roomId: string,
    name: CoreEventName,
    payload: unknown = {},
    actorId: string | null = null,
  ): Promise<LogEvent> {
    return this.commitStaticEvent(tx, roomId, coreEventType(name), CORE_EVENTS[name], payload, actorId);
  }

  // События контура rewards (design 2026-09-10 §2): тот же статический путь, что
  // core.*, — реестр REWARDS_EVENTS core-owned, клиентский publish закрыт в gateway
  // (namespace 'rewards' не зарегистрирован как appId → EVENT_UNKNOWN_TYPE).
  async commitRewardsEvent(
    tx: Prisma.TransactionClient,
    roomId: string,
    name: RewardsEventName,
    payload: unknown = {},
    actorId: string | null = null,
  ): Promise<LogEvent> {
    return this.commitStaticEvent(tx, roomId, rewardsEventType(name), REWARDS_EVENTS[name], payload, actorId);
  }

  private async commitStaticEvent(
    tx: Prisma.TransactionClient,
    roomId: string,
    type: string,
    definition: EventTypeDefinition,
    payload: unknown,
    actorId: string | null,
  ): Promise<LogEvent> {
    const parsed = definition.schema.safeParse(payload);
    if (!parsed.success) {
      throw new ContractError(
        'EVENT_PAYLOAD_INVALID',
        `payload of ${type} does not match its core schema`,
      );
    }
    return this.appendLocked(tx, roomId, type, parsed.data, actorId, definition.visibility, definition.version);
  }
```

Импорты `REWARDS_EVENTS, RewardsEventName, rewardsEventType, EventTypeDefinition` из `@mymozhem/sdk`.

Barrel `packages/core/src/index.ts` += `export * from './rewards/rewards.module';`, `export * from './rewards/rewards.service';`, `export * from './rewards/rewards.errors';` (и `./rewards/rewards.controller` в Task 6).

- [ ] **Step 4: Run — GREEN**

Run: `pnpm --filter @mymozhem/sdk build && pnpm --filter @mymozhem/core test:int -- rewards`
Expected: PASS обоих int-файлов (rewards-schema, rewards). Затем `pnpm build && pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core test:int` — регрессий нет (refactor commitCoreEvent накрыт существующими спеками event-commit/realtime).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rewards packages/core/src/realtime packages/core/src/index.ts
git commit -m "feat(core): RewardsService — эффекты награждения в транзакции коммита, автомат AWARDED→FULFILLED|REVOKED, commitRewardsEvent

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: REST-контур rewards (контроллер + wire-маппинг)

**Files:**
- Create: `packages/core/src/rewards/rewards.controller.ts`
- Modify: `packages/core/src/rewards/rewards.module.ts` (controllers)
- Modify: `packages/core/src/transport/http-exception.filter.ts` (статусы + ветка RewardsError/ContractError)
- Modify: `packages/core/src/index.ts` (barrel += controller не нужен наружу; только если по паттерну)
- Test: `packages/core/src/transport/http-exception.filter.spec.ts` (существующий — кейсы маппинга), `packages/core/src/rewards/rewards.controller.int-spec.ts` (HTTP-путь через fastify inject)

**Interfaces:**
- Consumes: `RewardsService` (Task 5), `createPrizeRequestSchema`/`prizeResponseSchema`/`awardResponseSchema`/`listRewardsResponseSchema` (Task 3), `authenticate(req, tokens)` (transport/authenticate.ts), `TokenService` (AuthModule), прецедент контроллера — `transport/exclude.controller.ts`.
- Produces: эндпоинты `POST /rooms/:roomId/prizes` (201), `GET /rooms/:roomId/rewards`, `POST /rooms/:roomId/awards/:awardId/fulfill`, `POST /rooms/:roomId/awards/:awardId/revoke` (200) — их e2e-приёмка в Task 12.

**REQ:** REQ-RWD-004 (вручение/отзыв — явным действием организатора), REQ-RWD-009 (доступ при COMPLETED), REQ-SEC-006 (наружу ровно {code}).

- [ ] **Step 1: Failing unit — маппинг новых кодов**

В `http-exception.filter.spec.ts` добавить кейсы (форма — по соседним кейсам спека):

```typescript
  it.each([
    ['PRIZE_UNKNOWN', 404],
    ['AWARD_UNKNOWN', 404],
    ['PRIZE_FUND_EXHAUSTED', 409],
    ['REWARD_ALREADY_RESOLVED', 409],
    ['ROOM_NOT_ACTIVE', 409],
  ] as const)('maps rewards error %s to %i with bare {code} body', (code, status) => {
    // по существующему паттерну спека: поймать new PrizeUnknownError(...) /
    // ContractError(code, ...) через filter.catch и проверить reply.status/send
  });
```

(Если спек строит reply-мок хелпером — переиспользовать его; брошенное исключение — соответствующий класс из rewards.errors или `new ContractError(code, 'x')`.)

- [ ] **Step 2: Failing int — HTTP-путь**

`packages/core/src/rewards/rewards.controller.int-spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { APP_FILTER } from '@nestjs/core';
import { AppRegistryModule } from '../app-registry/app-registry.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { MembershipModule } from '../membership/membership.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { HttpExceptionFilter } from '../transport/http-exception.filter';
import { TokenService } from '../auth/token.service';
import { RoomService } from '../room/room.service';
import { RoomModule } from '../room/room.module';
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import { RewardsModule } from './rewards.module';
import { RewardsService } from './rewards.service';

// Если @nestjs/platform-fastify отсутствует в devDeps core — добавить
// (workspace-версия как у apps/server) и зафиксировать в леджере.

describe('RewardsController (int)', () => {
  let db: TestDb;
  let app: NestFastifyApplication;
  let tokens: TokenService;
  let roomService: RoomService;
  let rewards: RewardsService;

  const ORG = '00000000-0000-4000-8000-000000000001';

  beforeAll(async () => {
    db = await startTestDb();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule, PrismaModule, AppRegistryModule.register([]),
        AuthModule, MembershipModule, RealtimeModule, RoomModule, RewardsModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.listen(0, '127.0.0.1');
    tokens = app.get(TokenService);
    roomService = app.get(RoomService);
    rewards = app.get(RewardsService);
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
  }, 120_000);

  afterAll(async () => { await app.close(); await db.stop(); });
  afterEach(async () => {
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE rewards."Award", rewards."Prize", identity."Session", membership."Membership", room."Room" CASCADE',
    );
  });

  // organizerToken — guest-claims, роль ORGANIZER из membership (прецедент
  // transport.e2e-spec.ts:362-367).
  async function orgRoom() {
    const room = await roomService.create(ORG);
    const { accessToken } = await tokens.issueGuestTokens(ORG, room.id);
    return { room, token: accessToken };
  }
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  it('POST /rooms/:id/prizes → 201; повтор для PARTICIPANT → 403 ACTOR_NOT_ORGANIZER; невалидное тело → 400 REQUEST_INVALID', async () => {
    const { room, token } = await orgRoom();
    const created = await app.inject({
      method: 'POST', url: `/rooms/${room.id}/prizes`,
      headers: auth(token), payload: { name: 'Приз', quantity: 2 },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: 'Приз', quantity: 2, quantityTotal: 2 });

    const bad = await app.inject({
      method: 'POST', url: `/rooms/${room.id}/prizes`,
      headers: auth(token), payload: { name: '', quantity: 0 },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ code: 'REQUEST_INVALID' });

    const guest = await seedIdentity(db.prisma, { kind: 'GUEST', displayName: 'Не организатор' });
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: guest.id, role: 'PARTICIPANT', joinIp: '127.0.0.1' } });
    const guestToken = (await tokens.issueGuestTokens(guest.id, room.id)).accessToken;
    const forbidden = await app.inject({
      method: 'POST', url: `/rooms/${room.id}/prizes`,
      headers: auth(guestToken), payload: { name: 'Приз', quantity: 1 },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ code: 'ACTOR_NOT_ORGANIZER' });
  });

  it('fulfill/revoke по HTTP: no-op повторного вручения → 200, cross-переход → 409 REWARD_ALREADY_RESOLVED, чужая награда → 404', async () => {
    const { room, token } = await orgRoom();
    await roomService.activate(room.id, ORG); // configure не нужен: комната без app для REST-контура
    const prize = await rewards.createPrize(room.id, ORG, { name: 'Приз', quantity: 1 });
    const winner = await seedIdentity(db.prisma, { kind: 'GUEST', displayName: 'Победитель' });
    await db.prisma.award.create({ data: { roomId: room.id, prizeId: prize.id, winnerId: winner.id, sourceAppId: 'lottery' } });
    const award = await db.prisma.award.findFirstOrThrow({ where: { roomId: room.id } });

    const f1 = await app.inject({ method: 'POST', url: `/rooms/${room.id}/awards/${award.id}/fulfill`, headers: auth(token) });
    expect(f1.statusCode).toBe(200);
    expect(f1.json()).toMatchObject({ id: award.id, status: 'FULFILLED' });
    const f2 = await app.inject({ method: 'POST', url: `/rooms/${room.id}/awards/${award.id}/fulfill`, headers: auth(token) });
    expect(f2.statusCode).toBe(200); // типизированный no-op
    const cross = await app.inject({ method: 'POST', url: `/rooms/${room.id}/awards/${award.id}/revoke`, headers: auth(token) });
    expect(cross.statusCode).toBe(409);
    expect(cross.json()).toEqual({ code: 'REWARD_ALREADY_RESOLVED' });
    const missing = await app.inject({ method: 'POST', url: `/rooms/${room.id}/awards/${crypto.randomUUID()}/fulfill`, headers: auth(token) });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: 'AWARD_UNKNOWN' });

    const list = await app.inject({ method: 'GET', url: `/rooms/${room.id}/rewards`, headers: auth(token) });
    expect(list.statusCode).toBe(200);
    expect(list.json().awards).toHaveLength(1);
  });

  it('без токена → 401 SESSION_INVALID', async () => {
    const { room } = await orgRoom();
    const res = await app.inject({ method: 'GET', url: `/rooms/${room.id}/rewards` });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'SESSION_INVALID' });
  });
});
```

(Если `roomService.create` требует иных аргументов или activate требует configure — сверить с room.service.ts; комната для REST-контура rewards может оставаться DRAFT/ACTIVE без appId.)

- [ ] **Step 3: Run — RED**

Run: `pnpm --filter @mymozhem/core test -- http-exception && pnpm --filter @mymozhem/core test:int -- rewards.controller`
Expected: FAIL (контроллер не существует; статусы не замаплены).

- [ ] **Step 4: Implement — контроллер**

`packages/core/src/rewards/rewards.controller.ts`:

```typescript
import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import {
  awardResponseSchema,
  createPrizeRequestSchema,
  listRewardsResponseSchema,
  prizeResponseSchema,
  type AwardResponse,
  type PrizeResponse,
} from '@mymozhem/sdk';
import type { Award, Prize } from '@prisma/client';
import { authenticate, type RequestLike } from '../transport/authenticate';
import { TokenService } from '../auth/token.service';
import { RewardsService } from './rewards.service';

// REST-контур управления фондом и наградами (design 2026-09-10 §2): cross-app
// управляющие действия платформенного контура, не внутриигровые команды механики —
// поэтому HTTP с существующими гардами, а не realtime-команды. Проверка роли —
// в домене (RewardsService.assertOrganizer), контроллер статусов не знает.
@Controller('rooms')
export class RewardsController {
  constructor(
    private readonly rewards: RewardsService,
    private readonly tokens: TokenService,
  ) {}

  @Post(':roomId/prizes')
  async createPrize(@Req() req: RequestLike, @Param('roomId') roomId: string): Promise<PrizeResponse> {
    const claims = await authenticate(req, this.tokens);
    const parsedRoomId = z.uuid().parse(roomId);
    const input = createPrizeRequestSchema.parse(req.body ?? {});
    const prize = await this.rewards.createPrize(parsedRoomId, claims.sub, input);
    return prizeResponseSchema.parse(toPrizeResponse(prize));
  }

  @Get(':roomId/rewards')
  async listRewards(@Req() req: RequestLike, @Param('roomId') roomId: string) {
    const claims = await authenticate(req, this.tokens);
    const parsedRoomId = z.uuid().parse(roomId);
    const awards = await this.rewards.listAwards(parsedRoomId, claims.sub);
    return listRewardsResponseSchema.parse({ awards: awards.map(toAwardResponse) });
  }

  @Post(':roomId/awards/:awardId/fulfill')
  @HttpCode(200)
  async fulfill(
    @Req() req: RequestLike,
    @Param('roomId') roomId: string,
    @Param('awardId') awardId: string,
  ): Promise<AwardResponse> {
    const claims = await authenticate(req, this.tokens);
    const award = await this.rewards.fulfill(z.uuid().parse(roomId), z.uuid().parse(awardId), claims.sub);
    return awardResponseSchema.parse(toAwardResponse(award));
  }

  @Post(':roomId/awards/:awardId/revoke')
  @HttpCode(200)
  async revoke(
    @Req() req: RequestLike,
    @Param('roomId') roomId: string,
    @Param('awardId') awardId: string,
  ): Promise<AwardResponse> {
    const claims = await authenticate(req, this.tokens);
    const award = await this.rewards.revoke(z.uuid().parse(roomId), z.uuid().parse(awardId), claims.sub);
    return awardResponseSchema.parse(toAwardResponse(award));
  }
}

function toPrizeResponse(p: Prize): PrizeResponse {
  return {
    id: p.id, roomId: p.roomId, name: p.name,
    quantityTotal: p.quantityTotal, quantity: p.quantity,
    createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
  };
}

function toAwardResponse(a: Award): AwardResponse {
  return {
    id: a.id, roomId: a.roomId, prizeId: a.prizeId, winnerId: a.winnerId,
    status: a.status, sourceAppId: a.sourceAppId,
    createdAt: a.createdAt.toISOString(),
    fulfilledAt: a.fulfilledAt?.toISOString() ?? null,
    revokedAt: a.revokedAt?.toISOString() ?? null,
  };
}
```

(Точные имена `RequestLike`/сигнатуру `authenticate` сверить с `transport/authenticate.ts` и `exclude.controller.ts`; если body у RequestLike не типизирован — `(req as { body?: unknown }).body`.) Ответная `.parse` на границе — прецедент follow-up OAuth-среза (`createRoomResponseSchema.parse`); парсинг ответа приводит Date→ISO и отсекает лишние поля.

`rewards.module.ts`: `imports: [..., AuthModule]`, `controllers: [RewardsController]`. (AuthModule экспортирует TokenService — прецедент transport.module.ts:20.)

- [ ] **Step 5: Implement — wire-маппинг**

`http-exception.filter.ts`, в `STATUS_BY_WIRE_CODE` перед `INTERNAL_ERROR`:

```typescript
  // Фаза 3 (design 2026-09-10 §2): REST-контур rewards.
  ROOM_NOT_ACTIVE: 409,
  PRIZE_UNKNOWN: 404,
  AWARD_UNKNOWN: 404,
  PRIZE_FUND_EXHAUSTED: 409,
  REWARD_ALREADY_RESOLVED: 409,
```

В `toWireCode` — ветка после `RoomError` (до ZodError):

```typescript
    // Ошибки контракта с wire-паритетом кода (rewards ф.3 и далее): класс-
    // специфичные ветки выше сохраняют свои правила свёртки; сюда попадают
    // ContractError'ы, коды которых сознательно добавлены в STATUS_BY_WIRE_CODE.
    if (exception instanceof ContractError && exception.code in STATUS_BY_WIRE_CODE) {
      return exception.code as WireCode;
    }
```

(импорт `ContractError` из `@mymozhem/sdk`.)

- [ ] **Step 6: Run — GREEN**

Run: `pnpm --filter @mymozhem/sdk build && pnpm build && pnpm --filter @mymozhem/core test -- http-exception && pnpm --filter @mymozhem/core test:int -- rewards`
Expected: PASS. Полная лана core: `pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core test:int`.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/rewards packages/core/src/transport packages/core/package.json pnpm-lock.yaml packages/core/src/index.ts
git commit -m "feat(core): REST-контур rewards — prizes/rewards/fulfill/revoke, wire-маппинг кодов фазы 3

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

**Конец Batch B.** Зелёный конвейер батча: `pnpm build && pnpm lint && pnpm boundary-check && pnpm guardrails && pnpm test && pnpm test:int`. Дальше — новой сессией.

---
### Task 7: app-runtime — исполнение эффектов, capability-гейт, наполнение хост-примитивов

**Files:**
- Create: `packages/core/src/app-runtime/effects.ts` (токен + интерфейс)
- Modify: `packages/core/src/app-runtime/app-runtime.service.ts` (capability-гейт, исполнение эффектов до коммитов, drawPool)
- Modify: `packages/core/src/membership/membership.service.ts` (`listActiveParticipantPool`)
- Modify: `packages/core/src/app-runtime/app-runtime.module.ts` (опциональная инжекция — без правок, если `@Optional()` в сервисе)
- Modify: `packages/core/src/index.ts` (barrel += effects)
- Test: `packages/core/src/app-runtime/app-runtime.int-spec.ts` (существующий — новые кейсы)

**Interfaces:**
- Consumes: `normalizePublishResult`/`appEffectSchema`/`DrawPoolEntry` (Task 3), `RewardsService.executeEffects` (Task 5) — связка только в Task 11, здесь токен и опциональная инжекция.
- Produces:
  - `AWARD_EFFECT_HANDLER: symbol` и `interface AwardEffectHandler { executeEffects(tx: Prisma.TransactionClient, roomId: string, sourceAppId: string, effects: readonly AppEffect[]): Promise<void> }` — обьявлены в `core/src/app-runtime/effects.ts`; реализует RewardsService (Task 5 сигнатура совместима), подключает composition root (Task 11).
  - `MembershipService.listActiveParticipantPool(roomId): Promise<DrawPoolEntry[]>`.
  - Диспетчер: эффекты при отсутствии capability/'rewards' или исполнителя → `CAPABILITY_UNAVAILABLE` до исполнения; эффекты исполняются в `outbox.run` ДО коммитов; `ctx.drawPool` наполняется только для модулей с capability.

**REQ:** REQ-RWD-001 (ядро не зависит от rewards — только токен), REQ-RWD-003/010 (эффекты до событий в одной транзакции), REQ-RWD-005, REQ-RWD-011 (randomInt из хоста), REQ-RWD-014 (пул как данные ctx).

- [ ] **Step 1: Failing int-tests**

В `packages/core/src/app-runtime/app-runtime.int-spec.ts` добавить describe (бутстрап и TEST-APP хелперы — по существующим кейсам файла; фейковый модуль строится с `manifest.capabilities` и захватывает ctx):

```typescript
  // Заготовки к кейсам ниже: capabilityModule(overrides) — модуль с
  // capabilities: ['rewards'], handlePublish захватывает ctx и возвращает
  // заданные commits/effects; plainModule — без capabilities (форма возврата
  // по-прежнему допускает голый массив). Регистрация комнаты с TEST-манифестом —
  // существующий путь спека (configure + activate).

  it('backward compat: модуль, вернувший голый AppCommit[], коммитится как прежде', async () => {
    // publish клиентской команды plainModule → ack ok, событие в логе (существующий happy-path спека уже близок — здесь фиксируется именно старая форма возврата).
  });

  it('эффекты без capability → CAPABILITY_UNAVAILABLE, в лог ничего не попадает', async () => {
    // plainModule возвращает { commits: [echo], effects: [{ kind: 'award.points', ... }] }
    // → dispatch отклоняет ContractError code CAPABILITY_UNAVAILABLE;
    // logEvent.count({ roomId }) === baseline (ни echo, ни чего-либо ещё).
  });

  it('эффекты с capability, но без подключённого исполнителя → CAPABILITY_UNAVAILABLE (fail-closed)', async () => {
    // capabilityModule + effects, testing-module БЕЗ провайдера AWARD_EFFECT_HANDLER.
  });

  it('с подключённым исполнителем эффекты исполняются ДО коммитов одной транзакцией: отказ эффекта откатывает события', async () => {
    // Провайдер-спай { provide: AWARD_EFFECT_HANDLER, useValue: spy } где spy.executeEffects
    // бросает ContractError('PRIZE_FUND_EXHAUSTED', ...) → dispatch отклоняется,
    // в логе 0 новых событий; порядок «эффекты до коммитов» фиксируется записью
    // вызовов (spy помечает, что на момент вызова лога нет — читает logEvent.count через prisma внутри tx... упрощённо: spy вызывается, а событий в логе нет после отказа).
  });

  it('drawPool: capability-модуль получает активных PARTICIPANT (без организатора/зрителей/исключённых), plain-модуль — пустой пул', async () => {
    // Комната: организатор + 2 guest-PARTICIPANT + 1 SPECTATOR + 1 исключённый
    // (soft-delete membership). capabilityModule захватывает ctx.drawPool →
    // ровно 2 записи { identityId, kind: 'GUEST' }. plainModule → drawPool: [].
  });

  it('ctx.randomInt — node:crypto CSPRNG: границы и покрытие (REQ-RWD-011 sanity)', async () => {
    // Захваченный ctx: 3000 вызовов randomInt(3) → все в [0,3), встречаются все три значения.
  });
```

(Имена существующих хелперов спека — TEST_APP/регистрация модулей через `AppRuntimeModule.register([...])` в testing module — сверить с файлом и переиспользовать.)

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/core test:int -- app-runtime`
Expected: FAIL (CAPABILITY_UNAVAILABLE есть, но drawPool/исполнение не реализованы; новые describe падают).

- [ ] **Step 3: Implement — токен и интерфейс**

`packages/core/src/app-runtime/effects.ts`:

```typescript
import type { Prisma } from '@prisma/client';
import type { AppEffect } from '@mymozhem/sdk';

// DI-шов «ядро не зависит от rewards» (REQ-RWD-001, design 2026-09-10 §2):
// app-runtime знает только этот интерфейс; реализация — RewardsService,
// подключается в composition root. Boundary-правило запрещает остальным доменам
// ядра импорт core/rewards (Task 11).
export interface AwardEffectHandler {
  executeEffects(
    tx: Prisma.TransactionClient,
    roomId: string,
    sourceAppId: string,
    effects: readonly AppEffect[],
  ): Promise<void>;
}

export const AWARD_EFFECT_HANDLER = Symbol('AWARD_EFFECT_HANDLER');
```

- [ ] **Step 4: Implement — пул в membership**

`membership.service.ts`:

```typescript
  // Снапшот пула розыгрыша для хост-примитива drawPool (design 2026-09-10 §2):
  // активные PARTICIPANT-членства комнаты; организатор (роль ORGANIZER), зрители
  // (SPECTATOR), исключённые и soft-deleted не входят. Комната удалённая — пул пуст.
  async listActiveParticipantPool(roomId: string): Promise<DrawPoolEntry[]> {
    const rows = await this.prisma.membership.findMany({
      where: {
        roomId,
        role: 'PARTICIPANT',
        deletedAt: null,
        room: { deletedAt: null },
      },
      select: { identityId: true, identity: { select: { kind: true } } },
    });
    return rows.map((r) => ({ identityId: r.identityId, kind: r.identity.kind }));
  }
```

(импорт `type DrawPoolEntry` из `@mymozhem/sdk`.)

- [ ] **Step 5: Implement — диспетчер**

`app-runtime.service.ts`:
1. Конструктор += последним параметром:

```typescript
    @Optional() @Inject(AWARD_EFFECT_HANDLER)
    private readonly awardEffectHandler?: AwardEffectHandler,
```

(импорты `Optional`, `Inject` из '@nestjs/common'; `AWARD_EFFECT_HANDLER`, `AwardEffectHandler` из './effects'.)

2. В `dispatchLocked` после разрешения модуля (шаг 3) — capability:

```typescript
    const hasRewardsCapability = mod.manifest.capabilities?.includes('rewards') ?? false;
```

3. ctx: заменить заглушку `drawPool: []` (Task 3) на наполнение:

```typescript
      // Пул — только модулю с capability 'rewards' (design §2): publish'и квиза
      // не грузят membership. Запрос до вызова модуля, снапшот на момент команды.
      drawPool: hasRewardsCapability
        ? await this.membership.listActiveParticipantPool(params.roomId)
        : [],
```

4. Заменить fail-closed блок Task 3 (`if (effects.length > 0) throw CAPABILITY_UNAVAILABLE …`) на гейт и запоминание исполнителя:

```typescript
    let effectHandler: AwardEffectHandler | undefined;
    if (effects.length > 0) {
      if (!hasRewardsCapability) {
        // Эффект награждения без capability манифеста — отказ до исполнения (REQ-RWD-001).
        throw new ContractError(
          'CAPABILITY_UNAVAILABLE',
          `module ${mod.appId}@${mod.manifestVersion} emitted award effects without the 'rewards' capability`,
        );
      }
      effectHandler = this.awardEffectHandler;
      if (!effectHandler) {
        throw new ContractError(
          'CAPABILITY_UNAVAILABLE',
          'rewards effect handler is not wired in this deployment',
        );
      }
    }
```

5. В `outbox.run` перед циклом коммитов:

```typescript
    const committed = await this.outbox.run(async (tx) => {
      // Эффекты ДО событий (design §2): событие «победитель определён» не попадает
      // в лог, если награждение не состоялось; отказ эффекта откатывает всё.
      if (effectHandler) {
        await effectHandler.executeEffects(tx, params.roomId, mod.appId, effects);
      }
      const out = [];
      // ... цикл коммитов без изменений
```

(Валидация эффектов `appEffectSchema.safeParse` из Task 3 остаётся на месте.)

Barrel `index.ts` += `export * from './app-runtime/effects';`.

- [ ] **Step 6: Run — GREEN**

Run: `pnpm --filter @mymozhem/core test:int -- app-runtime && pnpm build && pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core test:int`
Expected: PASS. Внимание к DI: AppRuntimeModule.register уже несёт `imports: [PrismaModule, MembershipModule, RealtimeModule]` — listActiveParticipantPool разрешается штатно; `AWARD_EFFECT_HANDLER` опционален (`@Optional()`), поэтому существующие testing-модули без провайдера не ломаются.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/app-runtime packages/core/src/membership packages/core/src/index.ts
git commit -m "feat(core): исполнение эффектов в app-runtime — capability-гейт, AWARD_EFFECT_HANDLER, drawPool/randomInt наполнение

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: TTL-свип гостей + ANONYMIZATION_GUARDS + scheduler

**Files:**
- Create: `packages/core/src/identity/anonymization-guards.ts`
- Create: `packages/core/src/identity/guest-sweep.service.ts`
- Create: `packages/core/src/identity/identity-sweep.module.ts` (scheduler; только для composition root)
- Modify: `packages/core/src/identity/identity.module.ts` (GuestSweepService)
- Create: `packages/core/src/rewards/rewards-anonymization.guard.ts`
- Modify: `packages/core/src/rewards/rewards.module.ts` (guard provider + export)
- Modify: `packages/core/package.json` (dep `@nestjs/schedule`)
- Modify: `packages/core/src/index.ts` (barrel)
- Test: `packages/core/src/identity/guest-sweep.int-spec.ts`

**Interfaces:**
- Consumes: `CLEANUP_INTERVAL`/`GUEST_TTL` (Task 4/config), `RewardsService`-таблицы (Task 4), прецедент отзыва сессий (`membership.service.ts:118-123`), прецедент hook `onAccessRevoked` (membership).
- Produces:
  - `interface AnonymizationGuard { hasOpenAwards(identityIds: readonly string[]): Promise<Set<string>> }`, `ANONYMIZATION_GUARDS: symbol` (identity) — реализует `RewardsAnonymizationGuard`, связывает composition root (Task 11).
  - `GuestSweepService.sweepExpiredGuests(now?: Date): Promise<number>` — вызывается scheduler'ом и напрямую в тестах.
  - `IdentitySweepModule` (scheduler на SchedulerRegistry) — импортирует только composition root (Task 11).

**REQ:** REQ-ID-003/014 (догон свипа), REQ-RWD-013 (приостановка при открытой AWARDED), REQ-ID-010 (cleanup_interval), REQ-OPS-005 (одна реплика — дублей джобы нет), REQ-RWD-001 (identity не знает про rewards).

- [ ] **Step 1: Failing int-tests**

`packages/core/src/identity/guest-sweep.int-spec.ts`:

```typescript
// Бутстрап: ConfigModule + PrismaModule + IdentityModule + (RewardsModule для гарда)
// + AuthModule (issueGuestTokens создаёт Session-строки). TEST_CONFIG.GUEST_TTL = 86400.

describe('GuestSweepService (int, REQ-ID-003/014 + REQ-RWD-013)', () => {
  // Хелпер: expiredGuest() — seedIdentity(GUEST) + backdate:
  //   await db.prisma.$executeRaw`UPDATE identity."Identity" SET "createdAt" = now() - interval '25 hours' WHERE id = ${id}::uuid`;

  it('гость с истёкшим TTL анонимизируется: displayName/email → NULL, deletedAt выставлен, живые сессии отозваны', async () => {
    // expiredGuest + issueGuestTokens(guest.id, roomId) → sweepExpiredGuests()
    // identity: displayName null, deletedAt не null, id сохранён (анонимизация, не удаление)
    // session.revokedAt не null
  });

  it('гость с неистёкшим TTL и REGISTERED с истёкшим не тронуты', async () => {
    // fresh guest + backdated REGISTERED (email) → sweep → оба без deletedAt, email REGISTERED на месте
  });

  it('приостановка: гость с открытой AWARDED не анонимизируется; после fulfill — анонимизируется следующим проходом (REQ-RWD-013)', async () => {
    // expiredGuest + приз + award AWARDED на гостя (через RewardsService.executeEffects
    // в outbox.run) → sweep с guards=[RewardsAnonymizationGuard] → identity жива
    // (deletedAt null, displayName на месте); rewards.fulfill(...) → повторный sweep → анонимизирован.
    // То же через revoke.
  });

  it('без подключённых гардов приостановки нет (rewards не подключён — REQ-RWD-001)', async () => {
    // expiredGuest + открытая AWARDED (напрямую prisma.award.create) →
    // sweep с guards=[] → анонимизирован (приостанавливать некому).
  });
});
```

(Бутстрап модулей — по образцу rewards.int-spec.ts Task 5; сиды комнаты/приза — хелпером оттуда же, продублировать локально.)

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/core test:int -- guest-sweep`
Expected: FAIL (сервис не существует).

- [ ] **Step 3: Implement — токен и сервис свипа**

`packages/core/src/identity/anonymization-guards.ts`:

```typescript
// Приостановка TTL гостя через hook, не импортом (design 2026-09-10 §5,
// REQ-RWD-001/013): identity объявляет токен; rewards регистрирует guard в
// composition root. Паттерн — по прецеденту onAccessRevoked (membership).
export interface AnonymizationGuard {
  // Возвращает подмножество identityIds, у которых есть нерешённая награда
  // (AWARDED). identity про rewards не знает.
  hasOpenAwards(identityIds: readonly string[]): Promise<Set<string>>;
}

export const ANONYMIZATION_GUARDS = Symbol('ANONYMIZATION_GUARDS');
```

`packages/core/src/identity/guest-sweep.service.ts`:

```typescript
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { ANONYMIZATION_GUARDS, type AnonymizationGuard } from './anonymization-guards';

// Свип анонимизации гостей (REQ-ID-003/014, догон фазы 3): истечение guest_ttl
// реализуется анонимизацией строки (обнуление PII, сохранение id — внешние ключи
// и actorId в логе остаются валидными), не физическим удалением. База TTL —
// createdAt (решение владельца, design §0.8). Приостановка при открытой награде —
// через ANONYMIZATION_GUARDS (REQ-RWD-013); без подключённого rewards приостановки нет.
@Injectable()
export class GuestSweepService {
  private readonly logger = new Logger(GuestSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(ANONYMIZATION_GUARDS) private readonly guards: AnonymizationGuard[] = [],
  ) {}

  // Возвращает число анонимизированных identity. Вся выборка/гард/запись — одна
  // транзакция: гард-чек внутри неё закрывает окно гонки «награда создана между
  // чтением кандидатов и анонимизацией» (перечитывание deletedAt в updateMany —
  // вторая линия от гонки с ручным исключением).
  async sweepExpiredGuests(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.GUEST_TTL * 1000);
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.identity.findMany({
        where: { kind: 'GUEST', deletedAt: null, createdAt: { lt: cutoff } },
        select: { id: true },
      });
      if (candidates.length === 0) return 0;
      const ids = candidates.map((c) => c.id);
      const suspended = new Set<string>();
      for (const guard of this.guards) {
        for (const id of await guard.hasOpenAwards(ids)) suspended.add(id);
      }
      const sweepIds = ids.filter((id) => !suspended.has(id));
      if (sweepIds.length === 0) return 0;
      const anonymized = await tx.identity.updateMany({
        where: { id: { in: sweepIds }, deletedAt: null },
        data: { displayName: null, email: null, deletedAt: now },
      });
      // Отзыв живых сессий гостя — по прецеденту среза исключения
      // (membership.service.ts:118-123). Сессия гостя под приостановкой истекает
      // по своему капу как обычно (design §5) — здесь её нет.
      await tx.session.updateMany({
        where: { identityId: { in: sweepIds }, revokedAt: null },
        data: { revokedAt: now },
      });
      this.logger.log(`guest sweep: anonymized ${anonymized.count}, suspended ${suspended.size}`);
      return anonymized.count;
    });
  }
}
```

`identity.module.ts`: providers/exports += `GuestSweepService` (модуль и так импортирует PrismaModule; ConfigModule — добавить в imports, если APP_CONFIG не резолвится глобально — сверить с тем, как TokenService получает конфиг: AuthModule импортирует ConfigModule; здесь то же).

- [ ] **Step 4: Implement — guard rewards и scheduler**

`packages/core/src/rewards/rewards-anonymization.guard.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import type { AnonymizationGuard } from '../identity/anonymization-guards';
import { PrismaService } from '../prisma/prisma.service';

// REQ-RWD-013: гость с нерешённой наградой (AWARDED; FULFILLED/REVOKED — решённые)
// не анонимизируется до разрешения — иначе приз осиротеет из-за обнуления имени
// победителя до вручения.
@Injectable()
export class RewardsAnonymizationGuard implements AnonymizationGuard {
  constructor(private readonly prisma: PrismaService) {}

  async hasOpenAwards(identityIds: readonly string[]): Promise<Set<string>> {
    if (identityIds.length === 0) return new Set();
    const rows = await this.prisma.award.findMany({
      where: { winnerId: { in: [...identityIds] }, status: 'AWARDED' },
      select: { winnerId: true },
    });
    return new Set(rows.map((r) => r.winnerId));
  }
}
```

`rewards.module.ts`: providers/exports += `RewardsAnonymizationGuard`.

`packages/core/src/identity/identity-sweep.module.ts`:

```typescript
import { Inject, Injectable, Logger, Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { ConfigModule } from '../config/config.module';
import { IdentityModule } from './identity.module';
import { GuestSweepService } from './guest-sweep.service';

// Регистрация интервала свипа — только в composition root (этот модуль не
// импортируется тестами: логика свипа покрыта прямым вызовом sweepExpiredGuests).
// SchedulerRegistry резолвится из ScheduleModule.forRoot() composition root'а
// (глобальный после forRoot). Одна реплика (REQ-OPS-005) — дублей джобы нет.
@Injectable()
class GuestSweepScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(GuestSweepScheduler.name);

  constructor(
    private readonly sweep: GuestSweepService,
    private readonly registry: SchedulerRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    const interval = setInterval(() => {
      this.sweep.sweepExpiredGuests().catch((err) => {
        // Отказ прохода — error-лог, следующий проход повторит; джоба не роняет процесс.
        this.logger.error('guest sweep failed', err);
      });
    }, this.config.CLEANUP_INTERVAL * 1000);
    this.registry.addInterval('guest-sweep', interval);
  }

  onApplicationShutdown(): void {
    this.registry.deleteInterval('guest-sweep');
  }
}

@Module({
  imports: [ConfigModule, IdentityModule],
  providers: [GuestSweepScheduler],
})
export class IdentitySweepModule {}
```

`packages/core/package.json`: dependencies += `"@nestjs/schedule": "^6.0.0"` (совместимая с Nest 11 мажорная линейка — сверить с npm при установке; зафиксировать фактическую в леджере), затем `pnpm install`.

Barrel `index.ts` += `export * from './identity/anonymization-guards';`, `export * from './identity/guest-sweep.service';`, `export * from './identity/identity-sweep.module';`, `export * from './rewards/rewards-anonymization.guard';`.

- [ ] **Step 5: Run — GREEN**

Run: `pnpm build && pnpm --filter @mymozhem/core test:int -- guest-sweep`
Expected: PASS. Затем полная лана core (unit + int). Внимание: IdentitySweepModule НЕ импортируется тестовыми модулями — расписание в тестах не стартует.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/identity packages/core/src/rewards packages/core/package.json pnpm-lock.yaml packages/core/src/index.ts
git commit -m "feat(core): TTL-свип гостей с приостановкой при открытой награде — ANONYMIZATION_GUARDS, GuestSweepService, scheduler

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: packages/app-lottery — второй app-модуль

**Files:**
- Create: `packages/app-lottery/package.json`, `tsconfig.json`, `jest.config.js`
- Create: `packages/app-lottery/src/lottery-settings.ts`
- Create: `packages/app-lottery/src/lottery-events.ts`
- Create: `packages/app-lottery/src/lottery-manifest.ts`
- Create: `packages/app-lottery/src/lottery-state.ts`
- Create: `packages/app-lottery/src/lottery-handlers.ts`
- Create: `packages/app-lottery/src/lottery-runtime.ts`
- Create: `packages/app-lottery/src/index.ts`
- Test: `packages/app-lottery/src/lottery-manifest.contract.spec.ts`, `lottery-state.spec.ts`, `lottery-handlers.spec.ts`

**Interfaces:**
- Consumes: SDK 1.6.0 — `defineApp`, `AppHostContext` (randomInt/drawPool), `AppPublishResult`, `AppRejection`, `shortEventNameSchema` (dotted-lowercase), capability 'rewards' (Tasks 2-3).
- Produces: `createLotteryApp(): { manifest: AppManifest; runtime: AppRuntimeModule<LotteryState> }`, `LOTTERY_APP_ID = 'lottery'`, `LOTTERY_MANIFEST_VERSION = 1` — регистрирует composition root (Task 11); тип `LotterySettings` (`{ drawEligibility: 'guests_allowed' | 'verified' }`).

**REQ:** REQ-RWD-005 (winnerSelection делегирован приложению), REQ-RWD-011 (выбор только через ctx.randomInt), REQ-RWD-014 (eligibility), REQ-RWD-003 (идемпотентность drawId на уровне app-команды), REQ-CORE-004 (проекция из лога, своих таблиц нет), REQ-CTR-005/008/009.

- [ ] **Step 1: Failing tests — редьюсер**

`lottery-state.spec.ts` (хелпер `event(shortName, payload)` → AppLogEvent по образцу quiz-state.spec.ts):

```typescript
describe('reduceLottery', () => {
  it('draw.completed добавляет запись; повтор того же drawId — no-op (идемпотентность replay/live)', () => {
    const s0 = initialLotteryState();
    const e = event('draw.completed', { drawId: D1, prizeId: P1, winnerId: W1 });
    const s1 = reduceLottery(s0, e);
    expect(s1.draws[D1]).toEqual({ prizeId: P1, winnerId: W1 });
    expect(reduceLottery(s1, e)).toBe(s1); // та же ссылка — ничего не изменилось
    expect(reduceLottery(s1, event('draw.completed', { drawId: D1, prizeId: P1, winnerId: W2 })).draws[D1].winnerId).toBe(W1);
  });

  it('неизвестный тип — no-op; состояние иммутабельно', () => {
    const s0 = initialLotteryState();
    expect(reduceLottery(s0, event('something.else', {}))).toBe(s0);
  });
});
```

- [ ] **Step 2: Failing tests — обработчик**

`lottery-handlers.spec.ts` (хелперы `ctx(over)`, `expectRejection(fn, code)` по образцу quiz-handlers.spec.ts:36-69; `randomInt: () => 0` в ctx по умолчанию — детерминированный выбор pool[0]):

```typescript
describe('handleLotteryPublish draw.run', () => {
  const POOL = [
    { identityId: W1, kind: 'GUEST' as const },
    { identityId: W2, kind: 'GUEST' as const },
    { identityId: W3, kind: 'REGISTERED' as const },
  ];

  it('организатор разыгрывает приз: echo + draw.completed + эффект award.prize', () => {
    const result = handleLotteryPublish(ctx({ actorRole: 'ORGANIZER', drawPool: POOL }), 'draw.run', { drawId: D1, prizeId: P1 });
    expect(result).toEqual({
      commits: [
        { shortName: 'draw.run', payload: { drawId: D1, prizeId: P1 }, visibility: 'public', actor: 'publisher' },
        { shortName: 'draw.completed', payload: { drawId: D1, prizeId: P1, winnerId: W1 }, visibility: 'public', actor: 'server' },
      ],
      effects: [{ kind: 'award.prize', prizeId: P1, winnerId: W1 }],
    });
  });

  it('не-организатор → PUBLISH_FORBIDDEN', () => {
    expectRejection(() => handleLotteryPublish(ctx({ actorRole: 'PARTICIPANT', drawPool: POOL }), 'draw.run', { drawId: D1, prizeId: P1 }), 'PUBLISH_FORBIDDEN');
  });

  it('повтор drawId → no-op с прежним результатом: re-emit draw.completed, БЕЗ эффекта (дизайн §4 п.2)', () => {
    const state = { draws: { [D1]: { prizeId: P1, winnerId: W2 } } };
    const result = handleLotteryPublish(ctx({ actorRole: 'ORGANIZER', drawPool: POOL, state }), 'draw.run', { drawId: D1, prizeId: P1 });
    expect(result).toEqual({
      commits: [{ shortName: 'draw.completed', payload: { drawId: D1, prizeId: P1, winnerId: W2 }, visibility: 'public', actor: 'server' }],
      effects: [],
    });
  });

  it('пустой пул → DRAW_POOL_EMPTY до коммита', () => {
    expectRejection(() => handleLotteryPublish(ctx({ actorRole: 'ORGANIZER', drawPool: [] }), 'draw.run', { drawId: D1, prizeId: P1 }), 'DRAW_POOL_EMPTY');
  });

  it('verified: гости вне пула — победитель всегда REGISTERED (REQ-RWD-014)', () => {
    const settings = { drawEligibility: 'verified' };
    const result = handleLotteryPublish(ctx({ actorRole: 'ORGANIZER', drawPool: POOL, settings }), 'draw.run', { drawId: D1, prizeId: P1 });
    expect(result.commits[1].payload.winnerId).toBe(W3); // единственный REGISTERED
  });

  it('прежний победитель этого приза исключён из пула (UX; индекс — страховка)', () => {
    const state = { draws: { [D0]: { prizeId: P1, winnerId: W1 } } };
    const result = handleLotteryPublish(ctx({ actorRole: 'ORGANIZER', drawPool: POOL, state }), 'draw.run', { drawId: D1, prizeId: P1 });
    expect(result.commits[1].payload.winnerId).toBe(W2); // W1 исключён, randomInt() = 0 → новый pool[0]
  });

  it('выбор идёт через ctx.randomInt — stub возвращает индекс', () => {
    const result = handleLotteryPublish(ctx({ actorRole: 'ORGANIZER', drawPool: POOL, randomInt: () => 2 }), 'draw.run', { drawId: D1, prizeId: P1 });
    expect(result.commits[1].payload.winnerId).toBe(W3);
  });

  it('неизвестная команда → EVENT_UNKNOWN_TYPE', () => {
    expectRejection(() => handleLotteryPublish(ctx({}), 'draw.unknown', {}), 'EVENT_UNKNOWN_TYPE');
  });
});
```

`lottery-manifest.contract.spec.ts` — по образцу quiz-manifest.contract.spec.ts: `appManifestSchema.safeParse`, Ajv2020-компиляция зарегистрированных схем, точный набор типов и их visibility/clientInitiated:

```typescript
const EXPECTED_EVENTS = {
  'draw.run': { visibility: 'public', clientInitiated: true },
  'draw.completed': { visibility: 'public', clientInitiated: false },
} as const;
// + manifest.capabilities === ['rewards']; appId 'lottery'; manifestVersion 1;
// + appSettings: drawEligibility public (readPropertyVisibility), дефолт guests_allowed;
// + payload-кейсы: draw.run принимает {drawId uuid, prizeId uuid}, отклоняет невалидный uuid/лишнее поле.
```

- [ ] **Step 3: Run — RED**

Run: `pnpm --filter @mymozhem/app-lottery test`
Expected: FAIL (пакет не существует). До прогона: `pnpm install` (новый workspace-пакет).

- [ ] **Step 4: Implement**

`package.json` (зеркало app-quiz):

```json
{
  "name": "@mymozhem/app-lottery",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc -p tsconfig.json", "test": "jest" },
  "dependencies": { "@mymozhem/sdk": "workspace:*", "zod": "^4.0.0" },
  "devDependencies": {
    "ajv": "^8.20.0",
    "@types/jest": "^29.5.14",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "typescript": "^5.7.0"
  }
}
```

(Точные версии devDeps — скопировать из `packages/app-quiz/package.json`.) `tsconfig.json` и `jest.config.js` — дословные копии app-quiz.

`src/lottery-settings.ts`:

```typescript
import { z } from 'zod';

// Атрибут розыгрыша (REQ-RWD-014): дефолт guests_allowed; verified = вес только
// у REGISTERED. Замораживается при ACTIVE (REQ-RT-004); изменение —
// переконфигурация в DRAFT (design §0.8).
export const lotterySettingsSchema = z.strictObject({
  drawEligibility: z
    .enum(['guests_allowed', 'verified'])
    .default('guests_allowed')
    .meta({ 'x-visibility': 'public' }),
});
export type LotterySettings = z.infer<typeof lotterySettingsSchema>;
```

`src/lottery-events.ts`:

```typescript
import { z } from 'zod';

// Wire-имена — dotted-lowercase (shortEventNameSchema, erratum нейминга ф.2).
export const drawRunPayload = z.strictObject({
  drawId: z.uuid(), // клиентский uuid — идемпотентность команды розыгрыша
  prizeId: z.uuid(),
});
export const drawCompletedPayload = z.strictObject({
  drawId: z.uuid(),
  prizeId: z.uuid(),
  winnerId: z.uuid(), // только id (REQ-SEC-009); имя — из membership-проекции
});
```

`src/lottery-manifest.ts`:

```typescript
import { defineApp, type AppManifest } from '@mymozhem/sdk';
import { lotterySettingsSchema } from './lottery-settings';
import { drawCompletedPayload, drawRunPayload } from './lottery-events';

export const LOTTERY_APP_ID = 'lottery';
export const LOTTERY_MANIFEST_VERSION = 1;

export function buildLotteryManifest(): AppManifest {
  return defineApp({
    appId: LOTTERY_APP_ID,
    manifestVersion: LOTTERY_MANIFEST_VERSION,
    capabilities: ['rewards'], // REQ-RWD-001/005: делегирование фонда/выбора — capability
    appSettings: lotterySettingsSchema,
    events: {
      'draw.run': { schema: drawRunPayload, visibility: 'public', clientInitiated: true },
      'draw.completed': { schema: drawCompletedPayload, visibility: 'public', clientInitiated: false },
    },
  });
}
```

`src/lottery-state.ts`:

```typescript
import type { AppLogEvent } from '@mymozhem/sdk';
import type { z } from 'zod';
import type { drawCompletedPayload } from './lottery-events';

// Проекция лотереи (REQ-CORE-004): список розыгрышей из лога; своих таблиц нет —
// состояние наград в rewards, история в логе. Использованные drawId хранятся
// здесь — идемпотентность команды (design §4).
export interface LotteryState {
  readonly draws: Readonly<Record<string, { readonly prizeId: string; readonly winnerId: string }>>;
}

export function initialLotteryState(): LotteryState {
  return { draws: {} };
}

export function reduceLottery(state: LotteryState, event: AppLogEvent): LotteryState {
  if (event.shortName !== 'draw.completed') return state;
  const p = event.payload as z.infer<typeof drawCompletedPayload>;
  if (state.draws[p.drawId]) return state; // повтор (replay/live дубль) — no-op
  return { draws: { ...state.draws, [p.drawId]: { prizeId: p.prizeId, winnerId: p.winnerId } } };
}
```

`src/lottery-handlers.ts`:

```typescript
import {
  AppRejection,
  type AppHostContext,
  type AppPublishResult,
} from '@mymozhem/sdk';
import type { z } from 'zod';
import { drawRunPayload } from './lottery-events';
import { lotterySettingsSchema } from './lottery-settings';
import type { LotteryState } from './lottery-state';

// actorId — только из ctx, никогда из payload (REQ-RT-009). Случайность — только
// ctx.randomInt (CSPRNG хоста, REQ-RWD-011); Math.random в packages/app-*
// запрещён lint-правилом (Task 11).
export function handleLotteryPublish(
  ctx: AppHostContext<LotteryState>,
  shortName: string,
  payload: Record<string, unknown>,
): AppPublishResult {
  if (shortName !== 'draw.run') {
    throw new AppRejection('EVENT_UNKNOWN_TYPE', `unknown lottery command: ${shortName}`);
  }
  if (ctx.actorRole !== 'ORGANIZER') {
    throw new AppRejection('PUBLISH_FORBIDDEN', 'only the organizer runs a draw');
  }
  const command: z.infer<typeof drawRunPayload> = drawRunPayload.parse(payload);

  // Идемпотентность (design §4): повтор drawId — no-op с прежним результатом;
  // re-emit draw.completed самолечит клиента, пропустившего кадр (редьюсер
  // дедуплицирует по drawId). Без эффекта — приз не списывается вторично.
  const existing = ctx.state.draws[command.drawId];
  if (existing) {
    return {
      commits: [{
        shortName: 'draw.completed',
        payload: { drawId: command.drawId, prizeId: existing.prizeId, winnerId: existing.winnerId },
        visibility: 'public',
        actor: 'server',
      }],
      effects: [],
    };
  }

  const settings = lotterySettingsSchema.parse(ctx.settings);
  // Пул — снапшот от диспетчера (ctx.drawPool). verified: отсекаем GUEST (REQ-RWD-014).
  let pool = settings.drawEligibility === 'verified'
    ? ctx.drawPool.filter((e) => e.kind !== 'GUEST')
    : [...ctx.drawPool];
  // Прежние победители этого приза вне пула (UX; частичный индекс — страховка).
  const previousWinners = new Set(
    Object.values(ctx.state.draws)
      .filter((d) => d.prizeId === command.prizeId)
      .map((d) => d.winnerId),
  );
  pool = pool.filter((e) => !previousWinners.has(e.identityId));
  if (pool.length === 0) {
    throw new AppRejection('DRAW_POOL_EMPTY', 'draw pool is empty');
  }
  const winnerId = pool[ctx.randomInt(pool.length)].identityId;
  return {
    commits: [
      { shortName: 'draw.run', payload: command, visibility: 'public', actor: 'publisher' },
      {
        shortName: 'draw.completed',
        payload: { drawId: command.drawId, prizeId: command.prizeId, winnerId },
        visibility: 'public',
        actor: 'server',
      },
    ],
    effects: [{ kind: 'award.prize', prizeId: command.prizeId, winnerId }],
  };
}
```

`src/lottery-runtime.ts`:

```typescript
import type { AppManifest, AppRuntimeModule } from '@mymozhem/sdk';
import { buildLotteryManifest, LOTTERY_APP_ID, LOTTERY_MANIFEST_VERSION } from './lottery-manifest';
import { handleLotteryPublish } from './lottery-handlers';
import { initialLotteryState, reduceLottery, type LotteryState } from './lottery-state';

export function createLotteryRuntime(): AppRuntimeModule<LotteryState> {
  return {
    appId: LOTTERY_APP_ID,
    manifestVersion: LOTTERY_MANIFEST_VERSION,
    manifest: buildLotteryManifest(),
    initialState: initialLotteryState,
    reduce: reduceLottery,
    handlePublish: handleLotteryPublish,
  };
}

export function createLotteryApp(): { manifest: AppManifest; runtime: AppRuntimeModule<LotteryState> } {
  const manifest = buildLotteryManifest();
  return { manifest, runtime: createLotteryRuntime() };
}
```

`src/index.ts`: `export * from` по всем шести модулям (settings, events, manifest, state, handlers, runtime).

- [ ] **Step 5: Run — GREEN**

Run: `pnpm install && pnpm --filter @mymozhem/sdk build && pnpm --filter @mymozhem/app-lottery test && pnpm --filter @mymozhem/app-lottery build`
Expected: PASS. Проверить boundary: `pnpm boundary-check` — `app-lottery` под правилом `app-only-through-sdk` автоматически (префикс `packages/app-`).

- [ ] **Step 6: Commit**

```bash
git add packages/app-lottery pnpm-lock.yaml
git commit -m "feat(app-lottery): модуль лотереи — draw.run/draw.completed, eligibility, идемпотентность drawId

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

**Конец Batch C.** Зелёный конвейер батча: `pnpm build && pnpm lint && pnpm boundary-check && pnpm guardrails && pnpm test && pnpm test:int`. Дальше — новой сессией.

---
### Task 10: app-quiz → manifestVersion 2 + эффекты начислений

**Files:**
- Modify: `packages/app-quiz/src/quiz-manifest.ts` (version 2, capabilities)
- Modify: `packages/app-quiz/src/quiz-handlers.ts` (возврат AppPublishResult; эффекты в closeQuestion)
- Test: `packages/app-quiz/src/quiz-manifest.contract.spec.ts` (version/capabilities), `packages/app-quiz/src/quiz-handlers.spec.ts` (форма возврата + эффекты)

**Interfaces:**
- Consumes: `AppPublishResult`, capability 'rewards' (Tasks 2-3); скоринг `Math.max(base − k·step, 0)` — существующий (quiz-handlers.ts:97-103).
- Produces: `QUIZ_MANIFEST_VERSION = 2`; `question.closed` несёт эффекты `{ kind: 'award.points', identityId, points, reason: 'quiz.round' }` на каждого ответившего с points > 0 — исполняет диспетчер (Task 7) в той же транзакции, что reveal-событие. Потребитель-связка: Task 11; приёмка: Task 13.

**REQ:** REQ-RWD-002a/b (начисления без приза), REQ-RT-004 (пин (appId, manifestVersion) — миграция контента не нужна, активных квиз-комнат нет), REQ-RWD-001 (capability).

- [ ] **Step 1: Failing tests**

`quiz-manifest.contract.spec.ts`: ожидания `QUIZ_MANIFEST_VERSION` → 2 и `manifest.capabilities` → `['rewards']` (поправить существующие ассерты/EXPECTED).

`quiz-handlers.spec.ts`:
1. Все существующие ожидания формы «массив коммитов» перевести на `{ commits, effects: [] }` (wrap ожиданий; closeQuestion/finishGame/submitAnswer).
2. Новый кейс в describe closeQuestion:

```typescript
    it('начисления: эффект award.points на каждого ответившего с points > 0, reason quiz.round', () => {
      // openState с двумя правильными ответами (P2 быстрее P1) и одним неверным;
      // scoring { base: 1000, step: 100 } → awarded P2=1000, P1=900.
      const result = handleQuizPublish(ctx({ state: openState(0, /* ответы */) }), 'question.closed', { questionIndex: 0 });
      expect(result.effects).toEqual([
        { kind: 'award.points', identityId: P2, points: 1000, reason: 'quiz.round' },
        { kind: 'award.points', identityId: P1, points: 900, reason: 'quiz.round' },
      ]);
      // Неверный ответ эффекта не даёт; reveal-коммит не изменился (awarded/totals как прежде).
      expect(result.commits.map((c) => c.shortName)).toEqual(['question.closed', 'question.revealed']);
    });

    it('clamp-ветка скоринга (points = 0) эффекта не порождает', () => {
      // scoring { base: 100, step: 100 }, три правильных ответа: 100, 0, 0 →
      // эффект только на первого (points > 0).
      // (Закрывает deferred-minor ф.2: clamp-ветка без отдельного теста.)
    });
```

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/app-quiz test`
Expected: FAIL (version/capabilities; форма возврата).

- [ ] **Step 3: Implement**

`quiz-manifest.ts`:

```typescript
export const QUIZ_MANIFEST_VERSION = 2;
// ...
  return defineApp({
    appId: QUIZ_APP_ID,
    manifestVersion: QUIZ_MANIFEST_VERSION,
    capabilities: ['rewards'], // фаза 3: начисления баллов эффектами (design 2026-09-10 §5)
    appSettings: quizSettingsSchema,
    events: { /* без изменений */ },
  });
```

`quiz-handlers.ts` (импорты += `type AppEffect`, `type AppPublishResult` из `@mymozhem/sdk`):
1. Сигнатура `handleQuizPublish(...): AppPublishResult`; каждая команда возвращает `{ commits: [...прежний массив...], effects: [] }`, кроме closeQuestion.
2. closeQuestion — эффекты из awarded (существующий расчёт скоринга не трогаем):

```typescript
  // Начисления rewards (design §5): reveal-событие и ledger-записи коммитятся
  // одной транзакцией с эффектами. Табло остаётся проекцией квиза; ledger —
  // платформенная запись. Дублирование осознанное; инвариант «менять вместе»:
  // изменение скоринга трогает обе записи; сходимость — e2e Task 13.
  const effects: AppEffect[] = awarded
    .filter((a) => a.points > 0) // clamp-ветка шкалы не порождает нулевых грантов
    .map((a) => ({ kind: 'award.points', identityId: a.actorId, points: a.points, reason: 'quiz.round' }));
  return {
    commits: [ /* прежняя пара question.closed + question.revealed */ ],
    effects,
  };
```

Идемпотентность: повторный `question.closed` гасится существующим гейтом «раунд уже закрыт» (ROUND_NOT_OPEN) до эффектов — новой логики не надо; `game.finished` эффектов не несёт (решение §0.8).

- [ ] **Step 4: Run — GREEN + e2e-регрессия квиза**

Run: `pnpm --filter @mymozhem/app-quiz test && pnpm build && pnpm --filter @mymozhem/server test -- quiz.e2e`
Expected: PASS. Внимание: quiz.e2e конфигурирует комнату через `QUIZ_MANIFEST_VERSION` — константа подхватит 2 автоматически; но **пока Task 11 не подключил rewards-исполнитель, e2e квиза с эффектами упадёт на CAPABILITY_UNAVAILABLE**. Поэтому порядок: Task 10 коммитит модуль, а quiz.e2e прогоняется после Task 11 (в его же батче). До Task 11 проверка — unit-тесты пакета. Если quiz.e2e в CI-прогоне батча D падает до Task 11 — это ожидаемое промежуточное состояние, НЕ мерджить батч на нём; задачи 10-11 атомарны для зелёного main.

- [ ] **Step 5: Commit**

```bash
git add packages/app-quiz
git commit -m "feat(app-quiz): manifestVersion 2 — capability rewards, начисления эффектами при question.closed

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 11: Composition root + boundary-правило rewards + lint Math.random + guardrails

**Files:**
- Modify: `packages/core/src/rewards/rewards.module.ts` (@Global, AWARD_EFFECT_HANDLER провайдер)
- Modify: `apps/server/src/app.module.ts` (регистрация rewards/lottery/quiz@2, расписание)
- Create: `apps/server/src/anonymization-guards.module.ts`
- Modify: `apps/server/package.json` (deps: `@mymozhem/app-lottery`, `@nestjs/schedule`)
- Modify: `.dependency-cruiser.cjs` (правило rewards)
- Modify: `scripts/verify-guardrails.mjs` (probe нового правила + probe eslint-правила)
- Modify: `eslint.config.js` (запрет Math.random в packages/app-*)
- Test: прогон существующих e2e (boot AppModule — валидация DI-связки)

**Interfaces:**
- Consumes: всё предыдущее. `createQuizApp()`/`createLotteryApp()`, `RewardsModule`, `IdentitySweepModule`, `ANONYMIZATION_GUARDS`, `RewardsAnonymizationGuard`, `AWARD_EFFECT_HANDLER`.
- Produces: работающая сборка всей фазы; машинное принуждение REQ-RWD-001 (boundary) и REQ-RWD-011 (lint).

**REQ:** REQ-RWD-001 (boundary + DI-токены), REQ-RWD-011 (lint-запрет — решение владельца 2026-09-10), REQ-DEV-001 (границы принуждаются машиной), REQ-RT-004 (реестр по пинам).

- [ ] **Step 1: Failing guardrail — boundary-правило rewards**

`scripts/verify-guardrails.mjs`: добавить probe по существующему паттерну («writeFileSync probe-файла + expectFailure(depcruise …)» + cleanup): probe `packages/core/src/room/__probe-rewards-boundary.ts` с `import '@mymozhem/core/src/rewards/rewards.module'` — ожидается отказ depcruise. (Точную форму expectFailure скопировать из соседнего probe `app-only-through-sdk` в том же файле.)

Run: `pnpm guardrails` → FAIL (правила ещё нет — probe проходит насквозь).

- [ ] **Step 2: Failing guardrail — eslint Math.random**

В `verify-guardrails.mjs` второй probe: записать `packages/app-quiz/src/__probe-math-random.ts` с `export const x = Math.random();`, запустить `eslint` на него, ожидать error; cleanup. Run: `pnpm guardrails` → FAIL.

(Если verify-guardrails сегодня знает только depcruise — добавить запуск eslint тем же expectFailure-хелпером с командой `pnpm exec eslint <file>`; форму зафиксировать в леджере.)

- [ ] **Step 3: Implement — правила**

`.dependency-cruiser.cjs`, в `forbidden` (форма — по прецеденту `socketio-only-in-realtime`):

```javascript
  {
    name: 'rewards-only-through-di-tokens',
    comment:
      'Ядро не зависит от rewards (REQ-RWD-001): связка — DI-токены AWARD_EFFECT_HANDLER ' +
      '(app-runtime/effects) и ANONYMIZATION_GUARDS (identity); единственные точки, ' +
      'импортирующие core/rewards, — barrel index.ts и сам модуль rewards.',
    severity: 'error',
    from: {
      path: '^packages/core/src',
      pathNot: ['^packages/core/src/rewards', '^packages/core/src/index\\.ts$'],
    },
    to: { path: '^packages/core/src/rewards' },
  },
```

`eslint.config.js`, добавить блок в конфиг:

```javascript
  {
    // REQ-RWD-011 (решение владельца 2026-09-10): случайность app-модулей —
    // только ctx.randomInt (CSPRNG хоста); Math.random отсекается машиной.
    files: ['packages/app-*/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'Случайность app-модулей — только ctx.randomInt (CSPRNG хоста, REQ-RWD-011).',
        },
      ],
    },
  },
```

Run: `pnpm guardrails && pnpm lint && pnpm boundary-check` → GREEN (probe отказываются насквозь-проходить; реальных нарушений нет — лотерея/квиз Math.random не используют).

- [ ] **Step 4: Implement — RewardsModule @Global + handler**

`rewards.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { AWARD_EFFECT_HANDLER } from '../app-runtime/effects';
// ... прочие импорты как были

// @Global: AppRuntimeService (AppRuntimeModule, global) опционально инжектирует
// AWARD_EFFECT_HANDLER; identity-свип — ANONYMIZATION_GUARDS из composition root
// (apps/server/src/anonymization-guards.module.ts). Ядро rewards не импортирует
// (boundary rewards-only-through-di-tokens).
@Global()
@Module({
  imports: [PrismaModule, MembershipModule, RealtimeModule, AuthModule],
  controllers: [RewardsController],
  providers: [
    RewardsService,
    RewardsAnonymizationGuard,
    { provide: AWARD_EFFECT_HANDLER, useExisting: RewardsService },
  ],
  exports: [RewardsService, RewardsAnonymizationGuard, AWARD_EFFECT_HANDLER],
})
export class RewardsModule {}
```

Примечание: `RewardsService` при этом должен удовлетворять `AwardEffectHandler` — сигнатура `executeEffects(tx, roomId, sourceAppId, effects)` уже совместима (Task 5); добавить `implements AwardEffectHandler` в объявление класса (импорт типа из `../app-runtime/effects` — разрешённое направление: rewards → app-runtime/effects).

- [ ] **Step 5: Implement — composition root**

`apps/server/src/anonymization-guards.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { ANONYMIZATION_GUARDS, RewardsAnonymizationGuard, RewardsModule } from '@mymozhem/core';

// Связка identity ↔ rewards по DI-токену (REQ-RWD-001): identity объявляет токен,
// rewards даёт guard; друг без друга модули не знают. Без RewardsModule массив
// гардов пуст — приостановки TTL нет, свип работает (design §5).
@Global()
@Module({
  imports: [RewardsModule],
  providers: [
    {
      provide: ANONYMIZATION_GUARDS,
      useFactory: (guard: RewardsAnonymizationGuard) => [guard],
      inject: [RewardsAnonymizationGuard],
    },
  ],
  exports: [ANONYMIZATION_GUARDS],
})
export class AnonymizationGuardsModule {}
```

`apps/server/src/app.module.ts` — целиком:

```typescript
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { createQuizApp } from '@mymozhem/app-quiz';
import { createLotteryApp } from '@mymozhem/app-lottery';
import {
  AppRegistryModule,
  AppRuntimeModule,
  HealthModule,
  IdentityModule,
  IdentitySweepModule,
  MembershipModule,
  PrismaModule,
  RealtimeModule,
  RewardsModule,
  RoomModule,
  TransportModule,
} from '@mymozhem/core';
import { AnonymizationGuardsModule } from './anonymization-guards.module';

const quiz = createQuizApp();
const lottery = createLotteryApp();

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    ScheduleModule.forRoot(), // REQ-ID-010: регламентные джобы; одна реплика (REQ-OPS-005)
    AppRegistryModule.register([quiz.manifest, lottery.manifest]),
    AppRuntimeModule.register([quiz.runtime, lottery.runtime]),
    RoomModule,
    IdentityModule,
    MembershipModule,
    RealtimeModule,
    TransportModule,
    RewardsModule, // global: AWARD_EFFECT_HANDLER для app-runtime (REQ-RWD-001)
    IdentitySweepModule, // TTL-свип гостей (REQ-ID-003/014) с приостановкой (REQ-RWD-013)
    AnonymizationGuardsModule,
  ],
})
export class AppModule {}
```

`apps/server/package.json` deps += `"@mymozhem/app-lottery": "workspace:*"`, `"@nestjs/schedule": "<та же линейка, что в core>"`; `pnpm install`.

- [ ] **Step 6: Run — GREEN (boot-валидация DI через существующие e2e)**

Run: `pnpm install && pnpm build && pnpm lint && pnpm boundary-check && pnpm guardrails && pnpm test && pnpm test:int`
Expected: PASS. Ключевой сигнал: `apps/server` e2e (quiz.e2e и др.) boot'ят настоящий AppModule — DI-связка (ScheduleModule → SchedulerRegistry → GuestSweepScheduler; RewardsModule → AWARD_EFFECT_HANDLER → AppRuntimeService; AnonymizationGuardsModule → ANONYMIZATION_GUARDS → GuestSweepService) валидируется контейнером. Quiz.e2e после Task 10 проходит на manifestVersion 2 с effects-исполнителем.

- [ ] **Step 7: Commit**

```bash
git add apps/server packages/core/src/rewards .dependency-cruiser.cjs eslint.config.js scripts/verify-guardrails.mjs pnpm-lock.yaml
git commit -m "feat(server,core): composition root фазы 3 — RewardsModule, лотерея+квиз@2, свип; boundary rewards-only-through-di-tokens; lint Math.random

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 12: e2e лотереи (приёмка механики на проводе)

**Files:**
- Test: `apps/server/test/lottery.e2e-spec.ts` (новый)

**Interfaces:**
- Consumes: хелперы quiz.e2e-spec.ts (`createApp`, `portOf`, `connect`, `emitAck`, `waitEventWhere`, `readRoomLog`, `joinGuest` — копируются локально, спек standalone); `organizerToken` по прецеденту transport.e2e-spec.ts:362-367 (`tokens.issueGuestTokens(ORG, room.id)`); REST-эндпоинты Task 6; `RoomService.create/configure/activate`.
- Produces: приёмка design §7 п.1, 2 (e2e-часть K>quantity), 4, 6.

**REQ:** REQ-RWD-003/004/007/009/010/011/014, REQ-SEC-009, REQ-RT-004.

- [ ] **Step 1: Написать e2e-спек целиком (код ниже), запустить — прогнать до зелёного**

Бутстрап — зеркало quiz.e2e (без override'ов: composition root уже регистрирует lottery; `jest.setTimeout(180_000)`; `afterEach` — TRUNCATE + `rewards."Award", rewards."Prize"` в список таблиц). Хелперы:

```typescript
const LOTTERY_SETTINGS: LotterySettings = { drawEligibility: 'guests_allowed' };

async function activeLotteryRoom(settings: LotterySettings = LOTTERY_SETTINGS) {
  const room = await roomService.create(ORG);
  await roomService.configure(room.id, {
    appId: LOTTERY_APP_ID,
    manifestVersion: LOTTERY_MANIFEST_VERSION,
    settings,
  });
  await roomService.activate(room.id, ORG);
  return room;
}

// REST с Bearer организатора (guest-claims, роль из membership — прецедент transport.e2e).
async function createPrize(roomId: string, name: string, quantity: number) {
  const token = (await tokens.issueGuestTokens(ORG, roomId)).accessToken;
  const res = await app.inject({
    method: 'POST', url: `/rooms/${roomId}/prizes`,
    headers: { authorization: `Bearer ${token}` },
    payload: { name, quantity },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string };
}

async function fulfillAward(roomId: string, awardId: string) {
  const token = (await tokens.issueGuestTokens(ORG, roomId)).accessToken;
  return app.inject({ method: 'POST', url: `/rooms/${roomId}/awards/${awardId}/fulfill`, headers: { authorization: `Bearer ${token}` } });
}
async function revokeAward(roomId: string, awardId: string) {
  const token = (await tokens.issueGuestTokens(ORG, roomId)).accessToken;
  return app.inject({ method: 'POST', url: `/rooms/${roomId}/awards/${awardId}/revoke`, headers: { authorization: `Bearer ${token}` } });
}

// publish draw.run от организатора по сокету (тип lottery.draw.run — clientInitiated).
async function organizerSocket(roomId: string) {
  const token = (await tokens.issueGuestTokens(ORG, roomId)).accessToken;
  const socket = await connect(port, token);
  await emitAck(socket, REALTIME_MESSAGES.SUBSCRIBE, { roomId });
  return socket;
}
```

(Точное имя subscribe-сообщения и форму ack — из quiz.e2e/realtime.e2e; REALTIME_MESSAGES из SDK.)

Сценарии:

```typescript
it('полный цикл: гости входят → приз → draw.run → draw.completed из пула → AWARDED → fulfill; события публичны live и в replay', async () => {
  const room = await activeLotteryRoom();
  const g1 = await joinGuest(room.code, 'Гость-1');
  const g2 = await joinGuest(room.code, 'Гость-2');
  const prize = await createPrize(room.id, 'Главный приз', 1);

  const orgSocket = await organizerSocket(room.id);
  // Waiters ДО publish (fan-out синхронен с коммитом — опыт Quiz-среза).
  const guestFrame = waitEventWhere(g1.socket, 'lottery.draw.completed');
  const rewardFrame = waitEventWhere(g2.socket, 'rewards.reward.awarded');

  const drawId = crypto.randomUUID();
  const ack = await emitAck<PublishAck>(orgSocket, REALTIME_MESSAGES.PUBLISH, {
    roomId: room.id, type: 'lottery.draw.run', payload: { drawId, prizeId: prize.id },
  });
  expect(ack).toEqual({ ok: true });

  const completed = await guestFrame;
  const winnerId = (completed.payload as { winnerId: string }).winnerId;
  expect([g1.identityId, g2.identityId]).toContain(winnerId); // победитель из пула
  expect(completed.payload).toMatchObject({ drawId, prizeId: prize.id });
  expect(completed.payload).not.toHaveProperty('displayName'); // REQ-SEC-009
  expect(((await rewardFrame).payload as { winnerId: string }).winnerId).toBe(winnerId);

  // Состояние в БД: награда AWARDED, фонд списан ровно на 1.
  const award = await db.prisma.award.findFirstOrThrow({ where: { roomId: room.id } });
  expect(award).toMatchObject({ prizeId: prize.id, winnerId, status: 'AWARDED', sourceAppId: 'lottery' });
  expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(0);

  // Replay: переподключённый гость видит оба события в snapshot.
  const again = await joinGuest(room.code, 'Гость-1-снова');
  const sub = await emitAck<SubscribeAck>(again.socket, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });
  const types = sub.snapshot.events.map((e) => e.type);
  expect(types).toContain('lottery.draw.completed');
  expect(types).toContain('rewards.reward.awarded');

  // Вручение очное (REQ-RWD-004): REST fulfill → 200 + публичное rewards.reward.fulfilled.
  const fulfillFrame = waitEventWhere(g1.socket, 'rewards.reward.fulfilled');
  const res = await fulfillAward(room.id, award.id);
  expect(res.statusCode).toBe(200);
  await fulfillFrame;
  expect((await db.prisma.award.findUniqueOrThrow({ where: { id: award.id } })).status).toBe('FULFILLED');
});

it('повтор draw.run с тем же drawId — no-op: второй розыгрыш не состоялся, фонд не списан (REQ-RWD-003 на уровне app-команды)', async () => {
  const room = await activeLotteryRoom();
  await joinGuest(room.code, 'Гость');
  const prize = await createPrize(room.id, 'Приз', 2);
  const orgSocket = await organizerSocket(room.id);
  const drawId = crypto.randomUUID();
  const cmd = { roomId: room.id, type: 'lottery.draw.run', payload: { drawId, prizeId: prize.id } };
  await emitAck(orgSocket, REALTIME_MESSAGES.PUBLISH, cmd);
  const again = await emitAck<PublishAck>(orgSocket, REALTIME_MESSAGES.PUBLISH, cmd);
  expect(again).toEqual({ ok: true }); // typed no-op, не отказ
  expect(await db.prisma.award.count({ where: { roomId: room.id } })).toBe(1);
  expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(1);
  // Re-emit прежнего результата: в логе два draw.completed с одним drawId/winnerId.
  const log = await readRoomLog(db.prisma, room.id);
  const completions = log.filter((e) => e.type === 'lottery.draw.completed');
  expect(completions).toHaveLength(2);
  expect(completions[0].payload).toEqual(completions[1].payload);
});

it('K > quantity конкурентных draw.run → ровно quantity победителей, без минуса (REQ-RWD-010, e2e-версия)', async () => {
  const room = await activeLotteryRoom();
  await joinGuest(room.code, 'Гость-1');
  await joinGuest(room.code, 'Гость-2');
  await joinGuest(room.code, 'Гость-3');
  const prize = await createPrize(room.id, 'Приз', 1);
  const orgSocket = await organizerSocket(room.id);
  const acks = await Promise.all([
    emitAck<PublishAck>(orgSocket, REALTIME_MESSAGES.PUBLISH, { roomId: room.id, type: 'lottery.draw.run', payload: { drawId: crypto.randomUUID(), prizeId: prize.id } }),
    emitAck<PublishAck>(orgSocket, REALTIME_MESSAGES.PUBLISH, { roomId: room.id, type: 'lottery.draw.run', payload: { drawId: crypto.randomUUID(), prizeId: prize.id } }),
  ]);
  // RoomSerializer сериализует однокомнатные команды: второй draw видит пул без
  // первого победителя, но фонд уже пуст → PRIZE_FUND_EXHAUSTED.
  const oks = acks.filter((a) => 'ok' in a);
  const rejects = acks.filter((a) => 'code' in a);
  expect(oks).toHaveLength(1);
  expect(rejects).toEqual([{ code: 'PRIZE_FUND_EXHAUSTED' }]);
  expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(0);
});

it('eligibility verified: победитель всегда REGISTERED (REQ-RWD-014); гость при дефолте guests_allowed может выиграть (контроль)', async () => {
  // Комната verified: 2 гостя + 1 REGISTERED-партисипант (seedIdentity REGISTERED
  // + HTTP /rooms/join registered-токеном — по образцу joinGuest, токен от
  // issueRegisteredTokens). 10 розыгрышей с quantity 10 → все winnerId === registered.id.
  // Контрольная комната guests_allowed (уже покрыта первым сценарием: гость выигрывает).
});

it('revoke возвращает quantity и освобождает место: приз переразыгрывается тому же победителю (REQ-RWD-007/003)', async () => {
  // draw → revoke (REST) → quantity 1 → повторный draw другим drawId → новый AWARDED.
});

it('REQ-RWD-009: при COMPLETED организатор видит оставшиеся AWARDED и вручает/отзывает их по REST', async () => {
  const room = await activeLotteryRoom();
  await joinGuest(room.code, 'Гость');
  const prize = await createPrize(room.id, 'Приз', 1);
  const orgSocket = await organizerSocket(room.id);
  await emitAck(orgSocket, REALTIME_MESSAGES.PUBLISH, { roomId: room.id, type: 'lottery.draw.run', payload: { drawId: crypto.randomUUID(), prizeId: prize.id } });
  await roomService.transition(room.id, 'COMPLETED', ORG); // точную сигнатуру сверить с RoomService
  const token = (await tokens.issueGuestTokens(ORG, room.id)).accessToken;
  const list = await app.inject({ method: 'GET', url: `/rooms/${room.id}/rewards`, headers: { authorization: `Bearer ${token}` } });
  expect(list.statusCode).toBe(200);
  expect(list.json().awards).toHaveLength(1);
  expect(list.json().awards[0].status).toBe('AWARDED');
  const fulfill = await fulfillAward(room.id, list.json().awards[0].id);
  expect(fulfill.statusCode).toBe(200); // вручение после завершения работает
});

it('заниженная visibility draw.* отклоняется commit-гейтом (REQ-CTR-009) — контроль на уровне модуля невозможен клиентом: clientInitiated=false у draw.completed', async () => {
  const room = await activeLotteryRoom();
  const g = await joinGuest(room.code, 'Гость');
  const ack = await emitAck<PublishAck>(g.socket, REALTIME_MESSAGES.PUBLISH, {
    roomId: room.id, type: 'lottery.draw.completed', payload: { drawId: crypto.randomUUID(), prizeId: crypto.randomUUID(), winnerId: g.identityId },
  });
  expect(ack).toEqual({ code: 'PUBLISH_FORBIDDEN' }); // server-only тип: гейт диспетчера
  // и участник не организатор для draw.run:
  const ack2 = await emitAck<PublishAck>(g.socket, REALTIME_MESSAGES.PUBLISH, {
    roomId: room.id, type: 'lottery.draw.run', payload: { drawId: crypto.randomUUID(), prizeId: crypto.randomUUID() },
  });
  expect(ack2).toEqual({ code: 'PUBLISH_FORBIDDEN' });
});
```

- [ ] **Step 2: Run — до зелёного**

Run: `pnpm build && pnpm --filter @mymozhem/server test -- lottery.e2e`
Expected: PASS всех сценариев. Ловушки (HANDOFF): waiters до publish; уникальное имя файла в фильтре (`lottery.e2e`, не `lottery`); raw-лог lowercase visibility. Флейки не гасить ретраями — разобрать (прецедент: e2e на проводе ловит то, что unit не видит).

- [ ] **Step 3: Commit**

```bash
git add apps/server/test/lottery.e2e-spec.ts
git commit -m "test(server): e2e лотереи — полный цикл розыгрыша, идемпотентность, K>quantity, eligibility, REQ-RWD-009

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

**Конец Batch D.** Зелёный конвейер батча: `pnpm build && pnpm lint && pnpm boundary-check && pnpm guardrails && pnpm test && pnpm test:int`. Дальше — новой сессией.

---

### Task 13: e2e квиз-начисления + сверка критериев выхода фазы 3

**Files:**
- Test: `apps/server/test/quiz-points.e2e-spec.ts` (новый; НЕ править quiz.e2e — он остаётся приёмкой ф.2 на manifestVersion 2)
- Modify: `HANDOFF.md` (состояние фазы 3) — в конце батча E

**Interfaces:**
- Consumes: хелперы quiz.e2e (копия), `db.prisma.pointsGrant`, `runtime: AppRuntimeService` (проекция табло — через replay лога, как в quiz.e2e).
- Produces: приёмка design §7 п.8 + итоговая сверка §7 целиком.

**REQ:** REQ-RWD-002b (начисления без приза), сходимость «табло квиза ≡ ledger rewards» (design §5), REQ-SEC-009.

- [ ] **Step 1: Написать e2e-спек, прогнать до зелёного**

`quiz-points.e2e-spec.ts` (бутстрап — зеркало quiz.e2e):

```typescript
it('после reveal ledger-записи появляются и сходятся с табло; повторный закрытый раунд не дублирует начисления', async () => {
  // Комната квиза (QUIZ_SETTINGS — 2 вопроса, scoring { base: 1000, step: 100 }),
  // два гостя отвечают на вопрос 0 правильно (P2 быстрее P1: 1000 и 900),
  // вопрос 1 — только P1 (1000). question.closed на каждый раунд от организатора.
  const room = await activeQuizRoom(QUIZ_SETTINGS);
  // ... сценарий ответов по образцу quiz.e2e (waiters до publish) ...

  const grants = await db.prisma.pointsGrant.findMany({ where: { roomId: room.id }, orderBy: { createdAt: 'asc' } });
  expect(grants).toHaveLength(3);
  expect(grants.every((g) => g.reason === 'quiz.round' && g.sourceAppId === 'quiz')).toBe(true);

  // Сходимость: суммы ledger ≡ суммы awarded из reveal-событий (табло строится из них).
  const log = await readRoomLog(db.prisma, room.id);
  const awarded = log
    .filter((e) => e.type === 'quiz.question.revealed')
    .flatMap((e) => (e.payload as { awarded: { actorId: string; points: number }[] }).awarded);
  const sumBy = (rows: { id: string; points: number }[]) =>
    rows.reduce((m, r) => m.set(r.id, (m.get(r.id) ?? 0) + r.points), new Map<string, number>());
  const ledgerTotals = new Map<string, number>();
  for (const g of grants) ledgerTotals.set(g.identityId, (ledgerTotals.get(g.identityId) ?? 0) + g.points);
  const boardTotals = sumBy(awarded.map((a) => ({ id: a.actorId, points: a.points })));
  expect(Object.fromEntries(ledgerTotals)).toEqual(Object.fromEntries(boardTotals));
  expect(ledgerTotals.get(p1.identityId)).toBe(1900);
  expect(ledgerTotals.get(p2.identityId)).toBe(1000);

  // Идемпотентность: повторный question.closed того же раунда → ROUND_NOT_OPEN, грантов не добавилось.
  // (ack с кодом; grants.length остаётся 3.)

  // PII: payload'ы reveal и rewards-событий не несут имён (REQ-SEC-009) — awarded несут actorId.
  for (const e of log) {
    expect(JSON.stringify(e.payload)).not.toContain('Гость');
  }
});

it('квиз v1-пин не исполняет эффекты: комната quiz@1 получает MODULE_UNAVAILABLE на publish (нет модуля под пин — пин работает, REQ-RT-004)', async () => {
  // configure с manifestVersion: 1 + activate → publish question.opened →
  // ack { code: 'MODULE_UNAVAILABLE' } (в реестре только quiz@2).
  // Фиксирует: старая версия манифеста не получает новое поведение «внаглую».
});
```

- [ ] **Step 2: Run — до зелёного**

Run: `pnpm build && pnpm --filter @mymozhem/server test -- quiz-points.e2e`
Expected: PASS.

- [ ] **Step 3: Сверка критериев выхода фазы 3 (design §7 ↔ тесты)**

Прогнать полный конвейер: `pnpm build && pnpm lint && pnpm boundary-check && pnpm guardrails && pnpm test && pnpm test:int && pnpm --filter @mymozhem/server test`. Затем заполнить таблицу сверки (в коммит-сообщение или отдельный `docs/sessions/2026-09-XX-phase-3-exit-audit.md` — по образцу exit-аудитов ф.1/ф.2; отдельным документом, если владелец запросит формальную сверку):

| Критерий (design §7) | Покрытие |
|---|---|
| 1. e2e лотереи (полный цикл, REST, публичность live+replay) | lottery.e2e «полный цикл» |
| 2. Конкурентный дубль; K>quantity (int + e2e); повторное вручение; двойной отзыв; revoke освобождает/fulfill нет | rewards.int-spec (5 кейсов) + lottery.e2e «K > quantity» + rewards-schema.int-spec |
| 3. Непредсказуемость: randomInt над node:crypto, границы, sanity распределения | app-runtime.int-spec «ctx.randomInt»; конструкция (единственный источник) + lint-запрет Math.random (Task 11) |
| 4. Eligibility verified/guests_allowed | lottery-handlers.spec + lottery.e2e «eligibility» |
| 5. Приостановка TTL (REQ-RWD-013) | guest-sweep.int-spec (4 кейса) |
| 6. REQ-RWD-009 (AWARDED при COMPLETED, fulfill/revoke после завершения) | lottery.e2e «REQ-RWD-009» + rewards.controller.int-spec |
| 7. Границы и контракт: boundary, capability-гейт, visibility ceiling, PII, автотест индекса | guardrails/boundary (Task 11), app-runtime.int-spec «эффекты без capability», lottery.e2e «заниженная visibility», quiz-points.e2e PII-ассерт, rewards-schema.int-spec |
| 8. Квиз-начисления: ledger сходится с табло; v1-гейт | quiz-points.e2e (оба кейса) |

Несоответствий быть не должно; любое «покрыто косвенно» — поднять владельцу, не замалчивать.

- [ ] **Step 4: Финальное двухстадийное ревью среза**

superpowers:requesting-code-review по диапазону коммитов батчей A–E: первая стадия — spec-compliance против REQ-списка Global Constraints + design §1; вторая — code quality. Findings триажить по прецеденту ф.2 (гейтящие — фикс в этом батче, миноры — deferred с записью в HANDOFF).

- [ ] **Step 5: Commit + HANDOFF**

```bash
git add apps/server/test/quiz-points.e2e-spec.ts docs/sessions
git commit -m "test(server): e2e квиз-начислений — сходимость ledger↔табло; сверка критериев выхода фазы 3

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

Обновить `HANDOFF.md` (навык handoff): фаза 3 реализована, остаточные риски, follow-up пакеты (в т.ч. перенести закрытые: ajv-formats, invalid-uuid литералы, clamp-тест), push — решение владельца.

---

## Self-review плана (пройден при написании 2026-09-10)

**Покрытие дизайна:**
- §1 REQ-список — все REQ распределены по задачам (см. Global Constraints и REQ-теги задач); REQ-RWD-006/008/012 явно вне объёма (отложены ADR-007/010).
- §2 архитектура — Tasks 3 (эффекты/хост-примитивы/capability), 5-6 (rewards + REST), 7 (диспетчер), 11 (boundary/DI).
- §3 модель данных — Task 4 (+ автотесты REQ-DEV-006).
- §4 лотерея — Task 9 (+ e2e Task 12).
- §5 квиз-начисления + свип — Tasks 10, 8 (+ e2e Task 13).
- §6 сборка по пакетам — sdk (T2-3), core (T1, T4-8), app-lottery (T9), app-quiz (T10), apps/server (T11).
- §7 тестирование — Task 13 (таблица сверки).
- §8 риски — AJV uuid (T1, решено владельцем), lint Math.random (T11, решено), дублирование счёта (T13 сходимость), латентность drawPool (принято дизайном).

**Интерпретации, зафиксированные планом (для ревью владельцем):**
1. Повтор `drawId` — no-op с **re-emit** прежнего `draw.completed` (без эффекта): «с прежним результатом» дизайна §4 на publish-канале без result-поля реализуется повторной эмиссией; редьюсер дедуплицирует.
2. `AwardStatus` в БД — uppercase БЕЗ `@map` (прецедент MemberRole), под дословный SQL частичного индекса дизайна §3.
3. Порядок в awardPrize: insert Award → декремент (no-op по индексу не списывает фонд; отказ декремента откатывает insert).
4. Cross-переход автомата (fulfill после revoke / revoke после fulfill) — `REWARD_ALREADY_RESOLVED` (409); одноимённый повтор — no-op 200 с текущим состоянием.
5. `award.points` события в логе НЕ порождает (ledger — платформенная запись; публичность начислений уже несёт `question.revealed`).
6. `createPrize` — только DRAFT/ACTIVE (wire `ROOM_NOT_ACTIVE`, 409); fulfill/revoke/list — без статусного гейта (REQ-RWD-009), кроме удалённой комнаты.
7. `ROOM_NOT_ACTIVE` добавлен в `CONTRACT_ERROR_CODES` (вывод на wire существующего внутреннего кода realtime).
8. Гард-чек приостановки — внутри транзакции свипа (окно гонки «награда создана между чтением кандидатов и анонимизацией» закрыто).
9. `IdentitySweepModule` не импортируется тестами — расписание в тестах не стартует; логика свипа покрыта прямым вызовом.
10. Tasks 10-11 атомарны для зелёного main: quiz@2 с эффектами требует подключённого исполнителя (CAPABILITY_UNAVAILABLE до Task 11) — батч D не мерджить между ними.

**Плейсхолдеры:** точечные «сверить с файлом» — только там, где план ссылается на существующие хелперы/сигнатуры, читаемые исполнителем из кода (точная форма seed-хелперов, имена REALTIME_MESSAGES, сигнатура RoomService.transition). Весь новый код дан дословно.
