### Task 1: SDK — DTO join/token, новые коды ошибок, контракт 1.1.0

**REQ:** REQ-SEC-006 (wire-формат), REQ-ID-003 (join DTO), REQ-ID-016 (token DTO), REQ-CTR-004 (версия = версия пакета).

**Files:**
- Create: `packages/sdk/src/auth/join-request.ts`
- Create: `packages/sdk/src/auth/join-request.fixtures.ts`
- Create: `packages/sdk/src/auth/join-request.contract.spec.ts`
- Create: `packages/sdk/src/auth/token-response.ts`
- Create: `packages/sdk/src/auth/token-response.contract.spec.ts`
- Modify: `packages/sdk/src/errors/error-codes.ts` (добавить 6 кодов)
- Modify: `packages/sdk/src/errors/error-codes.contract.spec.ts` (если есть; иначе коды покрываются join/token спеками — проверить существование, не создавать дубль)
- Modify: `packages/sdk/src/index.ts` (экспорты)
- Modify: `packages/sdk/src/contract-version.ts` (`CONTRACT_VERSION = '1.1.0'`)
- Modify: `packages/sdk/package.json` (`"version": "1.1.0"`)

**Interfaces:**
- Produces: `joinRequestSchema: z.ZodType<{ code: string; displayName: string }>`, `JoinRequest`; `tokenResponseSchema`, `TokenResponse = { accessToken: string; tokenType: 'Bearer'; expiresIn: number }`. Новые коды в `CONTRACT_ERROR_CODES`: `'ROOM_JOIN_DENIED'`, `'ROOM_PARTICIPANT_LIMIT_REACHED'`, `'RATE_LIMITED'`, `'REQUEST_INVALID'`, `'SESSION_INVALID'`, `'INTERNAL_ERROR'`.

- [ ] **Step 1: Падающий contract-тест join-request**

`packages/sdk/src/auth/join-request.fixtures.ts`:
```ts
export const validJoinRequests: unknown[] = [
  { code: 'ABCDEFGH', displayName: 'Alex' },
  { code: 'x', displayName: '  Аня  ' },
];
export const invalidJoinRequests: unknown[] = [
  {},
  { code: 'ABCDEFGH' },
  { displayName: 'Alex' },
  { code: '', displayName: 'Alex' },
  { code: 'ABCDEFGH', displayName: '' },
  { code: 'ABCDEFGH', displayName: 'x'.repeat(41) },
  { code: 'ABCDEFGH', displayName: 'Alex', extra: true }, // strictObject
  'not-an-object',
];
```

`packages/sdk/src/auth/join-request.contract.spec.ts`:
```ts
import { joinRequestSchema } from './join-request';
import { validJoinRequests, invalidJoinRequests } from './join-request.fixtures';

describe('joinRequest contract (REQ-ID-003)', () => {
  it.each(validJoinRequests.map((v) => [JSON.stringify(v), v] as const))('accepts %s', (_l, v) => {
    expect(joinRequestSchema.safeParse(v).success).toBe(true);
  });
  it.each(invalidJoinRequests.map((v) => [JSON.stringify(v), v] as const))('rejects %s', (_l, v) => {
    expect(joinRequestSchema.safeParse(v).success).toBe(false);
  });
  it('trims displayName via the shared displayNameSchema', () => {
    expect(joinRequestSchema.parse({ code: 'ABCDEFGH', displayName: '  Alex  ' }).displayName).toBe('Alex');
  });
});
```

- [ ] **Step 2: Прогнать — падает** (`pnpm --filter @mymozhem/sdk test -t joinRequest` → модуль не найден)

- [ ] **Step 3: Реализация join-request + token-response**

`packages/sdk/src/auth/join-request.ts`:
```ts
import { z } from 'zod';
import { displayNameSchema } from '../identity/display-name';

// POST /rooms/join request body (REQ-ID-003). strict: лишние ключи не проходят границу.
export const joinRequestSchema = z.strictObject({
  code: z.string().trim().min(1),
  displayName: displayNameSchema,
});
export type JoinRequest = z.infer<typeof joinRequestSchema>;
```

`packages/sdk/src/auth/token-response.ts`:
```ts
import { z } from 'zod';

// Ответ join/refresh (REQ-ID-016). Refresh никогда не ездит в теле — он httpOnly-cookie
// (REQ-ID-008), поэтому его здесь нет и быть не может.
export const tokenResponseSchema = z.strictObject({
  accessToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive(),
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;
```

`packages/sdk/src/auth/token-response.contract.spec.ts`:
```ts
import { tokenResponseSchema } from './token-response';

describe('tokenResponse contract (REQ-ID-016)', () => {
  it('accepts a well-formed response', () => {
    expect(tokenResponseSchema.safeParse({ accessToken: 'a.b.c', tokenType: 'Bearer', expiresIn: 900 }).success).toBe(true);
  });
  it.each([
    { accessToken: '', tokenType: 'Bearer', expiresIn: 900 },
    { accessToken: 'a.b.c', tokenType: 'bearer', expiresIn: 900 },
    { accessToken: 'a.b.c', tokenType: 'Bearer', expiresIn: 0 },
    { accessToken: 'a.b.c', tokenType: 'Bearer', expiresIn: 900, refreshToken: 'x' }, // strict
  ])('rejects %j', (v) => {
    expect(tokenResponseSchema.safeParse(v).success).toBe(false);
  });
});
```

- [ ] **Step 4: Коды ошибок + версия**

В `packages/sdk/src/errors/error-codes.ts` добавить в `CONTRACT_ERROR_CODES` (комментарием отделить от существующих):
```ts
  // Transport-facing API errors (first HTTP slice, REQ-SEC-006).
  'ROOM_JOIN_DENIED',
  'ROOM_PARTICIPANT_LIMIT_REACHED',
  'RATE_LIMITED',
  'REQUEST_INVALID',
  'SESSION_INVALID',
  'INTERNAL_ERROR',
```
В `contract-version.ts`: `CONTRACT_VERSION = '1.1.0'` (аддитивное расширение → minor). В `packages/sdk/package.json`: `"version": "1.1.0"`.

В `packages/sdk/src/index.ts` добавить:
```ts
export * from './auth/join-request';
export * from './auth/join-request.fixtures';
export * from './auth/token-response';
```

- [ ] **Step 5: Прогнать все тесты sdk — зелёные, включая parity-тест версии**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: PASS (parity-тест `contract-version.contract.spec.ts` проходит, т.к. версия поднята в обоих местах).

- [ ] **Step 6: Commit**

```bash
git add packages/sdk
git commit -m "feat(sdk): join/token DTO + transport error codes, contract 1.1.0 (REQ-ID-003, REQ-ID-016, REQ-SEC-006)"
```

---

