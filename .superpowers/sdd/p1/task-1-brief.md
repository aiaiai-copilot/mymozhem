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

