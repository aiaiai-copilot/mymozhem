### Task 2: SDK 2.0.0 — контракт среза

**REQ:** REQ-CTR-004 (версия = контракт), REQ-CTR-005 (контрактные тесты из схем), REQ-DEV-007 (аддитивная эволюция: displayName optional, join-ответ += displayName), REQ-ID-003 (имя необязательно).

**Files:**
- Delete: `packages/sdk/src/auth/oauth-start-query.ts`, `packages/sdk/src/auth/oauth-callback-query.ts`, `packages/sdk/src/auth/oauth-query.contract.spec.ts`
- Modify: `packages/sdk/src/errors/error-codes.ts:29-36` (удалить 7 `OAUTH_*`, добавить `PRIZES_DISABLED`, `ORGANIZER_SETUP_INVALID`)
- Modify: `packages/sdk/src/errors/error-codes.contract.spec.ts:31-37`
- Modify: `packages/sdk/src/auth/join-request.ts` (displayName → optional)
- Modify: `packages/sdk/src/auth/join-request.fixtures.ts`, `join-request.contract.spec.ts`
- Create: `packages/sdk/src/auth/organizer-bootstrap-request.ts` + `organizer-bootstrap-request.contract.spec.ts`
- Create: `packages/sdk/src/auth/join-response.ts` + `join-response.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts` (баррель)
- Modify: `packages/sdk/src/contract-version.ts:8` → `'2.0.0'`; `packages/sdk/package.json` → `"version": "2.0.0"`

**Interfaces:**
- Produces (потребители — T5, T6, T7, T9):
  - `organizerBootstrapRequestSchema` = `z.strictObject({ setupToken: z.string().min(1) })`, тип `OrganizerBootstrapRequest`.
  - `joinResponseSchema` = `tokenResponseSchema.extend({ displayName: z.string() })`, тип `JoinResponse` (extend сохраняет strictObject).
  - `joinRequestSchema.displayName` — `displayNameSchema.optional()`; тип `JoinRequest['displayName']` → `string | undefined`.
  - `CONTRACT_ERROR_CODES` += `'PRIZES_DISABLED'`, `'ORGANIZER_SETUP_INVALID'`; минус все `OAUTH_*`.

- [ ] **Step 1: Падающие контрактные тесты.** Обновить фикстуры/спеки:

`join-request.fixtures.ts` — перенести `{ code: 'ABCDEFGH' }` из `invalidJoinRequests` в `validJoinRequests` (join без имени — валиден, ADR-012 §3).

`organizer-bootstrap-request.contract.spec.ts`:

```ts
import { organizerBootstrapRequestSchema } from './organizer-bootstrap-request';

describe('organizerBootstrapRequest contract (ADR-012)', () => {
  it('accepts a non-empty setupToken', () => {
    expect(organizerBootstrapRequestSchema.safeParse({ setupToken: 'x'.repeat(32) }).success).toBe(true);
  });
  it.each([[{}], [{ setupToken: '' }], [{ setupToken: 'x', extra: 1 }], ['nope']])(
    'rejects %j',
    (v) => expect(organizerBootstrapRequestSchema.safeParse(v).success).toBe(false),
  );
});
```

`join-response.contract.spec.ts`:

```ts
import { joinResponseSchema } from './join-response';

describe('joinResponse contract (ADR-012: серверный псевдоним в ответе)', () => {
  it('accepts token pair + displayName', () => {
    expect(
      joinResponseSchema.safeParse({ accessToken: 'a', tokenType: 'Bearer', expiresIn: 900, displayName: 'Лиса-42' }).success,
    ).toBe(true);
  });
  it('rejects missing displayName (сервер обязан назначить)', () => {
    expect(joinResponseSchema.safeParse({ accessToken: 'a', tokenType: 'Bearer', expiresIn: 900 }).success).toBe(false);
  });
});
```

`error-codes.contract.spec.ts` — ожидание списка кодов: убрать 7 `OAUTH_*`, добавить `PRIZES_DISABLED` и `ORGANIZER_SETUP_INVALID`.

- [ ] **Step 2: Прогон — красные**

```bash
pnpm --filter @mymozhem/sdk test
# Expected: FAIL — organizerBootstrapRequestSchema/joinResponseSchema не существуют, фикстура без displayName падает, список кодов расходится
```

- [ ] **Step 3: Реализация**

`packages/sdk/src/auth/join-request.ts`:

```ts
export const joinRequestSchema = z.strictObject({
  code: z.string().trim().min(1),
  // ADR-012 §3: имя необязательно — при отсутствии сервер назначает псевдоним.
  displayName: displayNameSchema.optional(),
  role: z.enum(['participant', 'spectator']).optional(),
});
```

`packages/sdk/src/auth/organizer-bootstrap-request.ts`:

```ts
import { z } from 'zod';

// POST /auth/organizer (ADR-012 §2): bootstrap единственного REGISTERED инстанса
// по setup-токену из конфигурации. Длина проверяется сервером сравнением с
// конфигом (timing-safe), здесь — только форма.
export const organizerBootstrapRequestSchema = z.strictObject({
  setupToken: z.string().min(1),
});
export type OrganizerBootstrapRequest = z.infer<typeof organizerBootstrapRequestSchema>;
```

`packages/sdk/src/auth/join-response.ts`:

```ts
import { z } from 'zod';
import { tokenResponseSchema } from './token-response';

// Ответ POST /rooms/join (ADR-012 §3): фактический displayName (заданный или
// назначенный сервером псевдоним) — клиент сохраняет его для авто-rejoin.
export const joinResponseSchema = tokenResponseSchema.extend({
  displayName: z.string().min(1),
});
export type JoinResponse = z.infer<typeof joinResponseSchema>;
```

`error-codes.ts`: удалить строки 29–36 (комментарий + 7 `OAUTH_*`), добавить после `ROOM_ORGANIZER_NOT_REGISTERED`-блока:

```ts
  // ADR-012 (срез zero-PII): bootstrap организатора и призовой режим.
  'ORGANIZER_SETUP_INVALID',
  'PRIZES_DISABLED',
```

`index.ts`: удалить строки 32–33 (`oauth-start-query`, `oauth-callback-query`); добавить `export * from './auth/organizer-bootstrap-request';` и `export * from './auth/join-response';` (рядом с join-request/token-response).

`contract-version.ts:8` → `export const CONTRACT_VERSION = '2.0.0';` и `package.json` → `"version": "2.0.0"` (парность запинана contract-version.contract.spec).

- [ ] **Step 4: Прогон — зелёные + сборка**

```bash
pnpm --filter @mymozhem/sdk test && pnpm --filter @mymozhem/sdk build
# Expected: PASS; build чистый (баррель без мёртвых ссылок)
```

- [ ] **Step 5: Каскадная проверка компиляции потребителей.** SDK 2.0 ломает импортёров oauth-схем (web landing импортирует только типы — проверить): `pnpm typecheck` — ожидаемые красные места: `apps/web` (если импортирует oauth-схемы — нет, проверить `grep -rn 'oauth' apps/web/src`) и core (oauth.controller использует oauth-схемы из SDK? — проверить `grep -rn 'oauthStartQuery\|oauthCallbackQuery\|OAUTH_' packages/core/src packages/app-*`). Известные потребители удаляются в T4 — зафиксировать красное дерево как ожидаемое промежуточное состояние батча A, НЕ чинить (T4 зеленеет). Если красное есть вне известного инвентаря T4 — остановиться, эскалация.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk
git commit -m "feat(sdk)!: контракт 2.0.0 — ADR-012: displayName необязателен, join-ответ с displayName, bootstrap-схема, коды PRIZES_DISABLED/ORGANIZER_SETUP_INVALID; удалены oauth-схемы и OAUTH_* коды"
```

---

