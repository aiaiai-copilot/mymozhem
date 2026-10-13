### Task 2: SDK — роль в join-request (SPECTATOR вход)

**Files:**
- Modify: `packages/sdk/src/auth/join-request.ts`
- Modify: `packages/sdk/src/auth/join-request.fixtures.ts`
- Test: `packages/sdk/src/auth/join-request.contract.spec.ts`

**Interfaces:**
- Produces: `JoinRequest.role?: 'participant' | 'spectator'` (wire-значения lowercase; маппинг на `MemberRole` — Task 8).

**REQ:** REQ-ID-011 (назначение SPECTATOR), REQ-CTR-005 (фикстуры).

- [ ] **Step 1: Failing contract test**

В `join-request.contract.spec.ts` добавить:

```typescript
it('accepts explicit spectator role', () => {
  expect(joinRequestSchema.safeParse({ code: 'ABCDEFGH', displayName: 'Гляделкин', role: 'spectator' }).success).toBe(true);
});

it('defaults to participant semantics: role is optional', () => {
  const parsed = joinRequestSchema.safeParse({ code: 'ABCDEFGH', displayName: 'Игрок' });
  expect(parsed.success).toBe(true);
  expect(parsed.success && parsed.data.role).toBeUndefined();
});

it('refuses privileged roles through the join flag', () => {
  for (const role of ['organizer', 'moderator', 'ORGANIZER', 'SPECTATOR']) {
    expect(joinRequestSchema.safeParse({ code: 'ABCDEFGH', displayName: 'x', role }).success).toBe(false);
  }
});
```

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/sdk test -- join-request`
Expected: FAIL (role — лишний ключ в strictObject).

- [ ] **Step 3: Implement**

`join-request.ts`:

```typescript
import { z } from 'zod';
import { displayNameSchema } from '../identity/display-name';

// POST /rooms/join request body (REQ-ID-003). strict: лишние ключи не проходят границу.
// role (фаза 2, REQ-ID-011): самоназначение зрителем при входе. Только два значения —
// ORGANIZER/MODERATOR через флаг не получить структурно. Отсутствие = participant.
export const joinRequestSchema = z.strictObject({
  code: z.string().trim().min(1),
  displayName: displayNameSchema,
  role: z.enum(['participant', 'spectator']).optional(),
});
export type JoinRequest = z.infer<typeof joinRequestSchema>;
```

В `join-request.fixtures.ts` добавить валидную фикстуру с `role: 'spectator'` и невалидную с `role: 'organizer'` (по образцу существующих пар в файле).

- [ ] **Step 4: Run — GREEN**

Run: `pnpm --filter @mymozhem/sdk test -- join-request`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk
git commit -m "feat(sdk): join-request — необязательная роль participant|spectator (REQ-ID-011)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

