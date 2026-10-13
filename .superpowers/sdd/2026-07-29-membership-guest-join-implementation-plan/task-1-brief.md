### Task 1: SDK — схемы roomJoinPolicy и displayName

**Files:**
- Create: `packages/sdk/src/membership/room-join-policy.ts`
- Create: `packages/sdk/src/membership/room-join-policy.fixtures.ts`
- Create: `packages/sdk/src/membership/room-join-policy.contract.spec.ts`
- Create: `packages/sdk/src/identity/display-name.ts`
- Create: `packages/sdk/src/identity/display-name.fixtures.ts`
- Create: `packages/sdk/src/identity/display-name.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`

**Interfaces:**
- Consumes: ничего из новых задач (SDK — лист).
- Produces: `roomJoinPolicySchema`, `ROOM_JOIN_POLICIES`, тип `RoomJoinPolicy` (`'guests' | 'registered' | 'invite_only'`); `displayNameSchema`, `DISPLAY_NAME_MAX_LENGTH`, тип `DisplayName`; фикстуры `validJoinPolicies`/`invalidJoinPolicies`, `validDisplayNames`/`invalidDisplayNames`. Потребители: RoomService (Task 3), IdentityService (Task 4), MembershipService (Task 5).

- [ ] **Step 1: Написать failing контрактные тесты**

`packages/sdk/src/membership/room-join-policy.contract.spec.ts`:

```ts
import { ROOM_JOIN_POLICIES, roomJoinPolicySchema } from './room-join-policy';
import { validJoinPolicies, invalidJoinPolicies } from './room-join-policy.fixtures';

describe('roomJoinPolicy contract (REQ-ID-002)', () => {
  it('declares exactly the three policies of REQ-ID-002', () => {
    expect([...ROOM_JOIN_POLICIES]).toEqual(['guests', 'registered', 'invite_only']);
  });

  it.each(validJoinPolicies)('accepts %s', (policy) => {
    expect(roomJoinPolicySchema.safeParse(policy).success).toBe(true);
  });

  it.each(invalidJoinPolicies.map((v) => [String(v), v] as const))('rejects %s', (_name, v) => {
    expect(roomJoinPolicySchema.safeParse(v).success).toBe(false);
  });
});
```

`packages/sdk/src/identity/display-name.contract.spec.ts`:

```ts
import { DISPLAY_NAME_MAX_LENGTH, displayNameSchema } from './display-name';
import { validDisplayNames, invalidDisplayNames } from './display-name.fixtures';

describe('displayName contract (REQ-ID-003)', () => {
  it.each(validDisplayNames)('accepts %s', (name) => {
    expect(displayNameSchema.safeParse(name).success).toBe(true);
  });

  it.each(invalidDisplayNames.map((v) => [String(v), v] as const))('rejects %s', (_name, v) => {
    expect(displayNameSchema.safeParse(v).success).toBe(false);
  });

  it('trims surrounding whitespace', () => {
    expect(displayNameSchema.parse('  Alex  ')).toBe('Alex');
  });

  it('accepts exactly DISPLAY_NAME_MAX_LENGTH chars and rejects one more', () => {
    expect(displayNameSchema.safeParse('x'.repeat(DISPLAY_NAME_MAX_LENGTH)).success).toBe(true);
    expect(displayNameSchema.safeParse('x'.repeat(DISPLAY_NAME_MAX_LENGTH + 1)).success).toBe(false);
  });
});
```

- [ ] **Step 2: Прогнать — подтвердить RED**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: FAIL — модули `./room-join-policy`, `./display-name` не существуют.

- [ ] **Step 3: Реализовать схемы и фикстуры**

`packages/sdk/src/membership/room-join-policy.ts`:

```ts
import { z } from 'zod';

// REQ-ID-002: join policy is a room attribute, default 'guests' (ADR-004). Values are
// the lowercase spec strings; the DB enum maps to them via @map (design §2).
export const ROOM_JOIN_POLICIES = ['guests', 'registered', 'invite_only'] as const;
export const roomJoinPolicySchema = z.enum(ROOM_JOIN_POLICIES);
export type RoomJoinPolicy = z.infer<typeof roomJoinPolicySchema>;
```

`packages/sdk/src/membership/room-join-policy.fixtures.ts`:

```ts
import type { RoomJoinPolicy } from './room-join-policy';

export const validJoinPolicies: RoomJoinPolicy[] = ['guests', 'registered', 'invite_only'];

// Wrong case, unknown values, empty, non-strings — all rejected.
export const invalidJoinPolicies: unknown[] = ['GUESTS', 'Guests', 'public', '', null, 42];
```

`packages/sdk/src/identity/display-name.ts`:

```ts
import { z } from 'zod';

// Guest display name (REQ-ID-003): trimmed, 1..40 chars. PII-adjacent: it lives on the
// Identity row only and never enters event-log payloads (REQ-SEC-009).
export const DISPLAY_NAME_MAX_LENGTH = 40;
export const displayNameSchema = z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH);
export type DisplayName = z.infer<typeof displayNameSchema>;
```

`packages/sdk/src/identity/display-name.fixtures.ts`:

```ts
export const validDisplayNames: string[] = ['Саша', 'A', '  Alex  '];

// Empty, whitespace-only (trims to empty), over the cap, non-strings — all rejected.
export const invalidDisplayNames: unknown[] = ['', '   ', 'x'.repeat(41), null, 42];
```

- [ ] **Step 4: Прогнать — GREEN**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: PASS; новые 20 тестов зелёные (162 существующих не тронуты).

- [ ] **Step 5: Экспорты в index.ts**

В `packages/sdk/src/index.ts` добавить (после существующих identity/membership строк):

```ts
export * from './identity/display-name';
export * from './identity/display-name.fixtures';
export * from './membership/room-join-policy';
export * from './membership/room-join-policy.fixtures';
```

- [ ] **Step 6: Гейты пакета + commit**

Run: `pnpm --filter @mymozhem/sdk lint && pnpm --filter @mymozhem/sdk typecheck && pnpm --filter @mymozhem/sdk test`
Expected: зелёные.

```bash
git add packages/sdk
git commit -m "feat(sdk): room join policy + displayName contract schemas (REQ-ID-002, REQ-ID-003)"
```

---

