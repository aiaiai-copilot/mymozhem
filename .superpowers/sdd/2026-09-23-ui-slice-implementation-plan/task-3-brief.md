### Task 3: SDK wire-схемы — configure-request, ростер, список призов

**Files:**
- Create: `packages/sdk/src/room/configure-room-request.ts`
- Create: `packages/sdk/src/membership/roster-entry.ts`
- Create: `packages/sdk/src/rewards/list-prizes-response.ts`
- Modify: `packages/sdk/src/index.ts` (экспорты)
- Test: `packages/sdk/src/room/configure-room-request.contract.spec.ts`, `packages/sdk/src/membership/roster-entry.contract.spec.ts`, `packages/sdk/src/rewards/list-prizes-response.contract.spec.ts`

**Interfaces:**
- Produces (потребляются Task 5 и web-клиентом): `configureRoomRequestSchema`, `ConfigureRoomRequest`; `rosterRoleSchema`, `rosterEntrySchema`, `rosterResponseSchema`, `RosterEntry`, `RosterResponse`; `listPrizesResponseSchema`, `ListPrizesResponse`.

- [ ] **Step 1: Failing tests** (по прецеденту существующих contract-спек: валидный кейс парсится, лишний ключ отклоняется, строгость типов)

```ts
// configure-room-request.contract.spec.ts
it.each([
  ['valid', { appId: 'quiz', manifestVersion: 2, settings: { questions: [] } }, true],
  ['extra key rejected', { appId: 'quiz', manifestVersion: 2, settings: {}, extra: 1 }, false],
  ['settings must be object', { appId: 'quiz', manifestVersion: 2, settings: 'x' }, false],
  ['bad appId', { appId: 'QUIZ!', manifestVersion: 2, settings: {} }, false],
])('%s', (_l, body, ok) => {
  expect(configureRoomRequestSchema.safeParse(body).success).toBe(ok);
});

// roster-entry.contract.spec.ts
it.each([
  ['valid', { identityId: crypto.randomUUID(), displayName: 'Гость', role: 'participant' }, true],
  ['swept guest — displayName null', { identityId: crypto.randomUUID(), displayName: null, role: 'participant' }, true],
  ['uppercase role rejected (wire lowercase)', { identityId: crypto.randomUUID(), displayName: 'x', role: 'PARTICIPANT' }, false],
  ['extra key rejected', { identityId: crypto.randomUUID(), displayName: 'x', role: 'organizer', extra: 1 }, false],
])('%s', (_l, entry, ok) => {
  expect(rosterEntrySchema.safeParse(entry).success).toBe(ok);
});

// list-prizes-response.contract.spec.ts — { prizes: PrizeResponse[] }, пустой массив валиден
```

- [ ] **Step 2: Run** — `pnpm --filter @mymozhem/sdk test` → FAIL (нет экспортов)

- [ ] **Step 3: Implement**

```ts
// configure-room-request.ts
import { z } from 'zod';
import { appIdSchema } from '../events/event-type';

// POST /rooms/:roomId/configure (дизайн UI-среза, решение №9). settings — JSON-объект
// appSettings: семантическую валидацию делает app-registry (REQ-CORE-007), здесь — форма.
export const configureRoomRequestSchema = z.strictObject({
  appId: appIdSchema,
  manifestVersion: z.number().int().positive(),
  settings: z.record(z.string(), z.unknown()),
});
export type ConfigureRoomRequest = z.infer<typeof configureRoomRequestSchema>;
```

```ts
// roster-entry.ts
import { z } from 'zod';

// GET /rooms/:roomId/members (дизайн UI-среза, решение №10): ростер — read-контур;
// в лог displayName не пишется (REQ-SEC-009 касается событий). displayName nullable —
// TTL-свип анонимизирует гостя, membership при этом жив. Wire-роли lowercase —
// прецедент JoinRequest ('participant' | 'spectator').
export const rosterRoleSchema = z.enum(['organizer', 'moderator', 'participant', 'spectator']);
export type RosterRole = z.infer<typeof rosterRoleSchema>;

export const rosterEntrySchema = z.strictObject({
  identityId: z.uuid(),
  displayName: z.string().nullable(),
  role: rosterRoleSchema,
});
export type RosterEntry = z.infer<typeof rosterEntrySchema>;

export const rosterResponseSchema = z.strictObject({ members: z.array(rosterEntrySchema) });
export type RosterResponse = z.infer<typeof rosterResponseSchema>;
```

```ts
// list-prizes-response.ts
import { z } from 'zod';
import { prizeResponseSchema } from './prize-response';

// GET /rooms/:id/prizes (дизайн UI-среза §2): консоли нужны prizeId и остаток фонда.
export const listPrizesResponseSchema = z.strictObject({ prizes: z.array(prizeResponseSchema) });
export type ListPrizesResponse = z.infer<typeof listPrizesResponseSchema>;
```

Плюс три строки экспорта в `index.ts`.

- [ ] **Step 4: Run** — `pnpm --filter @mymozhem/sdk test && pnpm --filter @mymozhem/sdk build` → зелёный

- [ ] **Step 5: Commit** — `feat(sdk): wire-схемы configure-room-request, roster, list-prizes (UI-срез, решения №9/№10)`

