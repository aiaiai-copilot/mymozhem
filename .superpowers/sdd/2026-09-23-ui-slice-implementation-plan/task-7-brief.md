### Task 7: API-клиент (`src/api/`)

**Files:**
- Create: `apps/web/src/api/api-error.ts`, `apps/web/src/api/token-provider.ts`, `apps/web/src/api/api-client.ts`, `apps/web/src/api/endpoints.ts`
- Test: `apps/web/src/api/api-client.spec.ts`

**Interfaces:**
- Produces (потребители — все страницы): `ApiError { code: string; status: number }`; `TokenProvider { getAccessToken(): string | null; refresh(): Promise<void> }`; `ApiClient.call<S extends z.ZodType>(req: { method: 'GET'|'POST'; path: string; body?: unknown; schema: S; auth?: boolean }): Promise<z.output<S>>`; endpoints: `joinRoom, refreshSession, createRoom, configureRoom, activateRoom, completeRoom, cancelRoom, listMembers, listPrizes, createPrize, listRewards, fulfillAward, revokeAward, excludeMember` — все `(client: ApiClient, ...args)`.

- [ ] **Step 1: Failing tests** (`vi.stubGlobal('fetch', ...)`):

```ts
it('parses ok response with the schema (fail-loud on drift)') // schema mismatch → throws ZodError
it('401 → one refresh → one retry with the new token') // fetch 2 раза, 2-й с новым Bearer
it('second 401 → ApiError, no infinite retry (Review Focus 4)')
it('error body { code } → ApiError with that code; без code → HTTP_<status>')
it('auth:false не шлёт authorization и не делает refresh при 401')
```

- [ ] **Step 2: Run red** — `pnpm --filter @mymozhem/web test` → FAIL

- [ ] **Step 3: Implement** — api-client.ts:

```ts
import { z } from 'zod';
import { ApiError } from './api-error';
import type { TokenProvider } from './token-provider';

// Тонкий typed REST-клиент (дизайн §3): zod-валидация ответов fail-loud при дрейфе
// контракта; серверные ошибки — { code } (REQ-SEC-006); 401 → один refresh → один
// retry (ровно один — Review Focus 4).
export interface ApiRequest<S extends z.ZodType> {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  schema: S;
  auth?: boolean; // default true
}

export class ApiClient {
  constructor(private readonly tokens: TokenProvider) {}

  async call<S extends z.ZodType>(req: ApiRequest<S>, allowRetry = true): Promise<z.output<S>> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const token = this.tokens.getAccessToken();
    if (req.auth !== false && token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(req.path, {
      method: req.method,
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      credentials: 'same-origin', // refresh-кука Strict — только same-origin (дизайн §0.3)
    });
    if (res.status === 401 && req.auth !== false && allowRetry) {
      await this.tokens.refresh();
      return this.call(req, false);
    }
    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = (json as { code?: unknown }).code;
      throw new ApiError(typeof code === 'string' ? code : `HTTP_${res.status}`, res.status);
    }
    return req.schema.parse(json);
  }
}
```

endpoints.ts — обёртки над SDK-схемами (пример; остальные по той же форме):

```ts
export const joinRoom = (c: ApiClient, input: JoinRequest): Promise<TokenResponse> =>
  c.call({ method: 'POST', path: '/rooms/join', body: input, schema: tokenResponseSchema, auth: false });
export const refreshSession = (c: ApiClient): Promise<TokenResponse> =>
  c.call({ method: 'POST', path: '/auth/refresh', schema: tokenResponseSchema, auth: false });
export const configureRoom = (c: ApiClient, roomId: string, input: ConfigureRoomRequest): Promise<CreateRoomResponse> =>
  c.call({ method: 'POST', path: `/rooms/${roomId}/configure`, body: input, schema: createRoomResponseSchema });
export const listMembers = (c: ApiClient, roomId: string): Promise<RosterResponse> =>
  c.call({ method: 'GET', path: `/rooms/${roomId}/members`, schema: rosterResponseSchema });
// createRoom, activateRoom, completeRoom, cancelRoom, listPrizes, createPrize,
// listRewards, fulfillAward, revokeAward, excludeMember — по той же форме со схемами SDK.
```

- [ ] **Step 4: Run green**, lint/typecheck

- [ ] **Step 5: Commit** — `feat(web): typed API-клиент с zod-валидацией и refresh-retry`

