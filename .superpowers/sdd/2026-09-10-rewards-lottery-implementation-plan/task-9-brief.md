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
