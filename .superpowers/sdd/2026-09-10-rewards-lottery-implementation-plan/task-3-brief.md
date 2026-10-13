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
