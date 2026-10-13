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

