### Task 1: SDK contract vocabulary — identity kind + member role

**Files:**
- Create: `packages/sdk/src/identity/identity-kind.ts`
- Create: `packages/sdk/src/identity/identity-kind.fixtures.ts`
- Create: `packages/sdk/src/identity/identity-kind.contract.spec.ts`
- Create: `packages/sdk/src/membership/member-role.ts`
- Create: `packages/sdk/src/membership/member-role.fixtures.ts`
- Create: `packages/sdk/src/membership/member-role.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `IDENTITY_KINDS`, `identityKindSchema`, `type IdentityKind`; `MEMBER_ROLES`, `memberRoleSchema`, `type MemberRole` — all re-exported from `@mymozhem/sdk`. No consumer inside this plan by design (contract vocabulary, design §4); later membership/JWT/draw-eligibility slices rely on these exact names.

- [ ] **Step 1: Write the failing contract test for identity kind**

`packages/sdk/src/identity/identity-kind.contract.spec.ts`:

```ts
import { IDENTITY_KINDS, identityKindSchema } from './identity-kind';
import { validKinds, invalidKinds } from './identity-kind.fixtures';

describe('identityKind contract (REQ-ID-001)', () => {
  it('declares exactly the two kinds of REQ-ID-001', () => {
    expect([...IDENTITY_KINDS]).toEqual(['REGISTERED', 'GUEST']);
  });

  it.each(validKinds)('accepts %s', (kind) => {
    expect(identityKindSchema.safeParse(kind).success).toBe(true);
  });

  it.each(invalidKinds.map((v) => [String(v), v] as const))('rejects %s', (_name, v) => {
    expect(identityKindSchema.safeParse(v).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk test -- identity-kind`
Expected: FAIL — `Cannot find module './identity-kind'`.

- [ ] **Step 3: Implement identity-kind + fixtures**

`packages/sdk/src/identity/identity-kind.ts`:

```ts
import { z } from 'zod';

// REQ-ID-001: single identity table, kind REGISTERED | GUEST. Contract vocabulary,
// fixed here so membership, JWT claims and draw_eligibility don't fork literals
// before their slices land.
export const IDENTITY_KINDS = ['REGISTERED', 'GUEST'] as const;
export const identityKindSchema = z.enum(IDENTITY_KINDS);
export type IdentityKind = z.infer<typeof identityKindSchema>;
```

`packages/sdk/src/identity/identity-kind.fixtures.ts`:

```ts
import type { IdentityKind } from './identity-kind';

export const validKinds: IdentityKind[] = ['REGISTERED', 'GUEST'];

// Unknown roles, wrong case, empty, non-strings — all rejected.
export const invalidKinds: unknown[] = ['ADMIN', 'guest', 'registered', '', null, 42];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/sdk test -- identity-kind`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing contract test for member role**

`packages/sdk/src/membership/member-role.contract.spec.ts`:

```ts
import { MEMBER_ROLES, memberRoleSchema } from './member-role';
import { validRoles, invalidRoles } from './member-role.fixtures';

describe('memberRole contract (REQ-ID-011)', () => {
  it('declares exactly the four roles of REQ-ID-011', () => {
    expect([...MEMBER_ROLES]).toEqual(['ORGANIZER', 'MODERATOR', 'PARTICIPANT', 'SPECTATOR']);
  });

  it.each(validRoles)('accepts %s', (role) => {
    expect(memberRoleSchema.safeParse(role).success).toBe(true);
  });

  it.each(invalidRoles.map((v) => [String(v), v] as const))('rejects %s', (_name, v) => {
    expect(memberRoleSchema.safeParse(v).success).toBe(false);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk test -- member-role`
Expected: FAIL — `Cannot find module './member-role'`.

- [ ] **Step 7: Implement member-role + fixtures**

`packages/sdk/src/membership/member-role.ts`:

```ts
import { z } from 'zod';

// REQ-ID-011: membership role model. MODERATOR holds no privileges beyond
// PARTICIPANT until phase 4 (amendment v1.3) but stays in the enumeration;
// the access matrix lands with the membership entity.
export const MEMBER_ROLES = ['ORGANIZER', 'MODERATOR', 'PARTICIPANT', 'SPECTATOR'] as const;
export const memberRoleSchema = z.enum(MEMBER_ROLES);
export type MemberRole = z.infer<typeof memberRoleSchema>;
```

`packages/sdk/src/membership/member-role.fixtures.ts`:

```ts
import type { MemberRole } from './member-role';

export const validRoles: MemberRole[] = ['ORGANIZER', 'MODERATOR', 'PARTICIPANT', 'SPECTATOR'];

// Unknown roles, wrong case, empty, non-strings — all rejected.
export const invalidRoles: unknown[] = ['ADMIN', 'organizer', 'owner', '', null, 42];
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/sdk test -- member-role`
Expected: PASS (3 tests).

- [ ] **Step 9: Re-export from the SDK entrypoint and typecheck**

Append to `packages/sdk/src/index.ts`:

```ts
export * from './identity/identity-kind';
export * from './identity/identity-kind.fixtures';
export * from './membership/member-role';
export * from './membership/member-role.fixtures';
```

Run: `pnpm --filter @mymozhem/sdk run typecheck && pnpm --filter @mymozhem/sdk test`
Expected: typecheck PASS; full SDK suite PASS (old + new).

- [ ] **Step 10: Commit**

```bash
git add packages/sdk/src/identity packages/sdk/src/membership packages/sdk/src/index.ts
git commit -m "feat(sdk): identityKind + memberRole contract vocabulary (REQ-ID-001, REQ-ID-011)"
```

---

