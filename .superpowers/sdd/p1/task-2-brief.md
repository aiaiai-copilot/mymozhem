## Task 2: Typed error codes

**Files:**
- Create: `packages/sdk/src/errors/error-codes.ts`, `packages/sdk/src/errors/error-codes.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`

**Interfaces:**
- Produces: `CONTRACT_ERROR_CODES`, `ContractErrorCode`, `contractErrorCodeSchema`, `contractErrorPayloadSchema`, `ContractErrorPayload`, `class ContractError { code; toPayload() }`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test** — `packages/sdk/src/errors/error-codes.contract.spec.ts`

```ts
import {
  CONTRACT_ERROR_CODES,
  ContractError,
  contractErrorCodeSchema,
  contractErrorPayloadSchema,
} from './error-codes';

describe('contract errors', () => {
  it('exports exactly the codes named by the design §8', () => {
    expect([...CONTRACT_ERROR_CODES]).toEqual([
      'MANIFEST_INVALID',
      'CONTRACT_VERSION_INCOMPATIBLE',
      'SCHEMA_NOT_REPRESENTABLE',
      'EVENT_UNKNOWN_TYPE',
      'EVENT_PAYLOAD_INVALID',
      'EVENT_VISIBILITY_WEAKER_THAN_DECLARED',
      'EVENT_PAYLOAD_TOO_LARGE',
      'EVENT_RATE_LIMITED',
      'ROOM_LOG_SEALED',
      'ROOM_SETTINGS_FROZEN',
    ]);
  });

  it('rejects an unknown code', () => {
    expect(contractErrorCodeSchema.safeParse('KABOOM').success).toBe(false);
  });

  it('carries its code and stays a real Error', () => {
    const err = new ContractError('EVENT_UNKNOWN_TYPE', 'internal detail: table app_registry empty');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('EVENT_UNKNOWN_TYPE');
  });

  // REQ-SEC-006: outward there is a code and nothing else — no message, no stack.
  it('projects outward as a bare code, leaking neither message nor stack', () => {
    const err = new ContractError('EVENT_UNKNOWN_TYPE', 'internal detail: table app_registry empty');
    const payload = err.toPayload();

    expect(payload).toEqual({ code: 'EVENT_UNKNOWN_TYPE' });
    expect(contractErrorPayloadSchema.safeParse(payload).success).toBe(true);

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('internal detail');
    expect(serialized).not.toContain('at ');
  });

  it('rejects an outward payload that smuggles extra fields', () => {
    const smuggled = { code: 'EVENT_UNKNOWN_TYPE', message: 'table app_registry empty' };
    expect(contractErrorPayloadSchema.safeParse(smuggled).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk exec jest src/errors -v`
Expected: FAIL — `Cannot find module './error-codes'`.

- [ ] **Step 3: Write the implementation** — `packages/sdk/src/errors/error-codes.ts`

```ts
import { z } from 'zod';

// Typed error codes crossing the contract boundary (REQ-SEC-006, design §8).
// The SDK exports them because a module is required to be able to parse them.
export const CONTRACT_ERROR_CODES = [
  'MANIFEST_INVALID',
  'CONTRACT_VERSION_INCOMPATIBLE',
  'SCHEMA_NOT_REPRESENTABLE',
  'EVENT_UNKNOWN_TYPE',
  'EVENT_PAYLOAD_INVALID',
  'EVENT_VISIBILITY_WEAKER_THAN_DECLARED',
  'EVENT_PAYLOAD_TOO_LARGE',
  'EVENT_RATE_LIMITED',
  'ROOM_LOG_SEALED',
  'ROOM_SETTINGS_FROZEN',
] as const;

export type ContractErrorCode = (typeof CONTRACT_ERROR_CODES)[number];
export const contractErrorCodeSchema = z.enum(CONTRACT_ERROR_CODES);

// The wire form of an error: a code, and deliberately nothing else. strictObject so
// that a well-meaning `message` field cannot be added without failing this contract
// (REQ-SEC-006 bans forwarding raw error.message outward).
export const contractErrorPayloadSchema = z.strictObject({
  code: contractErrorCodeSchema,
});
export type ContractErrorPayload = z.infer<typeof contractErrorPayloadSchema>;

export class ContractError extends Error {
  readonly code: ContractErrorCode;

  constructor(code: ContractErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ContractError';
  }

  // The message stays server-side, for logs and tests; only the code goes out.
  toPayload(): ContractErrorPayload {
    return { code: this.code };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/sdk exec jest src/errors -v`
Expected: PASS — 5 tests.

- [ ] **Step 5: Export from the package surface** — add to `packages/sdk/src/index.ts`, above the visibility line

```ts
export * from './errors/error-codes';
```

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/errors packages/sdk/src/index.ts
git commit -m "feat(sdk): typed contract error codes, code-only wire form (REQ-SEC-006)"
```

---

