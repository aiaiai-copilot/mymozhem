# SDK Contract Core — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core of the core↔module contract in `packages/sdk` — the log-event envelope and its outward projection, the visibility lattice, the app manifest, the app event-schema registry with conversion guard, versioning and pinning — as zod schemas with self-testing fixtures, and nothing else.

**Architecture:** An app authors schemas in zod; the *registered artifact* is a JSON Schema snapshot taken at registration and stored under `(appId, manifestVersion)`. That snapshot is what makes REQ-RT-004 an invariant held by data rather than by a module's promise to keep historical schema versions in code (design §4.6). Because `z.toJSONSchema` drops `.refine()` **silently**, a fail-closed guard rejects any app schema carrying a construct that would not survive conversion. Event-type ownership is structural: the namespace prefix (`core.*` vs `<appId>.*`) resolves the owner with no lookup table to desynchronize.

**Tech Stack:** TypeScript 5.7 · zod 4.4.3 · semver 7 · Jest 29 (ts-jest) · pnpm 11 · turbo 2.

**Input design:** `docs/sessions/2026-07-16-sdk-contract-core-design.md` (owner-approved; §4.6 reading of ADR-006 and §1 exclusion of rewards explicitly confirmed by the owner on 2026-07-16).

---

## Global Constraints

Copied from the design, the normative package v1.2, amendment v1.3 and CLAUDE.md. Every task implicitly includes these.

- **Code artifact is `packages/sdk` only.** Core services (App-registry, projection builder, commit pipeline) and identity/room/membership DTOs are **separate plans** — do not create files for them (design §1).
- **SDK is a leaf** — it must not import `packages/core` or any other workspace package; enforced by `.dependency-cruiser.cjs` rule `sdk-is-leaf` (REQ-CTR-002, REQ-CTR-001). New third-party runtime deps are allowed (they are `node_modules`, not workspace packages).
- **zod is the single source of truth for the core contract**; TS types are inferred from schemas, never hand-written in parallel (REQ-CTR-003, ADR-006).
- **Contract payloads are network-shaped and JSON-serializable.** No live objects, functions or ORM models cross the boundary (REQ-CTR-002).
- **Fixtures ship from the package** — `packages/sdk/src/index.ts` exports them; they are mandatory in CI for the core and every module (REQ-CTR-005).
- **No module-level mutable state** — `let`/`var` at program level is an ESLint error (REQ-CORE-004).
- **Typed error codes outward, never messages or stack traces** (REQ-SEC-006).
- **Fail-safe visibility:** an unannotated `appSettings` property is `module-private`; to expose, an author must write it explicitly (REQ-CORE-008, ADR-008).
- **Declared visibility is a ceiling** — REQ-CTR-009 calls it «обязательный (максимально допустимый) уровень видимости»; an event more exposed than its type's ceiling is rejected (design §4.5).
- **No forward scaffolding** (CLAUDE.md §2.3, roadmap): no rewards contract, no `capabilities` manifest field, no replay cursor, no per-level numbering, no second version axis per event type. Extension points are fixed in words, never as empty code.
- **ADR-001…011 are binding**; deviation only via a new ADR in `docs/adr/` before merge (REQ-DEV-004).
- **Session artifacts live in `docs/sessions/`**, never repo root (REQ-DEV-003).
- **One lockfile** at repo root; pnpm only (REQ-DEV-002). Node >= 24, `pnpm@11.1.3`.

---

## Requirements this plan closes

REQ-CTR-002, REQ-CTR-003, REQ-CTR-004, REQ-CTR-005, REQ-CTR-008 (contract surface), REQ-CTR-009 (lattice + ceiling rule), REQ-CORE-005 (levels), REQ-CORE-008 (per-property visibility + fail-safe), REQ-RT-001 (envelope form), REQ-RT-004 (pin key + snapshot), REQ-RT-011(a) per amendment v1.3 (global seq not exposed), REQ-SEC-006 (typed errors).

**Constrained but NOT closed here** — runtime enforcement belongs to later phase-1 plans, which must honour design §7: REQ-CORE-007, REQ-RT-007, REQ-RT-009, REQ-RT-012, REQ-RT-014, REQ-RT-016, REQ-DEV-008.

---

## File Structure

```
packages/sdk/
├── package.json                                  # + semver dep; version = contract version (REQ-CTR-004)
└── src/
    ├── index.ts                                  # public surface: schemas + fixtures (REQ-CTR-005)
    ├── contract-version.ts                       # CONTRACT_VERSION + range satisfaction (REQ-CTR-004)
    ├── contract-version.contract.spec.ts
    ├── errors/
    │   ├── error-codes.ts                        # typed codes + ContractError (REQ-SEC-006, design §8)
    │   └── error-codes.contract.spec.ts
    ├── visibility/
    │   ├── visibility.ts                         # levels + exposure order + ceiling rule (REQ-CORE-005/CTR-009)
    │   ├── visibility.fixtures.ts
    │   └── visibility.contract.spec.ts
    ├── events/
    │   ├── event-type.ts                         # appId/namespace, short names, owner resolution (§4.1)
    │   ├── event-type.contract.spec.ts
    │   ├── log-event.schema.ts                   # internal envelope — EXISTS (phase 0), edited here
    │   ├── log-event.fixtures.ts                 # EXISTS — event types re-namespaced here
    │   ├── log-event.contract.spec.ts            # EXISTS — untouched
    │   ├── projected-event.schema.ts             # outward projection, no seq (§4.3, RT-011a)
    │   ├── projected-event.fixtures.ts
    │   ├── projected-event.contract.spec.ts
    │   ├── core-events.ts                        # core-owned type registry incl. lifecycle (§4.2, RT-010)
    │   └── core-events.contract.spec.ts
    └── manifest/
        ├── manifest.schema.ts                    # zod schema of the manifest (§5, ADR-006)
        ├── manifest.fixtures.ts
        ├── manifest.contract.spec.ts
        ├── app-settings-visibility.ts            # per-property visibility read, fail-safe (REQ-CORE-008)
        ├── app-settings-visibility.contract.spec.ts
        ├── define-app.ts                         # authoring helper + conversion guard (§6)
        ├── define-app.fixtures.ts
        └── define-app.contract.spec.ts
```

> **Design note (three files not in design §10, recorded here for review):** `events/event-type.ts`, `manifest/app-settings-visibility.ts` and the `.fixtures.ts`/`.contract.spec.ts` companions. Design §10 lists the schema surfaces; these carry rules the design states in prose but assigns to no file — §4.1 owner resolution and §5's fail-safe read of `x-visibility`. Both are pure, contract-level rules whose *application* is a core service (design §1 excludes services, not the rules they apply). Putting them in the SDK stops the later core plan from reinventing them behind the boundary, which is exactly how a rule degrades into a convention. Alternative considered: fold them into `visibility.ts` / `core-events.ts` — rejected, it mixes the lattice with manifest-annotation parsing.

---

## Task 1: Visibility lattice with an explicit exposure order

**Files:**
- Create: `packages/sdk/src/visibility/visibility.ts`, `packages/sdk/src/visibility/visibility.fixtures.ts`, `packages/sdk/src/visibility/visibility.contract.spec.ts`
- Modify: `packages/sdk/src/events/log-event.schema.ts` (drop the visibility declarations, import them), `packages/sdk/src/index.ts`

**Interfaces:**
- Produces: `VISIBILITY_LEVELS`, `visibilitySchema`, `Visibility`, `exposureRank(v: Visibility): number`, `isWithinCeiling(actual: Visibility, ceiling: Visibility): boolean`, `DEFAULT_VISIBILITY: Visibility`.
- Consumes: nothing.
- Note: `VISIBILITY_LEVELS`/`visibilitySchema`/`Visibility` move out of `log-event.schema.ts`. Nothing outside `packages/sdk` imports them today (verified), and `index.ts` keeps re-exporting them, so the package's public surface is unchanged.

- [ ] **Step 1: Write the failing test** — `packages/sdk/src/visibility/visibility.fixtures.ts`

```ts
import type { Visibility } from './visibility';

// The ceiling rule of REQ-CTR-009: the level declared for a type is the MAXIMUM
// allowed exposure. Equal or better-protected passes; more exposed is rejected.
export const ceilingCases: {
  name: string;
  actual: Visibility;
  ceiling: Visibility;
  within: boolean;
}[] = [
  { name: 'public under a public ceiling', actual: 'public', ceiling: 'public', within: true },
  { name: 'organizer under a public ceiling', actual: 'organizer', ceiling: 'public', within: true },
  { name: 'module-private under a public ceiling', actual: 'module-private', ceiling: 'public', within: true },
  { name: 'public under an organizer ceiling', actual: 'public', ceiling: 'organizer', within: false },
  { name: 'organizer under an organizer ceiling', actual: 'organizer', ceiling: 'organizer', within: true },
  { name: 'module-private under an organizer ceiling', actual: 'module-private', ceiling: 'organizer', within: true },
  { name: 'public under a module-private ceiling', actual: 'public', ceiling: 'module-private', within: false },
  { name: 'organizer under a module-private ceiling', actual: 'organizer', ceiling: 'module-private', within: false },
  { name: 'module-private under a module-private ceiling', actual: 'module-private', ceiling: 'module-private', within: true },
];
```

`packages/sdk/src/visibility/visibility.contract.spec.ts`:

```ts
import {
  VISIBILITY_LEVELS,
  visibilitySchema,
  exposureRank,
  isWithinCeiling,
  DEFAULT_VISIBILITY,
} from './visibility';
import { ceilingCases } from './visibility.fixtures';

describe('visibility contract', () => {
  it('declares exactly the three levels of REQ-CORE-005', () => {
    expect([...VISIBILITY_LEVELS]).toEqual(['public', 'organizer', 'module-private']);
  });

  it('rejects an unknown level', () => {
    expect(visibilitySchema.safeParse('secret').success).toBe(false);
  });

  it('orders levels by exposure: public > organizer > module-private', () => {
    expect(exposureRank('public')).toBeGreaterThan(exposureRank('organizer'));
    expect(exposureRank('organizer')).toBeGreaterThan(exposureRank('module-private'));
  });

  it.each(ceilingCases.map((c) => [c.name, c.actual, c.ceiling, c.within] as const))(
    'ceiling rule: %s',
    (_name, actual, ceiling, within) => {
      expect(isWithinCeiling(actual, ceiling)).toBe(within);
    },
  );

  it('defaults to the most protected level (fail-safe, ADR-008)', () => {
    expect(DEFAULT_VISIBILITY).toBe('module-private');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk exec jest src/visibility -v`
Expected: FAIL — `Cannot find module './visibility'`.

- [ ] **Step 3: Write the implementation** — `packages/sdk/src/visibility/visibility.ts`

```ts
import { z } from 'zod';

// Visibility levels of room state, log events and appSettings (REQ-CORE-005).
export const VISIBILITY_LEVELS = ['public', 'organizer', 'module-private'] as const;
export const visibilitySchema = z.enum(VISIBILITY_LEVELS);
export type Visibility = z.infer<typeof visibilitySchema>;

// Exposure lattice: public > organizer > module-private. Written down explicitly
// because REQ-CTR-009 has nothing to enforce without an order (design §4.5).
const EXPOSURE_RANK: Record<Visibility, number> = {
  public: 2,
  organizer: 1,
  'module-private': 0,
};

export const exposureRank = (level: Visibility): number => EXPOSURE_RANK[level];

// A declared level is a CEILING: REQ-CTR-009 calls it the maximum allowed level and
// rejects an event whose actual visibility is weaker (= more exposed) than declared.
export const isWithinCeiling = (actual: Visibility, ceiling: Visibility): boolean =>
  EXPOSURE_RANK[actual] <= EXPOSURE_RANK[ceiling];

// Fail-safe default for an unannotated appSettings property (REQ-CORE-008, ADR-008):
// to leak, an author must write `public` explicitly — forgetting closes, never opens.
export const DEFAULT_VISIBILITY: Visibility = 'module-private';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/sdk exec jest src/visibility -v`
Expected: PASS — 13 tests.

- [ ] **Step 5: Point the log-event envelope at the new home** — `packages/sdk/src/events/log-event.schema.ts`

```ts
import { z } from 'zod';
import { visibilitySchema } from '../visibility/visibility';

// Append-only log event envelope (form of REQ-RT-001). seq is server-assigned;
// actorId is null only for system/lifecycle events.
// Internal to the core↔module contract: it carries seq and MUST NOT be sent to a
// client — the outward form is projectedEventSchema (design §4.3, REQ-RT-011a).
export const logEventSchema = z.object({
  roomId: z.uuid(),
  seq: z.number().int().nonnegative(),
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  actorId: z.uuid().nullable(),
  visibility: visibilitySchema,
  schemaVersion: z.number().int().positive(),
});
export type LogEvent = z.infer<typeof logEventSchema>;
```

- [ ] **Step 6: Re-export from the package surface** — `packages/sdk/src/index.ts`

```ts
export * from './visibility/visibility';
export * from './events/log-event.schema';
export * from './events/log-event.fixtures';
```

- [ ] **Step 7: Run the whole package to prove nothing regressed**

Run: `pnpm --filter @mymozhem/sdk test && pnpm --filter @mymozhem/sdk run typecheck`
Expected: PASS — the phase-0 `log-event.contract.spec.ts` still green; no TS errors (it imports `Visibility` indirectly).

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/src/visibility packages/sdk/src/events/log-event.schema.ts packages/sdk/src/index.ts
git commit -m "feat(sdk): visibility lattice with explicit exposure ceiling (REQ-CORE-005, REQ-CTR-009)"
```

---

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

## Task 3: Event-type namespace and structural owner resolution

**Files:**
- Create: `packages/sdk/src/events/event-type.ts`, `packages/sdk/src/events/event-type.contract.spec.ts`
- Modify: `packages/sdk/src/events/log-event.schema.ts` (use `eventTypeSchema`), `packages/sdk/src/events/log-event.fixtures.ts` (re-namespace types), `packages/sdk/src/index.ts`

**Interfaces:**
- Produces: `appIdSchema`, `AppId`, `CORE_NAMESPACE = 'core'`, `shortEventNameSchema`, `eventTypeSchema`, `composeEventType(namespace, shortName): string`, `resolveTypeOwner(type): TypeOwner`, `type TypeOwner = { kind: 'core'; shortName: string } | { kind: 'app'; appId: AppId; shortName: string }`.
- Consumes: `ContractError` (Task 2).

> **Design note (fixture correction):** the phase-0 fixture `log-event.fixtures.ts` uses the event type `room.created`. Under §4.1 that parses as an app named `room` owning the type — it contradicts the ownership rule the same package now exports. It is re-namespaced to `core.room.activated` here. Not cosmetic: a fixture that its own rule would misread is worse than no fixture.

- [ ] **Step 1: Write the failing test** — `packages/sdk/src/events/event-type.contract.spec.ts`

```ts
import {
  CORE_NAMESPACE,
  appIdSchema,
  composeEventType,
  eventTypeSchema,
  resolveTypeOwner,
  shortEventNameSchema,
} from './event-type';
import { ContractError } from '../errors/error-codes';

describe('event type ownership', () => {
  it.each(['core.room.activated', 'quiz.answer_scored', 'quiz.answer.submitted'])(
    'accepts a namespaced type: %s',
    (type) => {
      expect(eventTypeSchema.safeParse(type).success).toBe(true);
    },
  );

  it.each(['nodot', 'core.', '.leading', 'Quiz.Answer', 'quiz..double'])(
    'rejects a malformed type: %s',
    (type) => {
      expect(eventTypeSchema.safeParse(type).success).toBe(false);
    },
  );

  it('resolves the core namespace to the core', () => {
    expect(resolveTypeOwner('core.room.activated')).toEqual({
      kind: 'core',
      shortName: 'room.activated',
    });
  });

  it('resolves any other namespace to the app that owns it', () => {
    expect(resolveTypeOwner('quiz.answer.submitted')).toEqual({
      kind: 'app',
      appId: 'quiz',
      shortName: 'answer.submitted',
    });
  });

  it('rejects an unresolvable type with a typed error', () => {
    expect(() => resolveTypeOwner('nodot')).toThrow(ContractError);
    try {
      resolveTypeOwner('nodot');
    } catch (err) {
      expect((err as ContractError).code).toBe('EVENT_UNKNOWN_TYPE');
    }
  });

  // §4.1: an app declares SHORT names; the core prefixes the namespace itself.
  // Forging a foreign namespace must be inexpressible, not merely forbidden.
  it('gives an app no way to declare into the core namespace', () => {
    expect(shortEventNameSchema.safeParse('room.activated').success).toBe(true);
    expect(composeEventType('quiz', 'room.activated')).toBe('quiz.room.activated');
    expect(resolveTypeOwner(composeEventType('quiz', 'room.activated')).kind).toBe('app');
  });

  it('reserves the core namespace against an app claiming it as its appId', () => {
    expect(appIdSchema.safeParse(CORE_NAMESPACE).success).toBe(false);
    expect(appIdSchema.safeParse('quiz').success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk exec jest src/events/event-type -v`
Expected: FAIL — `Cannot find module './event-type'`.

- [ ] **Step 3: Write the implementation** — `packages/sdk/src/events/event-type.ts`

```ts
import { z } from 'zod';
import { ContractError } from '../errors/error-codes';

// The namespace owned by the core (design §4.1).
export const CORE_NAMESPACE = 'core';

// appId is a slug and, at the same time, the app's event namespace (design §5).
// `core` is refused so that an app cannot obtain the core namespace by naming itself.
export const appIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, 'appId must be a lowercase slug')
  .refine((id) => id !== CORE_NAMESPACE, { message: 'appId "core" is reserved' });
export type AppId = z.infer<typeof appIdSchema>;

// A short name as declared in a registry. Dots are allowed (`answer.submitted`):
// they cannot forge a namespace, because the owner prefix is prepended
// unconditionally by composeEventType.
export const shortEventNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$/, 'short event name must be a dotted lowercase path');

// A fully-qualified event type: `<namespace>.<short name>`.
export const eventTypeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$/, 'event type must be namespaced');

export const composeEventType = (namespace: string, shortName: string): string =>
  `${namespace}.${shortName}`;

export type TypeOwner =
  | { kind: 'core'; shortName: string }
  | { kind: 'app'; appId: AppId; shortName: string };

// Ownership is resolved by parsing the name — no lookup table that could drift out
// of sync with the registry (design §4.1).
export const resolveTypeOwner = (type: string): TypeOwner => {
  if (!eventTypeSchema.safeParse(type).success) {
    throw new ContractError('EVENT_UNKNOWN_TYPE', `event type "${type}" is not namespaced`);
  }

  const separator = type.indexOf('.');
  const namespace = type.slice(0, separator);
  const shortName = type.slice(separator + 1);

  if (namespace === CORE_NAMESPACE) {
    return { kind: 'core', shortName };
  }

  const appId = appIdSchema.safeParse(namespace);
  if (!appId.success) {
    throw new ContractError('EVENT_UNKNOWN_TYPE', `event type "${type}" has no resolvable owner`);
  }

  return { kind: 'app', appId: appId.data, shortName };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/sdk exec jest src/events/event-type -v`
Expected: PASS — 13 tests.

- [ ] **Step 5: Tighten the envelope's type field** — in `packages/sdk/src/events/log-event.schema.ts`, import `eventTypeSchema` and replace the `type` line

```ts
import { z } from 'zod';
import { visibilitySchema } from '../visibility/visibility';
import { eventTypeSchema } from './event-type';
```

and inside `logEventSchema`, replace `type: z.string().min(1),` with:

```ts
  type: eventTypeSchema,
```

- [ ] **Step 6: Re-namespace the phase-0 fixtures** — `packages/sdk/src/events/log-event.fixtures.ts`, change the `type` of both valid fixtures and add an invalid case

```ts
import type { LogEvent } from './log-event.schema';

export const validLogEvents: LogEvent[] = [
  {
    roomId: '11111111-1111-4111-8111-111111111111',
    seq: 0,
    type: 'core.room.activated',
    payload: { appId: 'quiz', manifestVersion: 1 },
    actorId: null,
    visibility: 'public',
    schemaVersion: 1,
  },
  {
    roomId: '11111111-1111-4111-8111-111111111111',
    seq: 1,
    type: 'quiz.answer_scored',
    payload: { correct: true },
    actorId: '22222222-2222-4222-8222-222222222222',
    visibility: 'module-private',
    schemaVersion: 1,
  },
];

export const invalidLogEventCases: { name: string; value: unknown }[] = [
  {
    name: 'unknown visibility level',
    value: { ...validLogEvents[0], visibility: 'secret' },
  },
  {
    name: 'missing seq',
    value: (() => {
      const { seq, ...rest } = validLogEvents[0];
      void seq;
      return rest;
    })(),
  },
  {
    name: 'negative seq',
    value: { ...validLogEvents[0], seq: -1 },
  },
  {
    name: 'non-uuid roomId',
    value: { ...validLogEvents[0], roomId: 'not-a-uuid' },
  },
  {
    name: 'event type without an owning namespace',
    value: { ...validLogEvents[0], type: 'created' },
  },
];
```

- [ ] **Step 7: Run the package and export the surface**

Add to `packages/sdk/src/index.ts` (after the visibility line):

```ts
export * from './events/event-type';
```

Run: `pnpm --filter @mymozhem/sdk test`
Expected: PASS — both `event-type.contract.spec.ts` and the phase-0 `log-event.contract.spec.ts` green, the latter now with 5 invalid cases.

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/src/events packages/sdk/src/index.ts
git commit -m "feat(sdk): structural event-type ownership by namespace (REQ-CTR-008, ADR-002)"
```

---

## Task 4: Outward projection envelope without seq

**Files:**
- Create: `packages/sdk/src/events/projected-event.schema.ts`, `packages/sdk/src/events/projected-event.fixtures.ts`, `packages/sdk/src/events/projected-event.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`

**Interfaces:**
- Produces: `projectedEventSchema`, `ProjectedEvent`, `validProjectedEvents`, `invalidProjectedEventCases`.
- Consumes: `eventTypeSchema` (Task 3), `LogEvent` (phase 0).

> **Design note (`strictObject`, recorded for review):** the projection is a strict object, so an extra key is **rejected** rather than stripped. Verified on zod 4.4.3: a plain `z.object` silently strips `seq` from `{...logEvent}` and returns a clean projection — the leak is prevented but the bug survives and the next field added to the envelope may not be stripped so kindly. The realistic defect here is a core handler spreading a whole `LogEvent` into the projection; strict makes that a loud failure at the seam. It is also fail-closed in the REQ-DEV-008 sense: refusing to answer beats answering with metadata RT-011(a) forbids.

- [ ] **Step 1: Write the failing test** — `packages/sdk/src/events/projected-event.fixtures.ts`

```ts
import type { LogEvent } from './log-event.schema';
import type { ProjectedEvent } from './projected-event.schema';

export const validProjectedEvents: ProjectedEvent[] = [
  {
    type: 'core.room.activated',
    payload: { appId: 'quiz', manifestVersion: 1 },
    actorId: null,
  },
  {
    type: 'quiz.answer.submitted',
    payload: { roundId: 'r1', choice: 2 },
    actorId: '22222222-2222-4222-8222-222222222222',
  },
];

// The internal envelope a careless handler might hand to a client verbatim.
const internalLogEvent: LogEvent = {
  roomId: '11111111-1111-4111-8111-111111111111',
  seq: 42,
  type: 'quiz.answer.submitted',
  payload: { roundId: 'r1', choice: 2 },
  actorId: '22222222-2222-4222-8222-222222222222',
  visibility: 'public',
  schemaVersion: 1,
};

export const invalidProjectedEventCases: { name: string; value: unknown }[] = [
  {
    name: 'whole log envelope spread outward (leaks seq — REQ-RT-011a)',
    value: internalLogEvent,
  },
  {
    name: 'seq smuggled onto an otherwise clean projection',
    value: { ...validProjectedEvents[0], seq: 0 },
  },
  {
    name: 'visibility label sent outward',
    value: { ...validProjectedEvents[0], visibility: 'public' },
  },
  {
    name: 'replay cursor sent outward (no cursor exists in MVP — design §4.4)',
    value: { ...validProjectedEvents[0], cursor: 'eyJzZXEiOjQyfQ==' },
  },
  {
    name: 'event type without an owning namespace',
    value: { ...validProjectedEvents[0], type: 'activated' },
  },
];
```

`packages/sdk/src/events/projected-event.contract.spec.ts`:

```ts
import { projectedEventSchema } from './projected-event.schema';
import {
  invalidProjectedEventCases,
  validProjectedEvents,
} from './projected-event.fixtures';

describe('projectedEvent contract', () => {
  it.each(validProjectedEvents.map((e, i) => [i, e] as const))(
    'accepts valid fixture #%i',
    (_i, event) => {
      expect(projectedEventSchema.safeParse(event).success).toBe(true);
    },
  );

  it.each(invalidProjectedEventCases.map((c) => [c.name, c.value] as const))(
    'rejects invalid fixture: %s',
    (_name, value) => {
      expect(projectedEventSchema.safeParse(value).success).toBe(false);
    },
  );

  // REQ-RT-011(a) per amendment v1.3: the global seq is never exposed to a
  // participant. It holds structurally — the field is not in the schema at all.
  it('has no seq, visibility or cursor field to expose', () => {
    const keys = Object.keys(projectedEventSchema.shape);
    expect(keys.sort()).toEqual(['actorId', 'payload', 'type']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk exec jest src/events/projected-event -v`
Expected: FAIL — `Cannot find module './projected-event.schema'`.

- [ ] **Step 3: Write the implementation** — `packages/sdk/src/events/projected-event.schema.ts`

```ts
import { z } from 'zod';
import { eventTypeSchema } from './event-type';

// What actually leaves the core towards a client (design §4.3).
//
// No seq, no visibility, no cursor: REQ-RT-011(a) — «глобальный seq не
// экспонируется участнику» — holds structurally, because none of those values
// exist in this shape to be exposed. The MVP has no replay cursor at all
// (design §4.4): replay returns the full visible projection.
//
// strictObject, not object: an extra key is a core bug, and a loud rejection beats
// a silent strip that leaves the bug alive.
export const projectedEventSchema = z.strictObject({
  type: eventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  actorId: z.uuid().nullable(),
});
export type ProjectedEvent = z.infer<typeof projectedEventSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/sdk exec jest src/events/projected-event -v`
Expected: PASS — 8 tests.

- [ ] **Step 5: Export from the package surface** — add to `packages/sdk/src/index.ts`

```ts
export * from './events/projected-event.schema';
export * from './events/projected-event.fixtures';
```

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/events packages/sdk/src/index.ts
git commit -m "feat(sdk): outward projection envelope carries no seq (REQ-RT-001, REQ-RT-011)"
```

---

## Task 5: Core-owned event registry with lifecycle events

**Files:**
- Create: `packages/sdk/src/events/core-events.ts`, `packages/sdk/src/events/core-events.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`

**Interfaces:**
- Produces: `type EventTypeDefinition = { schema: z.ZodType; visibility: Visibility; version: number }`, `CORE_EVENTS`, `CoreEventName`, `coreEventType(name: CoreEventName): string`, `isCoreEventName(name: string): name is CoreEventName`.
- Consumes: `Visibility` (Task 1), `appIdSchema`, `CORE_NAMESPACE`, `composeEventType` (Task 3).

> **Design note (scope of the lifecycle set, recorded for review):** the event set is derived from REQ-RT-005 — the state machine is `DRAFT → ACTIVE → COMPLETED`, `DRAFT → CANCELLED`, `ACTIVE → CANCELLED`, so the transitions are exactly *activated / completed / cancelled*, each `public` per REQ-RT-010. There is deliberately **no** `core.room.created`: creation puts a room in DRAFT and is not a transition, so REQ-RT-010 does not mandate it. Whether the log needs a genesis event is a Room-domain question for the Room plan, and a new registry entry is additive. Payloads are kept minimal for the same reason; `room.activated` carries the pin `(appId, manifestVersion)` because that is precisely what ACTIVE freezes (REQ-RT-004) and it keeps the log self-describing without a join to the room (design §4.2, relevant to REQ-RT-008 archival).

- [ ] **Step 1: Write the failing test** — `packages/sdk/src/events/core-events.contract.spec.ts`

```ts
import { CORE_EVENTS, coreEventType, isCoreEventName } from './core-events';
import { resolveTypeOwner } from './event-type';
import { isWithinCeiling } from '../visibility/visibility';

describe('core event registry', () => {
  it('registers exactly the lifecycle transitions of REQ-RT-005', () => {
    expect(Object.keys(CORE_EVENTS).sort()).toEqual([
      'room.activated',
      'room.cancelled',
      'room.completed',
    ]);
  });

  // REQ-RT-010: lifecycle transitions are emitted as public events.
  it.each(Object.keys(CORE_EVENTS))('declares %s public (REQ-RT-010)', (name) => {
    expect(CORE_EVENTS[name as keyof typeof CORE_EVENTS].visibility).toBe('public');
  });

  it('composes full types inside the core namespace, owned by the core', () => {
    expect(coreEventType('room.activated')).toBe('core.room.activated');
    expect(resolveTypeOwner(coreEventType('room.activated'))).toEqual({
      kind: 'core',
      shortName: 'room.activated',
    });
  });

  it('recognises its own short names and nothing else', () => {
    expect(isCoreEventName('room.activated')).toBe(true);
    expect(isCoreEventName('answer.submitted')).toBe(false);
  });

  // REQ-RT-004: ACTIVE freezes the pin, so the activation event carries it.
  it('validates the activation payload as the pin (appId, manifestVersion)', () => {
    const schema = CORE_EVENTS['room.activated'].schema;
    expect(schema.safeParse({ appId: 'quiz', manifestVersion: 1 }).success).toBe(true);
    expect(schema.safeParse({ appId: 'quiz' }).success).toBe(false);
    expect(schema.safeParse({ appId: 'core', manifestVersion: 1 }).success).toBe(false);
    expect(schema.safeParse({ appId: 'quiz', manifestVersion: 0 }).success).toBe(false);
  });

  it('rejects payload on the terminal transitions', () => {
    expect(CORE_EVENTS['room.completed'].schema.safeParse({}).success).toBe(true);
    expect(CORE_EVENTS['room.completed'].schema.safeParse({ reason: 'x' }).success).toBe(false);
  });

  it('declares a positive schemaVersion for every type', () => {
    for (const def of Object.values(CORE_EVENTS)) {
      expect(def.version).toBeGreaterThan(0);
    }
  });

  // The registry's ceiling is what REQ-CTR-009 enforces at commit time; a public
  // ceiling admits any level, which is what a lifecycle event needs.
  it('admits its own declared level under its own ceiling', () => {
    for (const def of Object.values(CORE_EVENTS)) {
      expect(isWithinCeiling(def.visibility, def.visibility)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk exec jest src/events/core-events -v`
Expected: FAIL — `Cannot find module './core-events'`.

- [ ] **Step 3: Write the implementation** — `packages/sdk/src/events/core-events.ts`

```ts
import { z } from 'zod';
import type { Visibility } from '../visibility/visibility';
import { CORE_NAMESPACE, appIdSchema, composeEventType } from './event-type';

// Shape shared by the core registry and the app registry in a manifest, so that the
// commit pipeline differs only in WHERE the registry comes from, not in its logic
// (design §4.2). `visibility` is the exposure ceiling of the type (REQ-CTR-009);
// `version` is what the core stamps as the event's schemaVersion.
export type EventTypeDefinition = {
  readonly schema: z.ZodType;
  readonly visibility: Visibility;
  readonly version: number;
};

// Core-owned event types. Static zod, with no conversion and no snapshot: the core
// is versioned by the contract rather than by a manifest, and these schemas never
// cross the boundary (design §4.2).
//
// The set is the lifecycle transitions of REQ-RT-005 (DRAFT → ACTIVE → COMPLETED,
// DRAFT → CANCELLED, ACTIVE → CANCELLED), emitted as public events per REQ-RT-010.
export const CORE_EVENTS = {
  'room.activated': {
    // ACTIVE freezes appSettings and the pair (appId, manifestVersion) — REQ-RT-004.
    // Carrying the pin keeps the log self-describing without a join to the room.
    schema: z.strictObject({
      appId: appIdSchema,
      manifestVersion: z.number().int().positive(),
    }),
    visibility: 'public',
    version: 1,
  },
  'room.completed': {
    schema: z.strictObject({}),
    visibility: 'public',
    version: 1,
  },
  'room.cancelled': {
    schema: z.strictObject({}),
    visibility: 'public',
    version: 1,
  },
} as const satisfies Record<string, EventTypeDefinition>;

export type CoreEventName = keyof typeof CORE_EVENTS;

export const coreEventType = (name: CoreEventName): string =>
  composeEventType(CORE_NAMESPACE, name);

export const isCoreEventName = (name: string): name is CoreEventName =>
  Object.prototype.hasOwnProperty.call(CORE_EVENTS, name);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/sdk exec jest src/events/core-events -v`
Expected: PASS — 11 tests.

- [ ] **Step 5: Export from the package surface** — add to `packages/sdk/src/index.ts`

```ts
export * from './events/core-events';
```

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/events packages/sdk/src/index.ts
git commit -m "feat(sdk): core event registry with public lifecycle events (REQ-RT-010, REQ-RT-005)"
```

---

## Task 6: Contract version and range satisfaction

**Files:**
- Create: `packages/sdk/src/contract-version.ts`, `packages/sdk/src/contract-version.contract.spec.ts`
- Modify: `packages/sdk/package.json` (version + `semver` dependency), `packages/sdk/src/index.ts`

**Interfaces:**
- Produces: `CONTRACT_VERSION: string`, `isContractRangeSatisfied(range: string): boolean`, `assertContractRangeSatisfied(range: string): void`.
- Consumes: `ContractError` (Task 2).

> **Design note (version number, recorded for review):** `CONTRACT_VERSION` starts at **`1.0.0`**, and `packages/sdk/package.json` moves from `0.0.0` to match, because REQ-CTR-004 states «Версия SDK = версия контракта». `1.0.0` rather than `0.1.0` so that caret ranges behave as authors expect — under semver, `^0.1.0` admits only patches, which would make every additive contract change look breaking to a manifest. Publishing 1.0.0 is not a stability claim: it is the axis on which REQ-CTR-004 compatibility is computed, and breaking changes go to 2.0.0. `@mymozhem/core` and `@mymozhem/server` stay at `0.0.0` — their versions carry no contract meaning.

- [ ] **Step 1: Add the semver dependency**

Run: `pnpm --filter @mymozhem/sdk add semver && pnpm --filter @mymozhem/sdk add -D @types/semver`
Expected: completes; `packages/sdk/package.json` gains `"semver"` under `dependencies` and `"@types/semver"` under `devDependencies`; the only lockfile changed is the root `pnpm-lock.yaml` (REQ-DEV-002).

Run: `git status --short`
Expected: no lockfile under `packages/`; only `pnpm-lock.yaml` at root.

- [ ] **Step 2: Set the package version to the contract version** — in `packages/sdk/package.json`

```json
  "version": "1.0.0",
```

- [ ] **Step 3: Write the failing test** — `packages/sdk/src/contract-version.contract.spec.ts`

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { valid } from 'semver';
import {
  CONTRACT_VERSION,
  assertContractRangeSatisfied,
  isContractRangeSatisfied,
} from './contract-version';
import { ContractError } from './errors/error-codes';

describe('contract version', () => {
  it('is a valid semver version', () => {
    expect(valid(CONTRACT_VERSION)).not.toBeNull();
  });

  // REQ-CTR-004: "Версия SDK = версия контракта". Two sources of the same truth
  // drift; this test is what keeps them one.
  it('equals the SDK package version', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
    ) as { version: string };
    expect(pkg.version).toBe(CONTRACT_VERSION);
  });

  it.each(['^1.0.0', '>=1.0.0 <2.0.0', '1.x'])('accepts a compatible range: %s', (range) => {
    expect(isContractRangeSatisfied(range)).toBe(true);
  });

  it.each(['^2.0.0', '>=1.5.0', '0.9.x'])('rejects an incompatible range: %s', (range) => {
    expect(isContractRangeSatisfied(range)).toBe(false);
  });

  it.each(['garbage!!', '', 'not-a-range'])('rejects a malformed range: %s', (range) => {
    expect(isContractRangeSatisfied(range)).toBe(false);
  });

  it('asserts with a typed error the core can return outward', () => {
    expect(() => assertContractRangeSatisfied('^1.0.0')).not.toThrow();
    try {
      assertContractRangeSatisfied('^2.0.0');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ContractError);
      expect((err as ContractError).code).toBe('CONTRACT_VERSION_INCOMPATIBLE');
    }
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk exec jest src/contract-version -v`
Expected: FAIL — `Cannot find module './contract-version'`.

- [ ] **Step 5: Write the implementation** — `packages/sdk/src/contract-version.ts`

```ts
import { satisfies, validRange } from 'semver';
import { ContractError } from './errors/error-codes';

// The version of the core↔module contract. REQ-CTR-004: the SDK version IS the
// contract version — packages/sdk/package.json is kept equal to this by a contract
// test. Versioning from day one is the enforcement mechanism of the boundary, not
// preparation for a future consumer (ADR-002).
export const CONTRACT_VERSION = '1.0.0';

// A manifest declares the range of contract versions it is compatible with; the
// core checks it at registration (REQ-CTR-004). A malformed range is not satisfied —
// it never silently passes as "no constraint".
export const isContractRangeSatisfied = (range: string): boolean =>
  validRange(range) !== null && satisfies(CONTRACT_VERSION, range);

// Exported so the registration service in the later core plan cannot express this
// check any other way than with the typed error the norm requires.
export const assertContractRangeSatisfied = (range: string): void => {
  if (!isContractRangeSatisfied(range)) {
    throw new ContractError(
      'CONTRACT_VERSION_INCOMPATIBLE',
      `manifest requires contract range "${range}", core provides ${CONTRACT_VERSION}`,
    );
  }
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/sdk exec jest src/contract-version -v`
Expected: PASS — 12 tests.

- [ ] **Step 7: Export and check the boundary still holds**

Add to `packages/sdk/src/index.ts`, as the first line:

```ts
export * from './contract-version';
```

Run: `pnpm run boundary-check`
Expected: no violations — `semver` is a `node_modules` dependency, so `sdk-is-leaf` is unaffected.

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/package.json packages/sdk/src/contract-version.ts packages/sdk/src/contract-version.contract.spec.ts packages/sdk/src/index.ts pnpm-lock.yaml
git commit -m "feat(sdk): contract version = SDK version, with range satisfaction (REQ-CTR-004)"
```

---

## Task 7: Manifest schema

**Files:**
- Create: `packages/sdk/src/manifest/manifest.schema.ts`, `packages/sdk/src/manifest/manifest.fixtures.ts`, `packages/sdk/src/manifest/manifest.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`

**Interfaces:**
- Produces: `jsonSchemaObjectSchema`, `JsonSchemaObject`, `contractRangeSchema`, `manifestEventSchema`, `appManifestSchema`, `AppManifest`, `validManifests`, `invalidManifestCases`.
- Consumes: `visibilitySchema` (Task 1), `appIdSchema`, `shortEventNameSchema` (Task 3).

- [ ] **Step 1: Write the failing test** — `packages/sdk/src/manifest/manifest.fixtures.ts`

```ts
import type { AppManifest } from './manifest.schema';

export const validManifests: AppManifest[] = [
  {
    appId: 'quiz',
    manifestVersion: 1,
    contractRange: '^1.0.0',
    appSettings: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        title: { type: 'string', 'x-visibility': 'public' },
        correctAnswers: { type: 'array', items: { type: 'number' } },
      },
      required: ['title', 'correctAnswers'],
      additionalProperties: false,
    },
    events: {
      'answer.submitted': {
        schema: {
          type: 'object',
          properties: { roundId: { type: 'string' }, choice: { type: 'number' } },
          required: ['roundId', 'choice'],
          additionalProperties: false,
        },
        visibility: 'module-private',
      },
      'round.opened': {
        schema: { type: 'object', properties: {}, additionalProperties: false },
        visibility: 'public',
      },
    },
  },
];

export const invalidManifestCases: { name: string; value: unknown }[] = [
  {
    name: 'appId is not a slug',
    value: { ...validManifests[0], appId: 'Quiz App' },
  },
  {
    name: 'appId claims the reserved core namespace',
    value: { ...validManifests[0], appId: 'core' },
  },
  {
    name: 'manifestVersion is not a positive integer',
    value: { ...validManifests[0], manifestVersion: 0 },
  },
  {
    name: 'contractRange is not a semver range',
    value: { ...validManifests[0], contractRange: 'whatever' },
  },
  {
    name: 'event short name would forge a namespace',
    value: {
      ...validManifests[0],
      events: { 'Bad.Key!': { schema: { type: 'object' }, visibility: 'public' } },
    },
  },
  {
    name: 'event declares an unknown visibility ceiling',
    value: {
      ...validManifests[0],
      events: { 'answer.submitted': { schema: { type: 'object' }, visibility: 'secret' } },
    },
  },
  {
    name: 'event definition misses its visibility ceiling (REQ-CTR-009 makes it mandatory)',
    value: {
      ...validManifests[0],
      events: { 'answer.submitted': { schema: { type: 'object' } } },
    },
  },
  {
    name: 'manifest carries a capabilities field (rewards is phase 3 — design §5)',
    value: { ...validManifests[0], capabilities: ['rewards'] },
  },
];
```

`packages/sdk/src/manifest/manifest.contract.spec.ts`:

```ts
import { appManifestSchema, contractRangeSchema } from './manifest.schema';
import { invalidManifestCases, validManifests } from './manifest.fixtures';

describe('app manifest contract', () => {
  it.each(validManifests.map((m, i) => [i, m] as const))(
    'accepts valid fixture #%i',
    (_i, manifest) => {
      expect(appManifestSchema.safeParse(manifest).success).toBe(true);
    },
  );

  it.each(invalidManifestCases.map((c) => [c.name, c.value] as const))(
    'rejects invalid fixture: %s',
    (_name, value) => {
      expect(appManifestSchema.safeParse(value).success).toBe(false);
    },
  );

  it('accepts any well-formed semver range and refuses nonsense', () => {
    expect(contractRangeSchema.safeParse('^1.0.0').success).toBe(true);
    expect(contractRangeSchema.safeParse('>=1.0.0 <2.0.0').success).toBe(true);
    expect(contractRangeSchema.safeParse('garbage!!').success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk exec jest src/manifest/manifest -v`
Expected: FAIL — `Cannot find module './manifest.schema'`.

- [ ] **Step 3: Write the implementation** — `packages/sdk/src/manifest/manifest.schema.ts`

```ts
import { z } from 'zod';
import { validRange } from 'semver';
import { visibilitySchema } from '../visibility/visibility';
import { appIdSchema, shortEventNameSchema } from '../events/event-type';

// A serialized JSON Schema as carried inside the manifest. ADR-006: the settings and
// event-type schemas of a given app "переносятся как сериализуемая JSON Schema
// внутри манифеста". Deliberately structural rather than a full JSON Schema
// meta-schema: authoring correctness is guaranteed upstream by defineApp, which is
// the only sanctioned way to produce one.
export const jsonSchemaObjectSchema = z.record(z.string(), z.unknown());
export type JsonSchemaObject = z.infer<typeof jsonSchemaObjectSchema>;

// NB for a future reader: .refine() is legal HERE. The guard in define-app.ts bans
// refinements only in APP-AUTHORED schemas, because those get converted to JSON
// Schema and the refinement would vanish silently. This schema is core-owned zod and
// is never converted — there is nothing to lose. Do not "fix" this.
export const contractRangeSchema = z
  .string()
  .refine((range) => validRange(range) !== null, { message: 'not a valid semver range' });

// Per-type exposure ceiling is mandatory (REQ-CTR-009, ADR-008 §2).
export const manifestEventSchema = z.strictObject({
  schema: jsonSchemaObjectSchema,
  visibility: visibilitySchema,
});

// The manifest (design §5). strictObject: an unknown field is refused rather than
// ignored — notably `capabilities`, which ADR-003 will introduce for rewards in
// phase 3 and which must not appear as empty scaffolding now (CLAUDE.md §2.3).
export const appManifestSchema = z.strictObject({
  appId: appIdSchema,
  manifestVersion: z.number().int().positive(),
  contractRange: contractRangeSchema,
  appSettings: jsonSchemaObjectSchema,
  events: z.record(shortEventNameSchema, manifestEventSchema),
});
export type AppManifest = z.infer<typeof appManifestSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/sdk exec jest src/manifest/manifest -v`
Expected: PASS — 12 tests.

- [ ] **Step 5: Export from the package surface** — add to `packages/sdk/src/index.ts`

```ts
export * from './manifest/manifest.schema';
export * from './manifest/manifest.fixtures';
```

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/manifest packages/sdk/src/index.ts
git commit -m "feat(sdk): app manifest schema with per-type visibility ceiling (REQ-CTR-004, REQ-CTR-009, ADR-006)"
```

---

## Task 8: Per-property appSettings visibility, fail-safe

**Files:**
- Create: `packages/sdk/src/manifest/app-settings-visibility.ts`, `packages/sdk/src/manifest/app-settings-visibility.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`

**Interfaces:**
- Produces: `VISIBILITY_ANNOTATION = 'x-visibility'`, `readPropertyVisibility(appSettings: JsonSchemaObject, property: string): Visibility`, `appSettingsVisibilityMap(appSettings: JsonSchemaObject): Record<string, Visibility>`, `assertVisibilityAnnotations(appSettings: JsonSchemaObject): void`.
- Consumes: `Visibility`, `visibilitySchema`, `DEFAULT_VISIBILITY` (Task 1), `JsonSchemaObject` (Task 7), `ContractError` (Task 2).

> **Design note (why both a fail-safe read and a loud assert):** REQ-CORE-008 makes an *absent* annotation `module-private`. A *misspelled* annotation (`publik`) is a different case: the read stays fail-safe, but silence there would hand an author a setting they believe is public and the core has hidden. `assertVisibilityAnnotations` makes that a `MANIFEST_INVALID` at registration, which is ADR-008's own principle — mislabels are caught at registration, not at projection.

- [ ] **Step 1: Write the failing test** — `packages/sdk/src/manifest/app-settings-visibility.contract.spec.ts`

```ts
import { ContractError } from '../errors/error-codes';
import type { JsonSchemaObject } from './manifest.schema';
import {
  VISIBILITY_ANNOTATION,
  appSettingsVisibilityMap,
  assertVisibilityAnnotations,
  readPropertyVisibility,
} from './app-settings-visibility';

const appSettings: JsonSchemaObject = {
  type: 'object',
  properties: {
    title: { type: 'string', 'x-visibility': 'public' },
    scoreboardMode: { type: 'string', 'x-visibility': 'organizer' },
    correctAnswers: { type: 'array', 'x-visibility': 'module-private' },
    hiddenWeights: { type: 'array' },
  },
};

describe('appSettings per-property visibility', () => {
  it('uses the annotation ADR-008 mandates', () => {
    expect(VISIBILITY_ANNOTATION).toBe('x-visibility');
  });

  it.each([
    ['title', 'public'],
    ['scoreboardMode', 'organizer'],
    ['correctAnswers', 'module-private'],
  ])('reads the declared level of %s', (property, expected) => {
    expect(readPropertyVisibility(appSettings, property)).toBe(expected);
  });

  // REQ-CORE-008 / ADR-008: absence of an annotation means module-private.
  // Forgetting to annotate must close, never open.
  it('treats an unannotated property as module-private', () => {
    expect(readPropertyVisibility(appSettings, 'hiddenWeights')).toBe('module-private');
  });

  it('treats an unknown property as module-private', () => {
    expect(readPropertyVisibility(appSettings, 'nope')).toBe('module-private');
  });

  it.each([
    ['no properties block', { type: 'object' }],
    ['properties is not an object', { type: 'object', properties: 'nonsense' }],
    ['property is not an object', { type: 'object', properties: { a: 'nonsense' } }],
  ])('fails safe when the schema is shaped unexpectedly: %s', (_name, schema) => {
    expect(readPropertyVisibility(schema as JsonSchemaObject, 'a')).toBe('module-private');
  });

  it('maps every property, defaulting the unannotated ones', () => {
    expect(appSettingsVisibilityMap(appSettings)).toEqual({
      title: 'public',
      scoreboardMode: 'organizer',
      correctAnswers: 'module-private',
      hiddenWeights: 'module-private',
    });
  });

  it('accepts annotations that are absent or valid', () => {
    expect(() => assertVisibilityAnnotations(appSettings)).not.toThrow();
  });

  it('rejects a misspelled annotation instead of silently hiding the property', () => {
    const typo: JsonSchemaObject = {
      type: 'object',
      properties: { title: { type: 'string', 'x-visibility': 'publik' } },
    };
    expect(() => assertVisibilityAnnotations(typo)).toThrow(ContractError);
    try {
      assertVisibilityAnnotations(typo);
    } catch (err) {
      expect((err as ContractError).code).toBe('MANIFEST_INVALID');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk exec jest src/manifest/app-settings-visibility -v`
Expected: FAIL — `Cannot find module './app-settings-visibility'`.

- [ ] **Step 3: Write the implementation** — `packages/sdk/src/manifest/app-settings-visibility.ts`

```ts
import { ContractError } from '../errors/error-codes';
import {
  DEFAULT_VISIBILITY,
  visibilitySchema,
  type Visibility,
} from '../visibility/visibility';
import type { JsonSchemaObject } from './manifest.schema';

// The per-property annotation of ADR-008 §1. It survives zod → JSON Schema
// conversion via .meta({ 'x-visibility': ... }) — verified on zod 4.4.3.
export const VISIBILITY_ANNOTATION = 'x-visibility';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const propertiesOf = (appSettings: JsonSchemaObject): Record<string, unknown> =>
  asRecord(appSettings['properties']) ?? {};

// REQ-CORE-008: «отсутствие аннотации трактуется как module-private (fail-safe)».
// Every unreadable shape resolves the same way — the most protected level. To expose
// a property an author must say so explicitly; forgetting closes, never opens.
export const readPropertyVisibility = (
  appSettings: JsonSchemaObject,
  property: string,
): Visibility => {
  const definition = asRecord(propertiesOf(appSettings)[property]);
  if (definition === null) {
    return DEFAULT_VISIBILITY;
  }

  const parsed = visibilitySchema.safeParse(definition[VISIBILITY_ANNOTATION]);
  return parsed.success ? parsed.data : DEFAULT_VISIBILITY;
};

// The whole map, for the core's projection builder (a later plan): it projects
// appSettings by the requester's level exactly as it projects state and events
// (REQ-CORE-005), instead of filtering fields by hand — which the norm forbids.
export const appSettingsVisibilityMap = (
  appSettings: JsonSchemaObject,
): Record<string, Visibility> =>
  Object.fromEntries(
    Object.keys(propertiesOf(appSettings)).map((property) => [
      property,
      readPropertyVisibility(appSettings, property),
    ]),
  );

// A present-but-unknown annotation is an authoring mistake, not a visibility choice.
// Reading it fails safe, but staying silent would leave the author believing a
// property is public while the core hides it. ADR-008 catches mislabels at
// registration; this is that principle applied to the settings channel.
export const assertVisibilityAnnotations = (appSettings: JsonSchemaObject): void => {
  for (const [property, rawDefinition] of Object.entries(propertiesOf(appSettings))) {
    const definition = asRecord(rawDefinition);
    if (definition === null) {
      continue;
    }

    const annotation = definition[VISIBILITY_ANNOTATION];
    if (annotation === undefined) {
      continue;
    }

    if (!visibilitySchema.safeParse(annotation).success) {
      throw new ContractError(
        'MANIFEST_INVALID',
        `appSettings property "${property}" declares an unknown ${VISIBILITY_ANNOTATION}: ${JSON.stringify(annotation)}`,
      );
    }
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/sdk exec jest src/manifest/app-settings-visibility -v`
Expected: PASS — 12 tests.

- [ ] **Step 5: Export from the package surface** — add to `packages/sdk/src/index.ts`

```ts
export * from './manifest/app-settings-visibility';
```

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/manifest packages/sdk/src/index.ts
git commit -m "feat(sdk): fail-safe per-property appSettings visibility (REQ-CORE-008, ADR-008)"
```

---

## Task 9: Authoring helper and the fail-closed conversion guard

**Files:**
- Create: `packages/sdk/src/manifest/define-app.ts`, `packages/sdk/src/manifest/define-app.fixtures.ts`, `packages/sdk/src/manifest/define-app.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`

**Interfaces:**
- Produces: `type AppDefinition`, `toRegisteredSchema(schema: z.ZodType): JsonSchemaObject`, `defineApp(definition: AppDefinition): AppManifest`.
- Consumes: `ContractError` (Task 2), `CONTRACT_VERSION` (Task 6), `appManifestSchema`/`AppManifest`/`JsonSchemaObject` (Task 7), `assertVisibilityAnnotations` (Task 8), `Visibility` (Task 1).

**The empirics this task rests on** (re-verified by running zod 4.4.3 on 2026-07-16, not taken from documentation or memory — design §3):

| Construct | `z.toJSONSchema` behaviour | Guard's job |
|---|---|---|
| `.refine()` / `.superRefine()` | **dropped silently**, no error, no warning — nested and inside arrays too | detect and reject |
| `z.date()`, `z.bigint()`, `.transform()` | throws | re-wrap as a typed code |
| `.min()`, `.max()`, `.regex()`, `.int()`, enums | converted correctly | leave alone |
| `.meta({ 'x-visibility': … })` | survives, also with an `override` supplied | leave alone |

Detection detail that decides the implementation: a `.refine()` lives in `_zod.def.checks` with `check === 'custom'`, whereas `.min(1)` also puts a check there but with `check === 'min_length'`. **The discriminator is `check === 'custom'`, not a non-empty `checks` array** — the latter would reject perfectly legal schemas. The `override` hook is called for every subschema, including nested ones and ones inside arrays, so it performs the tree walk; a hand-rolled recursive walk is unnecessary and would miss shapes.

- [ ] **Step 1: Write the failing test** — `packages/sdk/src/manifest/define-app.fixtures.ts`

```ts
import { z } from 'zod';

// Schemas an app may legally author: everything here survives conversion intact.
export const representableSchemas: { name: string; schema: z.ZodType }[] = [
  { name: 'string bounds and regex', schema: z.object({ nick: z.string().min(1).max(32), code: z.string().regex(/^[A-Z]+$/) }) },
  { name: 'integer bounds', schema: z.object({ choice: z.number().int().min(0).max(3) }) },
  { name: 'enum and optional', schema: z.object({ kind: z.enum(['a', 'b']), note: z.string().optional() }) },
  { name: 'nested object and array', schema: z.object({ rounds: z.array(z.object({ id: z.string() })) }) },
  { name: 'visibility annotation', schema: z.object({ title: z.string().meta({ 'x-visibility': 'public' }) }) },
];

// Schemas that must be refused: each would either vanish silently or fail to convert.
export const unrepresentableSchemas: { name: string; schema: z.ZodType }[] = [
  { name: 'top-level .refine()', schema: z.object({ a: z.number(), b: z.number() }).refine((v) => v.a < v.b) },
  { name: 'nested .refine()', schema: z.object({ inner: z.object({ a: z.number(), b: z.number() }).refine((v) => v.a < v.b) }) },
  { name: '.refine() inside an array', schema: z.object({ xs: z.array(z.string().refine((s) => s.length > 2)) }) },
  { name: '.superRefine()', schema: z.object({ s: z.string() }).superRefine(() => {}) },
  { name: 'z.date()', schema: z.object({ at: z.date() }) },
  { name: 'z.bigint()', schema: z.object({ n: z.bigint() }) },
  { name: '.transform()', schema: z.object({ s: z.string().transform((s) => s.length) }) },
];
```

`packages/sdk/src/manifest/define-app.contract.spec.ts`:

```ts
import { z } from 'zod';
import { ContractError } from '../errors/error-codes';
import { CONTRACT_VERSION } from '../contract-version';
import { appManifestSchema } from './manifest.schema';
import { readPropertyVisibility } from './app-settings-visibility';
import { defineApp, toRegisteredSchema } from './define-app';
import { representableSchemas, unrepresentableSchemas } from './define-app.fixtures';

const quizSettings = z.object({
  title: z.string().meta({ 'x-visibility': 'public' }),
  correctAnswers: z.array(z.number()),
});

const defineQuiz = () =>
  defineApp({
    appId: 'quiz',
    manifestVersion: 1,
    appSettings: quizSettings,
    events: {
      'answer.submitted': {
        schema: z.object({ roundId: z.string(), choice: z.number().int() }),
        visibility: 'module-private',
      },
    },
  });

describe('conversion guard', () => {
  it.each(representableSchemas.map((c) => [c.name, c.schema] as const))(
    'converts a legal schema: %s',
    (_name, schema) => {
      expect(() => toRegisteredSchema(schema)).not.toThrow();
    },
  );

  // Design §6: the loss is SILENT, which is the ADR-008 class of defect — the app
  // believes the core enforces a rule the core never received. Reject instead.
  it.each(unrepresentableSchemas.map((c) => [c.name, c.schema] as const))(
    'refuses a schema that would not survive conversion: %s',
    (_name, schema) => {
      expect(() => toRegisteredSchema(schema)).toThrow(ContractError);
      try {
        toRegisteredSchema(schema);
      } catch (err) {
        expect((err as ContractError).code).toBe('SCHEMA_NOT_REPRESENTABLE');
      }
    },
  );

  // This is the fixture that guards the guard (design §6). It rests on a zod
  // internal (_zod.def.checks); a zod upgrade that breaks detection must fail CI
  // loudly rather than quietly open the gate. Do not silence it — fix the detector.
  it('still detects that zod drops .refine() silently', () => {
    const refined = z.object({ a: z.number(), b: z.number() }).refine((v) => v.a < v.b);
    const converted = JSON.stringify(z.toJSONSchema(refined));

    expect(converted).not.toContain('refine');
    expect(() => toRegisteredSchema(refined)).toThrow(ContractError);
  });

  it('keeps the checks that DO convert', () => {
    const json = toRegisteredSchema(z.object({ nick: z.string().min(1) }));
    expect(JSON.stringify(json)).toContain('minLength');
  });
});

describe('defineApp', () => {
  it('produces a manifest that satisfies the manifest contract', () => {
    expect(appManifestSchema.safeParse(defineQuiz()).success).toBe(true);
  });

  it('defaults contractRange to the current major of the contract', () => {
    expect(defineQuiz().contractRange).toBe(`^${CONTRACT_VERSION}`);
  });

  it('keeps an explicit contractRange', () => {
    const manifest = defineApp({
      appId: 'quiz',
      manifestVersion: 2,
      contractRange: '>=1.0.0 <2.0.0',
      appSettings: quizSettings,
      events: {},
    });
    expect(manifest.contractRange).toBe('>=1.0.0 <2.0.0');
  });

  it('registers events under short names and carries their ceiling', () => {
    const manifest = defineQuiz();
    expect(Object.keys(manifest.events)).toEqual(['answer.submitted']);
    expect(manifest.events['answer.submitted'].visibility).toBe('module-private');
  });

  it('snapshots appSettings with visibility annotations intact (ADR-008)', () => {
    const manifest = defineQuiz();
    expect(readPropertyVisibility(manifest.appSettings, 'title')).toBe('public');
    // Never annotated → module-private, and that is what the outcome-deciding data
    // must be (REQ-CORE-008).
    expect(readPropertyVisibility(manifest.appSettings, 'correctAnswers')).toBe('module-private');
  });

  // REQ-CTR-002: what the registry stores must be serializable — no live zod.
  it('produces a JSON-serializable manifest with no live objects in it', () => {
    const manifest = defineQuiz();
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });

  it('refuses an app that would take the core namespace', () => {
    expect(() =>
      defineApp({ appId: 'core', manifestVersion: 1, appSettings: quizSettings, events: {} }),
    ).toThrow(ContractError);
  });

  it('refuses an unrepresentable event schema with a typed error', () => {
    expect(() =>
      defineApp({
        appId: 'quiz',
        manifestVersion: 1,
        appSettings: quizSettings,
        events: {
          'answer.submitted': {
            schema: z.object({ a: z.number(), b: z.number() }).refine((v) => v.a < v.b),
            visibility: 'module-private',
          },
        },
      }),
    ).toThrow(ContractError);
  });

  it('refuses a misspelled visibility annotation', () => {
    expect(() =>
      defineApp({
        appId: 'quiz',
        manifestVersion: 1,
        appSettings: z.object({ title: z.string().meta({ 'x-visibility': 'publik' }) }),
        events: {},
      }),
    ).toThrow(ContractError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk exec jest src/manifest/define-app -v`
Expected: FAIL — `Cannot find module './define-app'`.

- [ ] **Step 3: Write the implementation** — `packages/sdk/src/manifest/define-app.ts`

```ts
import { z } from 'zod';
import { CONTRACT_VERSION } from '../contract-version';
import { ContractError } from '../errors/error-codes';
import type { Visibility } from '../visibility/visibility';
import { assertVisibilityAnnotations } from './app-settings-visibility';
import {
  appManifestSchema,
  type AppManifest,
  type JsonSchemaObject,
} from './manifest.schema';

// The authoring surface (design §4.6): an app writes zod — types and DX — while the
// REGISTERED artifact is JSON Schema. That is what makes REQ-RT-004 an invariant
// held by data: the snapshot sits in the core's storage under
// (appId, manifestVersion), so a module cannot break an active room's validation by
// deleting last version's code.
export type AppDefinition = {
  appId: string;
  manifestVersion: number;
  // Defaults to the current major of the contract (REQ-CTR-004).
  contractRange?: string;
  appSettings: z.ZodType;
  // Short names; the core prefixes the namespace itself (design §4.1).
  events: Record<string, { schema: z.ZodType; visibility: Visibility }>;
};

type ZodInternals = { _zod?: { def?: { checks?: unknown[] } } };
type CheckInternals = { _zod?: { def?: { check?: string } } };

// A custom refinement reports check === 'custom'; ordinary checks report their own
// kind ('min_length', 'greater_than', …) and convert fine. Testing for a non-empty
// checks array would reject legal schemas.
const hasCustomCheck = (schema: unknown): boolean =>
  ((schema as ZodInternals)?._zod?.def?.checks ?? []).some(
    (check) => (check as CheckInternals)?._zod?.def?.check === 'custom',
  );

// The conversion guard (design §6).
//
// z.toJSONSchema drops .refine()/.superRefine() SILENTLY while throwing on
// date/bigint/transform. Silent loss is the defect class ADR-008 exists to prevent:
// the app is convinced the core enforces its rule, and the core never received it.
// So a manifest carrying one is refused outright.
//
// This reads a zod internal (_zod.def.checks) on purpose. The cure is the project's
// own principle: the guard is covered by a fixture, so a zod upgrade that breaks
// detection turns CI red instead of quietly opening the gate.
export const toRegisteredSchema = (schema: z.ZodType): JsonSchemaObject => {
  try {
    // `override` is invoked for every subschema, so it walks the tree for us —
    // nested refinements and refinements inside arrays included.
    const json = z.toJSONSchema(schema, {
      override: (ctx) => {
        if (hasCustomCheck(ctx.zodSchema)) {
          throw new ContractError(
            'SCHEMA_NOT_REPRESENTABLE',
            'custom refinement (.refine/.superRefine) cannot be represented in JSON Schema and would be dropped silently',
          );
        }
      },
    });
    return { ...json } as JsonSchemaObject;
  } catch (err) {
    if (err instanceof ContractError) {
      throw err;
    }
    // date / bigint / transform: zod throws by itself — re-wrap as a typed code so
    // nothing raw reaches the caller (REQ-SEC-006).
    throw new ContractError(
      'SCHEMA_NOT_REPRESENTABLE',
      err instanceof Error ? err.message : String(err),
    );
  }
};

// Where zod stops being the artifact and JSON Schema starts. The core validates the
// FORM from this snapshot; semantics that need room state stay with the app
// (design §4.6, REQ-RT-013).
export const defineApp = (definition: AppDefinition): AppManifest => {
  const appSettings = toRegisteredSchema(definition.appSettings);
  assertVisibilityAnnotations(appSettings);

  const events = Object.fromEntries(
    Object.entries(definition.events).map(([shortName, event]) => [
      shortName,
      { schema: toRegisteredSchema(event.schema), visibility: event.visibility },
    ]),
  );

  const manifest = {
    appId: definition.appId,
    manifestVersion: definition.manifestVersion,
    contractRange: definition.contractRange ?? `^${CONTRACT_VERSION}`,
    appSettings,
    events,
  };

  const parsed = appManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new ContractError('MANIFEST_INVALID', parsed.error.message);
  }

  return parsed.data;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/sdk exec jest src/manifest/define-app -v`
Expected: PASS — 23 tests.

- [ ] **Step 5: Export from the package surface** — add to `packages/sdk/src/index.ts`

```ts
export * from './manifest/define-app';
export * from './manifest/define-app.fixtures';
```

The finished `packages/sdk/src/index.ts` in full:

```ts
export * from './contract-version';
export * from './errors/error-codes';
export * from './visibility/visibility';
export * from './visibility/visibility.fixtures';
export * from './events/event-type';
export * from './events/log-event.schema';
export * from './events/log-event.fixtures';
export * from './events/projected-event.schema';
export * from './events/projected-event.fixtures';
export * from './events/core-events';
export * from './manifest/manifest.schema';
export * from './manifest/manifest.fixtures';
export * from './manifest/app-settings-visibility';
export * from './manifest/define-app';
export * from './manifest/define-app.fixtures';
```

- [ ] **Step 6: Run every gate the way CI runs it**

Run: `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build && pnpm run boundary-check && pnpm run guardrails`
Expected: all green. `boundary-check` reports no violations (SDK still a leaf); `guardrails` prints `All guardrails verified alive.`

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/manifest packages/sdk/src/index.ts
git commit -m "feat(sdk): zod authoring surface with fail-closed conversion guard (REQ-CTR-008, ADR-006, ADR-008)"
```

---

## Exit Criteria (verify all before declaring the SDK contract core done)

Each maps to a phase-1 exit criterion from the normative package §5 as amended by v1.3, restricted to what the SDK can hold; the rest belongs to the core-service plans.

- [ ] `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build && pnpm run boundary-check && pnpm run guardrails` — all green (REQ-DEV-001).
- [ ] Every contract surface has valid **and** invalid fixtures, exported from the package (REQ-CTR-005) — Tasks 1, 3, 4, 7, 9.
- [ ] An event whose visibility is more exposed than its type's ceiling is refused — the lattice half of REQ-CTR-009 (Task 1); the commit-time rejection is the core pipeline's plan.
- [ ] A manifest whose schema carries `.refine()` is refused, and the fixture that proves zod still drops it silently is green (design §6) — Task 9.
- [ ] A manifest with an unrepresentable type (`date` / `bigint` / `transform`) is refused (Task 9).
- [ ] An unannotated `appSettings` property reads as `module-private` — fail-safe of ADR-008 (Task 8); its absence from a participant's projection is the projection builder's plan.
- [ ] An incompatible `contractRange` is refused with `CONTRACT_VERSION_INCOMPATIBLE` (Task 6).
- [ ] The outward projection has no `seq` field to expose — REQ-RT-011(a) per amendment v1.3 (Task 4).
- [ ] `CONTRACT_VERSION` equals `packages/sdk/package.json` version (Task 6, REQ-CTR-004).
- [ ] Errors leave as a bare code — no message, no stack (Task 2, REQ-SEC-006).

## What this plan deliberately does NOT build

Recorded so a reviewer does not read absence as an omission.

- **Enforcement points of design §7** — registration flow, appSettings write path and validator caching (REQ-CORE-007), the commit pipeline with its mandatory step order (REQ-RT-007/009/012/014/016), projection building (REQ-CORE-005/008), fail-closed on DB loss (REQ-DEV-008). This plan gives them their schemas, typed errors and pure rules; the services are separate plans, and design §7 is binding on them.
- **Identity / room / membership DTOs** — separate spec (design §1).
- **Rewards contract** — §6.1 of the task list puts it in the SDK contract, but §5 puts Rewards in phase 3 and gate 2 forbids heavy phase-3 investment before the first live event. Resolved in favour of §5, confirmed by the owner on 2026-07-16. ADR-003 gives rewards its own contract attached through a manifest capability, so it is additive by construction.
- **`capabilities` manifest field** — the extension point for the above is fixed in ADR-003's words, not in an empty field (CLAUDE.md §2.3). `appManifestSchema` is strict, so it will be a deliberate change.
- **Replay cursor and per-level numbering** — design §4.4; part (b) of REQ-RT-011 is phase 4 per amendment v1.3.
- **A second version axis per event type** — REQ-RT-004 pins the manifest as a whole (design §4.2).
- **`core.room.created`** — not a REQ-RT-005 transition; a Room-plan question, additive if wanted.

## Self-Review Notes

**Spec coverage.** Design §4.1 → Task 3; §4.2 → Tasks 5, 6; §4.3 → Tasks 1, 4; §4.4 → Task 4 (structural: no cursor exists); §4.5 → Task 1; §4.6 → Task 9; §5 manifest → Tasks 7, 8, 9; §6 guard → Task 9; §8 errors → Task 2; §9 fixtures → Tasks 1, 3, 4, 7, 8, 9; §10 file layout → all, plus the three added files noted above. §7 is intentionally not implemented (see above) — it is recorded as binding on later plans.

**Empirics re-verified, not trusted.** All four zod facts of design §3 were re-run against zod 4.4.3 while writing this plan, and one detail the design does not state was found: `.min(1)` also populates `_zod.def.checks`, so the discriminator must be `check === 'custom'`. A guard written from the design's prose alone would have rejected every schema with a `.min()`.

**Type consistency.** `Visibility` (Task 1) is consumed by Tasks 5, 7, 8, 9. `JsonSchemaObject` (Task 7) is consumed by Tasks 8, 9 — Task 8 imports it as a type only, so no cycle. `ContractError` (Task 2) is consumed by Tasks 3, 6, 8, 9. `eventTypeSchema` (Task 3) is consumed by Tasks 4 and, via edit, by `log-event.schema.ts`. `appIdSchema` (Task 3) is consumed by Tasks 5 and 7. `EventTypeDefinition` (Task 5) and `manifestEventSchema` (Task 7) are deliberately the same shape minus the schema representation — zod live vs JSON Schema snapshot — which is exactly the §4.2 statement that the pipeline differs only in the registry's source.

**Ordering.** Tasks 1→2→3 are foundations; 4 and 5 depend on 3; 6 is independent apart from 2; 7 depends on 1 and 3; 8 on 1, 2, 7; 9 on everything. Executing in order keeps every task's test suite runnable on its own.
