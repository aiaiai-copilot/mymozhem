# Phase 1 — SDK contract core — SDD progress ledger

Plan: docs/sessions/2026-07-16-sdk-contract-core-implementation-plan.md
Design: docs/sessions/2026-07-16-sdk-contract-core-design.md
Branch: phase-1-sdk-contract-core
BASE (branch start): b3fb9f9deae33a0829dc91d6a78a72c4ce2befb6

> Phase 0's ledger is NOT in git (.superpowers/sdd is git-ignored scratch).
> It is archived beside this file as `progress-phase-0-archive.md` — phase 0 is
> COMPLETE (9 tasks, final review passed, merged to main locally, NOT pushed).
> Phase-1 briefs/reports go in `p1/` so phase-0's task-N-brief.md survive.

## Batching (owner decision 2026-07-16): one batch per session

Split by DEPENDENCY, not by equal task count — the plan's ordering note says 1→2→3 are
foundations, 4/5 depend on 3, 6 on 2 alone, 7 on 1+3, 8 on 1+2+7, 9 on everything.
The seam between 7 and 8 is deliberate: 7 is the manifest's FORM (a zod shape), 8-9 are
the RULES that guard it (both ADR-008-flavoured: catch the silent loss). Brief weight
lands 534 / 633 / 580 lines vs 534 / 442 / 771 for a naive 1-3/4-6/7-9 split, and Task 9
(the conversion guard) is the plan's hardest — it gets a session's room, not a tail.

- **Batch 1 — the vocabulary: Tasks 1-3.** Visibility levels, error codes, event-type names.
- **Batch 2 — the shapes: Tasks 4-7.** Projection envelope (no seq), core event registry,
  contract version, manifest schema.
- **Batch 3 — the guards: Tasks 8-9 + the final whole-branch review + Exit Criteria.**
  Fail-safe appSettings visibility read; defineApp + fail-closed conversion guard.

Each batch ends with a HANDOFF.md update so a fresh session resumes from this ledger.

## Tasks
- Task 1: visibility lattice + exposure ceiling — COMPLETE            [batch 1]
- Task 2: typed error codes — COMPLETE                                [batch 1]
- Task 3: event-type namespace + structural owner resolution — COMPLETE [batch 1]
- Task 4: outward projection envelope without seq — COMPLETE          [batch 2]
- Task 5: core-owned event registry (lifecycle) — COMPLETE            [batch 2]
- Task 6: contract version + range satisfaction — COMPLETE            [batch 2]
- Task 7: manifest schema — COMPLETE                                  [batch 2]
- Task 8: per-property appSettings visibility, fail-safe — COMPLETE   [batch 3]
  (commits b96caed..72b5dad, review clean: spec ✅, Approved, 0 Critical / 0 Important,
   2 Minor rolled up above; 12/12 focused, 100/100 package suite, output pristine)
- Task 9: defineApp + fail-closed conversion guard — COMPLETE         [batch 3]
  (commits 72b5dad..730d646, fix 6d3c42e, fix 80d2ca9; re-review Approved, 0 Critical /
   0 Important / 0 Minor remaining; 27/27 focused, all 6 gates green. Design amended to
   match at 06df4df.)

## Controller pre-flight findings (resolved, no owner interrupt needed)
- **Task 1 Step 6 omits `export * from './visibility/visibility.fixtures'`**, but
  Task 9's authoritative final index.ts lists it and REQ-CTR-005 mandates fixtures
  ship from the package. RESOLUTION: Task 1 exports it. Folded into Task 1 dispatch.
- Task 7's `contractRangeSchema` uses `.refine()` — legal and intentional: it is
  core-owned zod that is never converted to JSON Schema. The guard (Task 9) bans
  refinements only in APP-authored schemas. The plan carries this as a code comment
  ("Do not 'fix' this"). Expect a reviewer to raise it; adjudicate, do not pre-empt.
- Test-count expectations in the plan are approximate for Tasks 5 and 7 (plan says
  11/12; the listed `it` blocks count 10/10). Not a conflict — implementers report
  actual counts. Do not treat a mismatch as a spec failure by itself.

## Owner decisions carried into this phase
- Both contested design readings confirmed by owner 2026-07-16: §4.6 (zod = authoring
  surface, JSON Schema snapshot = registered artifact) and §1 (rewards contract excluded;
  §6.1-vs-§5 resolved in favour of §5).
- Design §3.3/§6 corrected before execution [commit b3fb9f9]: the conversion-guard
  discriminator is `check === 'custom'`, NOT mere presence in `_zod.def.checks`
  (`.min(1)` lives there too). The `override` hook walks the tree.
- Execution mode: subagent-driven (owner choice 2026-07-16).

## Cross-task carry-forward
- Prisma 7 + driver adapter decision from phase 0 does NOT touch this phase (SDK is a
  leaf, no Prisma).
- `pnpm-workspace.yaml` declines Prisma build scripts via `allowBuilds` — adding
  `semver` (Task 6) must not touch that.

## Minor findings (roll-up for the final whole-branch review)
- Task 1: `visibility.ts:16` comment phrasing — "weaker (= more exposed)" reads awkwardly;
  parenthetical is correct, wording could confuse a future reader. Cosmetic.
- Task 8: `app-settings-visibility.ts:111` — the comment claims `.meta({'x-visibility'})`
  "survives zod → JSON Schema conversion, verified on zod 4.4.3", but nothing in Task 8's
  diff exercises the conversion (its fixtures are hand-written plain objects). CONTROLLER
  NOTE: Task 9 is what backs the claim — `representableSchemas` carries a `.meta()` case and
  `defineApp`'s "snapshots appSettings with visibility annotations intact (ADR-008)" test
  reads the annotation back off a converted manifest. Final review: confirm that test
  landed and is green; if it did, the comment is backed one file over and the finding
  dissolves. If Task 9 dropped it, the comment is an unbacked claim and must go.
- Task 8: `app-settings-visibility.ts:114-115` — `asRecord` accepts arrays
  (`typeof [] === 'object'`), so an array `properties` is treated as a record rather than
  refused. Not a behavioural bug (every realistic lookup still fails safe to
  module-private), but looser narrowing than the name implies. Matters only if the helper
  is reused; it is file-local today.

## BATCH 1 COMPLETE (2026-07-17) — Tasks 1-3, all reviews clean
- Full CI-mirror green on the controller's machine at 6c78db4:
  typecheck / lint / test / build / boundary-check / guardrails.
  boundary-check: "no dependency violations found (75 modules, 118 dependencies cruised)".
  guardrails: both probes fired ("All guardrails verified alive") — the enforcers are
  alive, not just absent-of-violations.
- SDK package suite: 48/48.
- NOT pushed to origin (owner decision, standing since phase 0).
- **Deviation from the plan's verbatim code, owner-adjudicated 2026-07-17:** Task 3's
  three regexes are now composed from shared segments (NAMESPACE_SEGMENT / NAME_SEGMENT /
  SHORT_NAME_PATTERN) instead of being hand-copied as the plan's Step 3 wrote them, plus a
  compositional test. See "Task 3 fix" below. The plan document itself was NOT edited —
  a later reader comparing plan to code will find this the only intentional difference in
  batch 1.

## Completed
- Task 3 fix: complete (commit 6c78db4, re-review clean — no Critical/Important/Minor).
  Owner adjudicated the reviewer's Important plan-mandated finding (three hand-copied
  regexes = invariant held by convention, the same drift §4.1 rejects a lookup table to
  avoid) in favour of fixing. Second reviewer re-derived all three assembled patterns
  character-by-character against the originals: language provably unchanged, and the
  NAMESPACE_SEGMENT (no underscore) vs NAME_SEGMENT (underscore) distinction was correctly
  NOT collapsed. New test is a real 3×3 product (appIds × short names, incl. `answer_scored`
  and `answer.submitted`) round-tripping through composeEventType → eventTypeSchema →
  resolveTypeOwner — it would catch the drift the fixed-string tests would miss.
  Dead `if (!appId.success)` branch in resolveTypeOwner KEPT with a comment: defence in
  depth so a future segment divergence yields a typed ContractError, not a raw ZodError.
  48/48, lint + typecheck clean.
- Task 3: complete (commits 4ee2e63..747c085, then fix 6c78db4). Structural event-type
  ownership by namespace; `core` reserved against an app naming itself core. Phase-0
  fixture corrected (`room.created` → `core.room.activated`) — under §4.1 the old type
  parsed as an app named `room` owning it. Phase-0 log-event.contract.spec.ts untouched
  and green at 5 invalid cases (it is data-driven off the fixture array, so it picked the
  5th up with no edit — reviewer verified by reading it).
  OPEN ⚠️ FOR BATCH 2 (reviewer's, still unresolved): `composeEventType(namespace, shortName)`
  takes a free-form `namespace: string` with NO validation — nothing in event-type.ts stops
  a caller writing `composeEventType('core', 'x')`. "Forging a foreign namespace is
  inexpressible" therefore holds only if every caller supplies a namespace from trusted
  server-side identity, never from app input. Tasks 4/5/7 are the first callers — CHECK
  THIS WHEN THEY LAND.
- Task 2: complete (commits bc86018..4ee2e63, review clean). ContractError + the ten
  codes + code-only wire form (strictObject). 25/25 package suite, lint clean.
  Reviewer confirmed REQ-SEC-006 holds STRUCTURALLY, not just by test: toPayload()
  builds a fresh `{ code: this.code }` literal, so no path can leak message/stack.
  Controller resolved the reviewer's one ⚠️ (does the code list match design §8?):
  §8 lists exactly the same ten codes in the same order — verified first-hand.
  Task quality: Approved.
- Task 1: complete (commits b3fb9f9..bc86018, review clean). Visibility lattice
  (VISIBILITY_LEVELS/visibilitySchema/Visibility/exposureRank/isWithinCeiling/
  DEFAULT_VISIBILITY) in packages/sdk/src/visibility/. 20/20 (13 new + 7 phase-0
  log-event, no regression). Reviewer verified by grep that the move of the visibility
  symbols OUT of log-event.schema.ts breaks no consumer (nothing outside packages/sdk
  imports from '@mymozhem/sdk' yet) and hand-checked all 9 ceiling cases against
  EXPOSURE_RANK. Controller resolved the reviewer's one ⚠️ (lint not reported):
  `pnpm --filter @mymozhem/sdk run lint` → clean. Task quality: Approved.

## BATCH 2 (Tasks 4-7) — started 2026-07-17

### Pre-flight plan review: two plan-mandated conflicts, controller-adjudicated
Owner was presented both and delegated the call ("на твоё усмотрение", 2026-07-17).
Recorded here because the PLAN TEXT IS NOT EDITED — a later reader comparing plan to
code will find these as intentional differences, like batch 1's Task 3 regex fix.

**Decision 1 — Task 6, empty/unconstrained contract range.**
CONFLICT: plan Step 3's test asserts isContractRangeSatisfied('') === false, but plan
Step 5's implementation (`validRange(range) !== null && satisfies(...)`) returns TRUE
for ''. Verified live on semver 7.8.5: validRange('') === '*', satisfies('1.0.0','')
=== true. Task 6 as written CANNOT go green at Step 6.
RESOLUTION: the implementation is fixed, the test stands and is extended. The plan's
own comment states the intent — "A malformed range is not satisfied — it never
silently passes as 'no constraint'" — and '' is precisely "no constraint".
Guard is on the NORMALIZED range, not the input spelling:
    if (validRange(range) === null || validRange(range) === '*') return false;
WHY normalized, not `range === ''`: probed semver 7.8.5 — TEN spellings normalize to
'*': '', '*', 'x', 'X', '>=0.0.0', '*.*.*', ' ', '||', '1 || *', 'x.x.x'. An input-string
check would catch one of ten and hold the invariant by enumeration — the same drift
§4.1 rejects a lookup table to avoid, and the same one batch 1's Task 3 fix removed.
Test gains '*' beside ''. All of the plan's other cases are unaffected (verified:
'^1.0.0' '>=1.0.0 <2.0.0' '1.x' -> true; '^2.0.0' '>=1.5.0' '0.9.x' 'garbage!!'
'not-a-range' -> false).

**Decision 2 — Task 5, tautological ceiling test.**
CONFLICT: plan Step 1's test `admits its own declared level under its own ceiling`
asserts isWithinCeiling(def.visibility, def.visibility), i.e. RANK[x] <= RANK[x] —
true for every x, and `Visibility` typing admits no invalid x. It cannot fail for any
content of CORE_EVENTS; the rubric treats a test that asserts nothing as a defect.
RESOLUTION: DROP the test. Redundant twice over — the sibling `declares %s public
(REQ-RT-010)` already it.each's Object.keys(CORE_EVENTS) and pins each to 'public',
and Task 1's visibility.contract.spec.ts already covers all 9 ceiling pairs against
EXPOSURE_RANK. Task 5 lands with 9 tests, not the plan's stated 11 (the plan's count
was already off by one: its own listed tests total 10).

### OPEN ⚠️ raised in pre-flight, NOT resolved — for the final whole-branch review
An upper-UNBOUNDED range still satisfies: '>=1.0.0' admits contract 2.0.0, and
'>=0.0.0-0' constrains ~nothing yet does NOT normalize to '*' (validRange keeps it
verbatim), so Decision 1's guard does not catch it. Whether REQ-CTR-004 requires a
manifest to declare an upper bound is a contract-design question the plan never poses
and Decision 1 deliberately does not foreclose — the narrow guard only rejects ranges
that constrain NOTHING. Raise with the owner at batch 3 / final review.

### Carried into batch 2 from batch 1 (reviewer's open ⚠️, must be closed here)
composeEventType(namespace, shortName) takes a free-form namespace with NO validation.
Tasks 4/5/7 are its first callers — CONFIRM BY CODE when each lands, not by expectation.

## Completed (batch 2)
- Task 4: complete (commit dd0338e..0666e8d, review clean — no Critical/Important).
  Outward projection envelope: z.strictObject with exactly (type, payload, actorId).
  REQ-RT-011(a) holds STRUCTURALLY — reviewer verified the key-set assertion is not
  vacuous by checking zod 4.4.3 still exposes .shape on strictObject's return, and
  hand-traced all 5 negative fixtures to confirm each fails for the reason its name
  claims (not passing the suite for an unrelated reason). Diff is a verbatim match of
  both the brief and design §4.3 (design doc line 116: "Без seq, без visibility, без
  курсора"). 8 new tests, 56/56 package suite, lint clean.
  CARRIED ⚠️ RESOLVED FOR THIS TASK (controller, by code not expectation): Task 4 is
  NOT a composeEventType caller. grep of projected-event.{schema,fixtures}.ts shows no
  reference; it imports eventTypeSchema only — it VALIDATES a type, never CONSTRUCTS
  one. The namespace-forging ⚠️ stays open for Tasks 5 and 7.
  Reviewer ⚠️ (suite count 56 not re-run at review scope): controller accepts —
  48 (batch 1) + 8 (new) = 56 is consistent, and the batch-close gate run verifies
  first-hand anyway, as batch 1 did.

## Minor findings (roll-up for the final whole-branch review)
- Task 4: projected-event.schema.ts:16 — `payload: z.record(z.string(), z.unknown())`
  does not structurally enforce REQ-CTR-002's "network-shaped and JSON-serializable":
  z.unknown() admits functions, Date, Map, BigInt. NOT introduced by Task 4 — copied
  verbatim from phase-0 logEventSchema.payload (log-event.schema.ts:12) and mandated by
  the brief. But Task 4 is where the actual CLIENT-FACING boundary is defined, which is
  what makes it worth fixing. Suggested follow-up: one shared recursive jsonValueSchema
  used by both log-event and projected-event. Final review to triage.
- Task 5: complete (commit 0666e8d..670e10d, review clean — no Critical/Important).
  Core event registry: exactly the REQ-RT-005 transitions (room.activated/completed/
  cancelled), all public per REQ-RT-010, room.activated carrying the REQ-RT-004 pin.
  No core.room.created — creation is not a transition (brief's design note).
  Controller's Decision 2 (drop the tautological ceiling test) applied cleanly:
  reviewer confirmed the test is absent, isWithinCeiling import removed with no
  leftover, count is 9 by literal count of the diff.
  Reviewer independently verified the two cross-module assumptions the new tests rest
  on rather than trusting them: appIdSchema really rejects literal 'core'
  (event-type.ts:18-22 .refine), and resolveTypeOwner('core.room.activated') really
  returns {kind:'core', shortName:'room.activated'} (event-type.ts:54-56).
  9 new tests, 65/65 package suite, lint clean.
  CARRIED ⚠️ RESOLVED FOR THIS TASK (controller, by code not expectation): grep of the
  whole SDK shows the ONLY non-test composeEventType call site is core-events.ts:47,
  and it passes CORE_NAMESPACE — a module-level `const 'core'` (event-type.ts:5), never
  app input. Task 5 does not open the forging hole. ⚠️ stays open for Task 7.

### Minor findings (roll-up, continued)
- Task 5: core-events.contract.spec.ts "rejects payload on the terminal transitions"
  exercises room.completed only, not room.cancelled. Both are z.strictObject({}) so
  risk is low today; inherited verbatim from the brief's Step 1, not an implementer
  gap. Follow-up: it.each over both, so a future divergence of the terminal schemas
  cannot pass unnoticed. Final review to triage.

### PLAN DEFECT found in batch 2 — affects Tasks 7/8/9, no code impact so far
Every task's verification steps in the plan use `jest <path> -v`. That flag DOES NOT
WORK: Jest 29.7.0 in this repo rejects it — `● Unrecognized CLI Parameter: Unrecognized
option "v"` — and runs NO tests. Controller reproduced it first-hand at batch 2.
The hazard is specific: at Step 2 the agent EXPECTS a failure, and the CLI error IS a
failure, so a careless implementer can log a false RED and never run the test at all.
AUDITED — no harm done: controller grepped the RED evidence of tasks 4, 5 and 6. All
three show the genuine `TS2307: Cannot find module ...`, which only a real jest run
produces. Each implementer independently noticed and used `--verbose`. TDD chain intact.
FOR BATCH 3: use `--verbose` (or no flag), and check the RED output names the missing
module — not an argv complaint. Plan text NOT edited, consistent with the other
deviations.
- Task 6: complete (commit 670e10d..56636cb, review clean — no Critical/Important).
  CONTRACT_VERSION = '1.0.0'; packages/sdk/package.json 0.0.0 -> 1.0.0; semver added.
  Controller's Decision 1 applied: guard rejects the NORMALIZED '*' rather than the
  input spelling. Reviewer did NOT take this on trust — ran semver 7.8.5 standalone and
  re-derived every case: all ten no-constraint spellings -> false; '^1.0.0'/'>=1.0.0
  <2.0.0'/'1.x' -> true; '^2.0.0'/'>=1.5.0'/'0.9.x'/'garbage!!'/'not-a-range' -> false;
  and the two deliberately-unhandled upper-unbounded ranges ('>=1.0.0', '>=0.0.0-0')
  still -> true, confirming the scope line was held rather than quietly crossed.
  assertContractRangeSatisfied reuses isContractRangeSatisfied (no duplicated logic) and
  throws ContractError('CONTRACT_VERSION_INCOMPATIBLE') — one of design §8's fixed ten,
  no new code invented. The pkg.version === CONTRACT_VERSION test reads the real file via
  fs, so REQ-CTR-004's two-sources-of-one-truth cannot drift silently.
  13 new tests, 78/78 package suite, lint + boundary-check clean.
  CONTROLLER VERIFIED FIRST-HAND (report claims about repo state, not diff): exactly one
  lockfile, at root (REQ-DEV-002); sdk = 1.0.0; core and server untouched at 0.0.0.
- Task 7: complete (commit 56636cb..93e7764, review clean — NO findings at any severity).
  App manifest schema: strictObject, mandatory per-type visibility ceiling (REQ-CTR-009),
  contractRange via semver validRange, appSettings + per-event schema as serializable
  JSON Schema (ADR-006). No capabilities field — the strictObject rejects it and a
  fixture proves it (CLAUDE.md no-forward-scaffolding).
  Reviewer hand-traced ALL 8 negative fixtures against the real upstream schemas and
  confirmed each fails for the reason its NAME claims, not incidentally — notably that
  'Bad.Key!' has every other field independently valid, so the record key is the only
  possible failure path. That fixture depends on z.record validating keys; controller
  probed zod 4.4.3 directly beforehand and observed `invalid_key` / "Invalid key in
  record", and the reviewer cross-checked the lockfile pins zod@4.4.3.
  10 new tests (brief predicted 12; implementer reported the real number, unpadded).
  CARRIED ⚠️ NOW FULLY RESOLVED FOR BATCH 2 (controller, by code): Task 7 does NOT call
  composeEventType — it registers SHORT names via shortEventNameSchema and never composes
  a full type. Across the whole SDK the only non-test call site remains core-events.ts:47
  with the CORE_NAMESPACE constant. Inside the SDK, "forging a foreign namespace is
  inexpressible" HOLDS.

### Minor findings (roll-up, continued)
- Task 6: contract-version.contract.spec.ts merges two semantically distinct failure
  modes into one it.each — validRange === null (malformed) vs validRange === '*'
  (constrains nothing) exercise different guard branches, but share one test title, so a
  regression in either cannot be localized from the name alone. Split or name per-case.

## BATCH 2 COMPLETE (2026-07-17) — Tasks 4-7, all reviews clean
Commits: 0666e8d (T4) -> 670e10d (T5) -> 56636cb (T6) -> 93e7764 (T7).
Full CI-mirror green on the controller's machine at 93e7764, run first-hand:
  typecheck / lint / test / build / boundary-check / guardrails.
  boundary-check: "no dependency violations found (108 modules, 188 dependencies
  cruised)" (was 75/118 at batch 1 — the SDK grew, the leaf rule still holds).
  guardrails: all three probes fired ("All guardrails verified alive") — enforcement is
  alive, not merely unviolated.
SDK package suite: 88/88, 8 suites.
NOT pushed to origin (owner decision, standing since phase 0).

### STILL OPEN for batch 3 / final whole-branch review
1. composeEventType's signature still takes `namespace: string` free-form. Verified above
   that no SDK caller feeds it app input — but the FIRST core-side caller (projection
   builder / commit pipeline) lands in a LATER plan, and that is where app input could
   reach it. Design §7 is what constrains that plan. Not closable from inside the SDK.
2. Upper-unbounded contract ranges: '>=1.0.0' satisfies and admits contract 2.0.0;
   '>=0.0.0-0' constrains ~nothing yet does not normalize to '*'. Does REQ-CTR-004 want
   manifests to declare an upper bound? Plan never poses it; Decision 1 deliberately did
   not foreclose it. OWNER QUESTION.
3. Plan's `-v` jest flag is broken repo-wide (see PLAN DEFECT above) — tasks 8/9 will hit it.
4. The Minor roll-up above (Tasks 1, 4, 5, 6) — final review triages what must be fixed.

## BATCH 3 (2026-07-17) — Tasks 8-9 + final whole-branch review

### Task 8 — COMPLETE. Commits b96caed..72b5dad, review clean.
Spec ✅, Approved, 0 Critical / 0 Important. 12/12 focused, 100/100 package suite,
output pristine. 2 Minor rolled up above.

### Task 9 — first pass 730d646, review found one Important. See owner decision below.
Reviewer (opus) went past the fixtures and verified the mechanism against zod's own
source: `ctx.override` fires inside flattenRef, which early-returns only when
`seen.ref === null` while ref initializes to `undefined` — so every node gets exactly one
override call. The brief's claim that the override hook makes a hand-rolled recursive walk
unnecessary HOLDS under the source, not just under the fixtures. Reviewer also probed six
shapes the fixtures miss (refine inside union / record value / tuple member / optional()
wrapper / .default() / discriminatedUnion member) — all six rejected. And z.custom() /
z.instanceof(Date), which the detector structurally cannot see (custom-TYPED schema, empty
checks array), is caught by a second mechanism: customProcessor throws under the default
unrepresentable:'throw', and the catch-and-rewrap turns it into SCHEMA_NOT_REPRESENTABLE.

### ⚠️ CLOSED by the controller (reviewer could not verify from diff)
Task 9 feeds raw zod strings (`parsed.error.message`) into ContractError's message, making
Task 2's outward boundary load-bearing. CHECKED IN CODE: error-codes.ts:39-41 `toPayload()`
returns `{ code: this.code }` and nothing else; contractErrorPayloadSchema (:24-26) is a
strictObject with `code` as its only key. Raw zod text stays server-side. REQ-SEC-006 holds.

### OWNER DECISION 2026-07-17 — guard inverted to an allowlist, AGAINST the plan's verbatim code
**This one is bigger than batches 1-2's deviations and was NOT agent-adjudicated.**

The plan's Task 9 Step 3 mandates the discriminator `check === 'custom'` verbatim, and
design §3.3/§6 was corrected specifically on this point at b3fb9f9 BEFORE execution
("the discriminator is `check === 'custom'`, NOT mere presence in `_zod.def.checks`").

What implementation revealed: that correction closed FALSE POSITIVES (a naive guard would
reject every `.min(1)`) and did not consider FALSE NEGATIVES. The design's empirics table
lists only .refine()/.superRefine() as silent-drop constructs. It is accurate but NOT
exhaustive. `overwrite` checks (.trim / .toLowerCase / .toUpperCase / .normalize) drop just
as silently and passed the guard. Verified first-hand by the controller on zod 4.4.3:

  z.string().trim().min(1)  | checks: ["overwrite","min_length"] | -> {"type":"string","minLength":1}
  z.string().toLowerCase()  | checks: ["overwrite"]              | -> {"type":"string"}

An app writing `z.string().trim().min(1)` believes whitespace-only input is refused; the
registered snapshot only enforces minLength:1, which "   " satisfies. Exactly the ADR-008
silent-loss class the guard exists to make impossible. Internally inconsistent too: the
guard rejected .transform() while passing .trim(), which is functionally a transform.

OWNER CHOSE: invert to an allowlist — reject any check kind not known-representable
(min_length, max_length, string_format, number_format, greater_than, less_than,
multiple_of). Fail-closed by construction; a denylist of ['custom','overwrite'] would close
today's hole and stay fail-open to whatever kind zod adds next. The §3.3/§6 correction is
NOT reverted: min_length is on the allowlist, so legal bounded schemas still pass.

**FOLLOW-UP OWED — design doc is now stale.** design §3.3/§6 states a discriminator the
code deliberately no longer uses. Unlike batches 1-2 (where the plan text was left alone
on purpose, so plan-vs-code diffing would surface the deviations), the DESIGN is a durable
artifact and a stale §3.3/§6 is a trap for the next reader. Amend §3.3/§6 to the allowlist
before the branch is called done.

### Re-review of Task 9 (72b5dad..6d3c42e) — one Important, controller-adjudicated (no owner interrupt)
Re-reviewer (opus) confirmed the fix pass did the hard part right, by probing rather than
by reading the report: refinements hidden behind .optional() / .nullable() / .default() /
union member / z.record() value / z.tuple() member / z.lazy() — all seven refused. The
zero-check class (z.custom, z.set, z.map, z.nan, z.symbol, z.undefined, z.void) slips past
the check-kind test by construction and is caught by zod's own throw, re-wrapped by the
catch — nothing falls between the two mechanisms. Also mutation-tested the reworked
`toThrow(expect.objectContaining({ code }))` against expect 29.7.0: a wrong code FAILS, so
the assertion genuinely discriminates and is stronger than the try/catch it replaced.

**Important found: the allowlist was ADOPTED, not DERIVED — and was incomplete.**
`.length()` produces `length_equals`, converts losslessly
(`z.string().length(5)` -> `{minLength:5,maxLength:5}`), yet was refused. Fail-closed, so
not a safety hole — but it refuses a schema it has no reason to refuse, and tells the
author it "would be dropped silently", which for `.length()` is simply false. Plausible in
this domain: fixed-length room code, PIN, fixed-size answer array.

**Controller's fault, not the fixer's:** the seven-kind list came from the first reviewer's
enumeration and the controller passed it into the fix dispatch as given. Adjudicated by the
CONTROLLER, not the owner: the owner chose the MECHANISM (allowlist); completing the list is
implementing that decision, not changing it.

### DERIVED TABLE — zod 4.4.3, controller-run, 25 constructs (keep; expensive to re-derive)
Method: a check is REPRESENTABLE iff it leaves a TRACE — conversion WITH the check differs
from conversion of the same base WITHOUT it. No trace = silent loss. This is the test that
should govern any future change to the allowlist; do not hand-enumerate it again.

  REPRESENTABLE (trace):
    min_length     z.string().min(1) / z.array().min(1) / z.array().nonempty()
    max_length     z.string().max(9) / z.array().max(3)
    length_equals  z.string().length(5) / z.array().length(3)    <- was MISSING
    string_format  .regex / .startsWith / .endsWith / .includes / .lowercase
    number_format  z.number().int()
    greater_than   z.number().min(0) / .gt(0) / .positive()
    less_than      z.number().max(3)
    multiple_of    z.number().multipleOf(5)
  SILENT LOSS (no trace — must stay refused):
    custom         .refine() / .superRefine()
    overwrite      .trim() / .toLowerCase() / .toUpperCase() / .normalize()

  z.email() / z.uuid() / z.url() / z.iso.datetime() produce NO checks and convert with a
  trace — unaffected by the allowlist, no entry needed.

## BATCH 3 COMPLETE (2026-07-17) — Tasks 8-9 + final whole-branch review
Commits: 72b5dad (T8) -> 730d646 (T9) -> 6d3c42e (T9 fix: allowlist) ->
80d2ca9 (T9 fix: length_equals) -> 06df4df (design §3.3/§6 amended to match).
Gates green FIRST-HAND at 06df4df (controller ran, not inherited):
  typecheck / lint / build PASS; test — SDK 127/127 (10 suites), core 6/6, server 3/3;
  boundary-check "no dependency violations found (123 modules, 240 dependencies cruised)"
  (was 108/188 at batch 2 — SDK grew, leaf rule holds);
  guardrails: all three probes fired ("All guardrails verified alive").

### Final whole-branch review (b3fb9f9..06df4df, opus) — READY TO MERGE: YES
First dispatch died on a 529 Overloaded (server-side, mid-run); re-dispatched, clean.
No Critical, no Important. All 10 Exit Criteria MET, verified item-by-item. Reviewer
probed the guard beyond its fixtures: refine hidden in union/record/tuple/optional/default/
discriminatedUnion all rejected; every no-check construct throws and is re-wrapped.
Confirmed the amended design §6 and the code are mutually consistent (8-kind allowlist,
custom/overwrite rejection, second mechanism). Plan's Task 9 text still shows the old
`check === 'custom'` denylist — that is adjudicated deviation #4, plan deliberately left
unedited, NOT a defect.

### Minor roll-up — reviewer's triage (NONE gate the merge)
1. Task 4 projected-event payload `z.record(z.string(), z.unknown())` not structurally
   JSON-constrained (REQ-CTR-002 letter). fix-LATER, priority follow-up. Not a regression
   (identical to phase-0 logEventSchema.payload); JSON transport fails a function/Date/Map
   at serialization anyway. Right fix = one shared recursive jsonValueSchema used by BOTH
   log-event and projected-event — a small design task of its own (recursion/depth policy),
   touches the phase-0 envelope. TRACK, don't block.
2. Task 1 visibility.ts comment phrasing. WON'T-FIX (cosmetic).
3. Task 5 terminal-transition test covers room.completed not room.cancelled. fix-LATER
   (both strictObject({}), nil risk today; it.each over both = 2-line hardening).
4. Task 6 range-failure it.each merges null vs '*' under one title. fix-LATER
   (correctness fine; test-localizability only; split into two titled blocks).
5. Task 8 `.meta()` "verified on zod 4.4.3" comment. WON'T-FIX — CONFIRMED BACKED: the
   define-app test "snapshots appSettings with visibility annotations intact (ADR-008)"
   round-trips a .meta() through defineApp's z.toJSONSchema and reads it back. True and now
   fixture-backed one file over. (Brief's line refs :111/:114-115 are stale — file is 71
   lines, comment ~14, asRecord ~16 — substance correct.)
6. Task 8 asRecord accepts arrays. fix-LATER / won't-fix acceptable — fails safe in every
   path; `!Array.isArray(value)` matches the name, no reachable exposure.

### Reviewer's ONE NEW hardening suggestion (not in the roll-up)
Guard tree-walk rejects refinements inside union/record/tuple (reviewer VERIFIED by probe),
but unrepresentableSchemas only fixtures top-level/nested-object/array refine. Adding one
union-branch + one record-value refine fixture converts the empirical finding into a
standing regression guard — "the gate checks the gate" principle. Pure hardening, minutes.

### Two open items — reviewer confirmed CORRECTLY PARKED
1. composeEventType(namespace: string) free-form. Parking RIGHT. The tempting "tighten the
   signature now" does NOT work: AppId infers to plain string (zod regex/refine doesn't
   brand), so `namespace: AppId | 'core'` gives zero compile protection vs a raw app string.
   Durable fix for the LATER core-side plan = branded AppId (z.brand) or a TypeOwner param,
   where design §7 binds — not a runtime check bolted on here.
2. Upper-unbounded contract ranges pass. CORRECTLY PARKED AS OWNER QUESTION, not a branch
   defect: vs today's 1.0.0 these ARE satisfied and harmless; harm is only prospective (a
   future breaking 2.0.0). '>=0.0.0-0' is the sharper edge (dodges '*' normalization). If
   owner wants an upper bound required, natural home = contractRangeSchema, additive.
   >>> STILL OWED TO OWNER before the core-side plan hardcodes a REQ-CTR-004 reading. <<<

### FOLLOW-UPS FILED (not gated on this branch)
- jsonValueSchema for log-event + projected-event payload (roll-up #1) — first follow-up.
- Owner question: upper-bound contract-range policy (open item #2).
- Later core-side plan: brand AppId / TypeOwner-typed composeEventType (open item #1).
- Opportunistic hardening: union/record refine fixtures; terminal it.each; split range
  titles; asRecord array narrowing. All cheap, none load-bearing.

## PLAN COMPLETE — 9/9 tasks, final review clean, branch phase-1-sdk-contract-core ready to
## merge. NOT pushed / NOT merged — finishing decision is the owner's (push deferred since
## phase 0). HANDOFF.md updated separately.

---

# Phase 1 — App/manifest registration service — SDD progress ledger

Plan: docs/sessions/2026-07-18-app-registry-registration-implementation-plan.md
Design: docs/sessions/2026-07-18-app-registry-registration-design.md
Branch: phase-1-app-registry-registration
BASE (branch start, merge-base main): 5639f49
Execution: subagent-driven (owner choice 2026-07-18).

Pre-flight plan scan: clean — no task contradicts another or the Global Constraints.
The duplicate-key → plain Error and guard-is-authoring-side calls are design-mandated
(design §3, §4 micro-decision 1), carried in the plan's Global Constraints, so they are
not defects; a reviewer may raise them and the controller adjudicates against the design.

## Tasks
- Task 1: pure registration logic (registerManifest + buildAppRegistry) — PENDING
- Task 2: NestJS wiring + phase-2 seam — PENDING

- Task 1: COMPLETE (commit eb3db5f..f3ad6ef, review clean — spec ✅, Approved,
  0 Critical / 0 Important, 19/19 tests, output pristine). 2 Minor rolled up:
  (a) app-registry.ts registryKey `${appId}@${ver}` assumes slug-shaped appId — add a
      one-line comment so a future slug relaxation can't silently reintroduce a collision.
  (b) buildAppRegistry error-propagation test exercises only MANIFEST_INVALID path, not
      CONTRACT_VERSION_INCOMPATIBLE — coverage gap, matches the brief; buildAppRegistry
      doesn't branch on code so behaviourally equivalent.

- Task 2: COMPLETE (commit f3ad6ef..192d38b, review clean — spec ✅, Approved,
  0 Critical / 0 Important, 3/3 new specs). 1 Minor rolled up:
  (c) AppRegistryService constructor param `readonly unknown[]` is intentionally loose
      (inherited from buildAppRegistry Task-1 signature) — no compile-time signal of what
      DI expects; not a defect, note if a future task wants a narrower DI-facing type.
  Controller ran all 6 gates green at 192d38b: typecheck 5/5, lint 3/3, test 5/5
  (sdk 142 + core + server), build 3/3, boundary-check clean (141 modules),
  guardrails all 3 enforcers alive. ⚠️ (gate-green) resolved.

## BOTH TASKS COMPLETE — pending final whole-branch review, then finishing-a-development-branch.

## FINAL WHOLE-BRANCH REVIEW (opus, at 192d38b) — Ready to merge: YES
0 Critical / 0 Important. All named risks verified against SDK source. Design decisions
(in-memory no-persistence; guard authoring-side) validated sound for phase 1.

### Minor findings — all triaged DEFER by the reviewer (none block merge):
- M-A: getManifest returns a live reference; Object.freeze is shallow (Map/manifest not
  frozen). Inert in phase-1 (empty registry, core-internal readers). Fix when first real
  reader lands: deep-freeze at insert or structured-clone on read. DEFER.
- M-B: design §6 listed "registry frozen" + "getManifest delegates" service tests that the
  executed spec dropped (plan claimed "same coverage"). Behavior implemented, only the
  assertions absent; freeze is cosmetic given M-A. Cheap to close: expect(Object.isFrozen(
  registry)).toBe(true). DEFER.
- M-C: index.ts now exports core-internal builders (registerManifest/buildAppRegistry) on the
  public @mymozhem/core surface; matches plan Step 7, enables later in-core composition.
  Intentional. ACCEPT.
- Rolled-up (1) registryKey `${appId}@${ver}` `@`-collision — verified impossible today
  (appId regex excludes `@`); add a one-line rationale comment. DEFER.
- Rolled-up (2) buildAppRegistry propagation test covers only MANIFEST_INVALID — behaviourally
  equivalent (no branch on code). DEFER.
- Rolled-up (3) service ctor `readonly unknown[]` loose — deliberate trust boundary,
  fail-closed boot re-validates. DEFER.

### FOLLOW-UPS FILED (cheap, none gating) — for a future touch of these files/design:
- registryKey `@`-safety rationale comment (app-registry.ts).
- Design-doc one-liner: embedded appSettings/events[].schema well-formedness is guaranteed
  upstream by defineApp, NOT re-checked by core (jsonSchemaObjectSchema is record<string,
  unknown>); becomes a real surface only if a runtime foreign-manifest load path appears.
- Object.isFrozen(registry) assertion to close design §6 stated-vs-actual (M-B).
- FORWARD OBLIGATION for the event-commit/Rooms plan: the first consumer surfacing these
  ContractErrors over HTTP/Socket.io must use toPayload(), never err.message (REQ-SEC-006).

## MERGED (2026-07-18): branch phase-1-app-registry-registration merged to main fast-forward
(5639f49..192d38b), 6/6 gates green on merged main, feature branch deleted. Push DEFERRED
(standing owner decision since phase 0). main now 44 commits ahead of origin/main.
Plan COMPLETE — 2/2 tasks. Next phase-1 core-side work: appSettings write path / Rooms,
per design §7 (separate plan). Follow-ups (cheap, non-gating) listed above.

---

# PLAN: Room lifecycle (docs/sessions/2026-07-18-room-lifecycle-implementation-plan.md)
Branch: phase-1-room-lifecycle. Headline: REQ-RT-005.

- Task 1 (errors + pure state machine): COMPLETE (0fd84d9, refactor afd6a71) — done in a prior session, pre-ledger.
- Task 2 (Prisma Room model + first migration): COMPLETE (17903e6) — prior session, pre-ledger.
- Task 3 (Testcontainers harness + smoke test): COMPLETE (56895a6), 6/6 gates green + test:int 1/1.
  LESSON: the harness arrived from the prior session with `false && execSync(migrate deploy)` —
  the migration step was short-circuited by a literal, so no migration ever applied. Test was red
  (table missing), so no false green resulted, but a less specific smoke test WOULD have passed
  against an empty DB and certified a harness that migrates nothing. Watch for check-disabling
  edits in implementer output; grep `false &&`, `.skip(`, `xit(` before accepting a task.
  NOTE: harness depends on cwd=repo root (prisma.config.ts discovery); otherwise
  `migrate deploy` fails with "datasource.url is required". Relevant to Task 7 (CI).
- Task 4 (RoomService): COMPLETE (56895a6..8517cec, review clean — spec OK, Approved,
  0 Critical / 0 Important). Reviewer verified the guarded UPDATE is load-bearing (not a
  read-then-write wearing a WHERE clause) and that softDelete guards on `status != ACTIVE`,
  which closes the DRAFT-read/concurrent-activate window. Controller independently re-ran
  gates: build/typecheck/lint green, boundary-check 0 violations (159 modules), unit 54/54
  with no int-spec leaking into the unit lane.
  Both reviewer WARNINGs resolved by controller: (a) gate reality — re-run above; (b) RoomService
  is @Injectable but unwired — Task 6 owns DI registration, so it is task ordering, not a gap.
  MINOR findings rolled up for final-review triage:
  (m1) transition/softDelete each cost 3 round trips; the trailing findUniqueOrThrow sits OUTSIDE
       the guard, so the returned Room may reflect a later concurrent state than the update this
       call made. Harmless in this slice (no caller depends on it). Collapsing to 2 queries via
       updateManyAndReturn would also make the return value exactly the row written.
  (m2) `if (count===0) throw RoomConflictError` + findUniqueOrThrow tail duplicated verbatim in
       both mutations. Two occurrences with differing guards — extract only if a third lands.
  (m3) int-spec test names promise error CODES but assert error CLASSES. 1:1 binding makes it
       equivalent today; asserting .code would make the test say what its name says.
  (m4) uncovered low-value edges: softDelete of a nonexistent room; double softDelete.
- Task 5 (concurrency/atomicity test): COMPLETE (8517cec..c30909c, review clean — spec OK,
  Approved, 0 Critical / 0 Important). Implemented the owner's superseding cancel-vs-cancel design.
  Reviewer verified the test is a REAL detector, not a tautology: removing `status: current.status`
  from the guarded updateMany makes both cancels succeed -> fulfilled.length===2 -> test fails.
  Both schedules proven legitimate (interleaved -> ROOM_CONFLICT via row-lock + EvalPlanQual;
  serialized -> ROOM_TRANSITION_INVALID since CANCELLED is terminal). Stable across 5 runs.
  (m5) MINOR: it() title says "the other conflicts", implying ROOM_CONFLICT specifically, while by
       design either RoomError subclass is legitimate. Comment + assertion disambiguate. Cosmetic.
- Task 6 (RoomModule wiring + core export + server registration): COMPLETE (c30909c..6094fea,
  review clean — spec OK, Approved, 0 Critical / 0 Important). 3 files, 16 lines. Controller
  verified no enforcement config (.dependency-cruiser.cjs, eslint, verify-guardrails, turbo,
  tsconfig) was touched — a green boundary-check here is earned, not bought by weakening a rule.
  Reviewer confirmed the DI graph really resolves: the health e2e compiles the full AppModule and
  Nest eagerly instantiates providers, so a broken RoomModule graph would throw at app.init().
  (m6) MINOR: no module-scoped DI test for RoomModule alone; resolution is verified indirectly via
       AppModule in the health e2e. A future refactor of AppModule's import list could mask a
       RoomModule-specific DI break.
- Task 7 (CI integration lane): COMPLETE (6094fea..ae87514, review clean — spec OK, Approved,
  0 findings). Purely additive 7-line YAML step; all pre-existing gates survive unchanged and in
  original order. Push (brief step 4) SKIPPED per owner. CONSEQUENCE: the CI integration lane is
  verified by INSPECTION ONLY — it has never actually executed in CI.

## ALL 7 TASKS COMPLETE.

## FINAL WHOLE-BRANCH REVIEW (opus, 4dea9cf..ae87514) — Ready to merge: WITH FIXES
Reviewer ran all four lanes itself (unit 54, integration 9, server e2e 3, tsc) — all green — and
empirically proved finding #2 rather than asserting it. Confirmed healthy: guarded UPDATE pins the
exact validated `from` (atomicity is real); state-machine spec asserts an exhaustive 16-pair
partition (proves the allow-list holds nothing EXTRA); deferred seams absent by grep over 12
markers; cwd hazard disproven by running the lane from packages/core; `false &&` failure mode
closed (smoke test cannot pass unmigrated).

### IMPORTANT findings (both are cross-task seam gaps no per-task review could see)
- F1: soft-delete rule DUPLICATED — service hardcodes `status: { not: 'ACTIVE' }` while
  DELETABLE_STATUSES is the declared single source of truth. Design SELF-CONTRADICTS: §3 says
  "таблица — единственный источник истины; методы сервиса не дублируют правил", §4 step 3 spells
  out the literal. OWNER DECISION: §3 governs — derive the guard from DELETABLE_STATUSES.
- F2: nothing binds the Prisma RoomStatus enum to the domain union; `as RoomStatus` hides drift.
  Reviewer proved: an extra Prisma member COMPILES CLEAN under strict, then throws an untyped
  TypeError at runtime instead of a typed RoomError. Fix: compile-time parity assertion.

### OWNER DECISION: add the soft-delete CHECK invariant to the EXISTING migration
`CHECK ("deletedAt" IS NULL OR "status" <> 'ACTIVE')`. Safe to amend in place: the migration has
never been applied to any persistent DB (ephemeral containers only) and the branch is unpushed.
Moves the rule from "service enforces" to "DB enforces" per CLAUDE.md §4 / REQ-RWD-010 philosophy.

### Deferred follow-ups (recorded, NOT fixed — none gating)
- m1: 3 round trips per mutation; trailing findUniqueOrThrow sits OUTSIDE the guard so the returned
  Room may reflect a later concurrent state. Reviewer CONFIRMED `updateManyAndReturn` IS available
  on the pinned Prisma 7.8.0 — a small verified fix when someone next touches this file.
- m2: duplicated `if(count===0) throw` + re-read tail (2 occurrences). A private applyGuarded()
  helper would settle m1+m2+F1 together if this file is revisited.
- m3, m4, m6: deferred by reviewer (1:1 code/class binding; low-value edges; DI coverage is real
  via AppModule e2e, not nominal).
- Minor #6: startTestDb mutates process.env.DATABASE_URL globally and never restores it. Safe only
  because maxWorkers:1. THIS FILE IS THE REUSABLE CORE PATTERN — its sharp edges get inherited.
- Minor #5: 3 containers + 3 migrate deploy runs per integration run (~8s local, slower on cold CI).
- Minor #7: ROOM_TRANSITIONS/DELETABLE_STATUSES readonly only at type level; app-registry set an
  Object.freeze + isFrozen-test precedent for REQ-CORE-004.
- Minor #8: CI runs test:int BEFORE build — a compile break burns a container pull before failing.
- Minor #9: no migration-drift gate. `prisma migrate diff --from-migrations` is UNUSABLE here —
  Prisma 7.8 requires datasource.shadowDatabaseUrl in prisma.config.ts, which is not configured.
  Worth a real gate before there are ten migrations.
- Reviewer note: do NOT "clean up" the tsconfig exclude — ts-jest typechecks specs at run time, so
  coverage is preserved while dist gets cleaner. Deserves a one-line comment.
- CI-environment risk that remains after local verification: Docker-in-runner, postgres:17 pull,
  Ryuk reaper reachability. Watch the first push rather than assume.

## FIX WAVE: COMPLETE (ae87514..79f71d9) — RE-REVIEW (opus): READY TO MERGE = YES
All five findings closed. Re-reviewer independently verified the two that could have been papered
over, rather than trusting the report:
- F2 parity assertion: reproduced the committed type in a scratchpad and ran tsc over 4 variants.
  Baseline passes; Prisma enum gains a member -> TS1360; domain union gains a member -> TS1360;
  SAME-ARITY RENAME (CANCELLED->ABORTED) -> TS1360. The tuple wrapping suppresses distribution, so
  it is an exact mutual-assignability check, not a member count. `void (true satisfies ...)` is
  equivalent in bite to the const form and declares no binding — a real solution to the lint
  constraint, not a dodge (no eslint-disable, eslint.config.js untouched).
- CHECK tests: both raw-SQL tests would FAIL if the constraint were dropped (statements would
  succeed, promises resolve, rejects.toThrow fails). They match on the constraint NAME, so an
  unrelated error can't produce a false pass.
- F1 bonus not claimed in the report: `[...DELETABLE_STATUSES]` flows into a $Enums slot, so a
  domain-union change ALSO fails to compile at the call site, independently of the parity assertion.
- Deferred refactors stayed deferred (2 separate methods, no updateManyAndReturn, no 2nd migration).
Controller independently re-verified: int lane 11/11, all gates green, boundary-check 0/162,
schema fully reverted (enum exactly 4 members), no disabled checks anywhere.

### KEY OPERATIONAL FACT
The migration was AMENDED IN PLACE, changing its checksum. Safe only under the owner's stated
premise: never applied to a persistent DB, branch unpushed. ONCE MERGED AND APPLIED ANYWHERE,
`20260718061612_room_lifecycle/migration.sql` MUST BE TREATED AS FROZEN.

### Remaining cosmetic items (no correctness risk, fold into the planned refactor)
- Minor #3 closed only on the CANCELLED arm; the DRAFT soft-delete (int-spec.ts:122) still asserts
  deletedAt alone. Orthogonality proven for 1 of 3 deletable statuses.
- schema.prisma has no breadcrumb that a hand-written CHECK exists on Room (discoverability only;
  Prisma cannot drop what it does not model). Residual hazards are `prisma db push` (used nowhere)
  and regenerating the migration from scratch — both caught by the new int tests in CI.
- DELETABLE_STATUSES now crosses a module boundary as a live Set (ReadonlySet blocks .add() only
  pre-cast). A frozen readonly array would be tighter. Not a REQ-CORE-004 violation.
- Third Postgres container in the int-spec file (now 3 per run).
- Judgment call accepted as shipped: total canTransition turns a corrupt-enum crash into a routine
  ROOM_TRANSITION_INVALID — a data-integrity alarm wearing a client-error costume. Mitigated: the
  message interpolates `from`, and the parity assertion makes drift a BUILD failure, so this path
  should never fire.

## PLAN COMPLETE — 7/7 tasks + fix wave. Awaiting owner decision on how to finish the branch.

## PRE-FLIGHT DECISIONS (owner, this session)
- Task 5 concurrency test: plan's `activate` + `cancel` pair is SCHEDULE-DEPENDENT — if the two
  serialize, the loser reads ACTIVE and ACTIVE->CANCELLED is legal, so BOTH succeed and the test
  fails without any real defect. Owner chose the robust pair `cancel` + `cancel`: exactly one wins
  under every schedule (race -> ROOM_CONFLICT from the guarded UPDATE; serialized ->
  ROOM_TRANSITION_INVALID since CANCELLED is terminal). Assert one fulfilled / one rejected with
  `RoomError`, final status CANCELLED. The plan's claim "intermittent failure = not atomic = real
  defect" is WRONG and must not be reproduced in a comment.
- Task 7 step 4 (`git push -u origin`): SKIPPED by owner decision — standing "push deferred" since
  phase 0 still governs. Do steps 1-3 (ci.yml + commit) only. Consequence: the integration lane is
  verified locally only; CI has NOT actually run it.

## MERGED (2026-07-18): phase-1-room-lifecycle -> main, --no-ff merge cfe0220.
All gates re-verified ON THE MERGED RESULT (not just on the branch): build, typecheck, unit 5/5
tasks, lint, boundary-check 0 violations / 162 modules, guardrails alive, integration lane 11/11.
Feature branch deleted (was 79f71d9). main is now 13 commits ahead of origin/main — NOT pushed.

### CORRECTION TO EARLIER LEDGER STATE (was wrong, propagated into a decision)
The pre-existing note "Push DEFERRED (standing owner decision since phase 0)" and "main 44 commits
ahead of origin/main" were STALE. Actual state at session start: main == origin/main (4dea9cf),
whose commit message reads "backlog pushed to origin/main 2026-07-18; push-deferred lifted".
The controller cited the stale note when asking the owner whether to push in Task 7, so that
decision was made on a false premise. The owner still chose not to push (decision stands), but
THERE IS NO STANDING PUSH DEFERRAL ANYMORE. Do not re-cite it. Verify push state with
`git branch -vv` before making claims about it.

### CONSEQUENCE STILL OPEN
The CI integration lane (`pnpm run test:int` in ci.yml) has NEVER EXECUTED IN CI — verified locally
only. CI-environment-specific risks remain unproven: Docker-in-runner, postgres:17 image pull, Ryuk
reaper reachability on ubuntu-latest. Watch the first push rather than assume it passes.

### FROZEN FROM NOW ON
`packages/core/prisma/migrations/20260718061612_room_lifecycle/migration.sql` was amended in place
(CHECK constraint added), changing its checksum. That was safe only while unapplied and unpushed.
It is now merged — treat the file as immutable; any further change goes in a NEW migration.

---
# Identity minimal seam — SDD execution (session 2026-07-22)

Plan: docs/sessions/2026-07-22-identity-minimal-seam-implementation-plan.md
Design: docs/sessions/2026-07-22-identity-minimal-seam-design.md
Branch: phase-1-identity-seam
BASE (branch start): 910d2ed44b86bf375784c605aec3070315d2dc16

## Tasks
- Task 1: SDK vocabulary (identityKind, memberRole) — COMPLETE (commits 910d2ed..508e958, review clean)

## Minor findings roll-up (for final whole-branch review triage)
- Task 1: comment typo in packages/sdk/src/identity/identity-kind.fixtures.ts — says "Unknown roles" in the kind fixture ("roles" → "kinds"); inherited verbatim from plan text.
- Task 2: Identity model + partial unique index migration — COMPLETE (commits 508e958..a74f057, review clean)

## Minor findings roll-up (continued)
- Task 2: presence test in identity-schema.int-spec.ts doesn't assert UNIQUE/indexed column (behavioral tests catch it — defense-in-depth only).
- Task 2: no cross-kind case (GUEST with same email as live REGISTERED allowed) — brief didn't mandate it.
- Task 3: FK organizerId→identity + room test repair — COMPLETE (commits a74f057..3595d54, review clean; harness.int-spec.ts out-of-brief repair verified as forced+minimal)

## Minor findings roll-up (continued)
- Task 3: harness.int-spec.ts seed omits email (defaults null) — fine, noted for consistency.
- Env note (from Task 3 implementer): `migrate dev` did NOT regenerate the client; explicit `prisma generate` needed DATABASE_URL set. Carry into Task 4.
- Task 4: guarded INSERT in RoomService.create — COMPLETE (commits 3595d54..8086a54, review clean)
ALL 4 TASKS COMPLETE. Final whole-branch review next.

## Minor findings roll-up (continued)
- Task 4: malformed non-UUID organizerId → raw Postgres uuid-syntax error (not typed). Reviewer verdict: out of scope, boundary-layer item for the first transport. Track as follow-up.

## FINAL WHOLE-BRANCH REVIEW (2026-07-22, fable): Ready to merge — YES.
Cross-task invariants verified: guarded-INSERT predicate == partial-index predicate (change-both-or-neither holds); RETURNING * shape matches Room model; frozen migration untouched; migration chain applies from zero; design §6 not-built seams all not built.
Fix-before-merge: fixture comment typo → FIXED in c79c242 (fix(sdk): correct fixture comment typo).
Follow-ups for the first identity-writing flow (guest-join/OAuth) plan: (a) indexdef presence test assert UNIQUE/column; (b) cross-kind index case GUEST==REGISTERED email allowed; (c) malformed non-UUID organizerId → typed error mapping at boundary layer (REQ-SEC-006); (d) harness.int-spec.ts seed email cosmetic; (e) stale jest.integration.config.js comment "per file" → "per describe".
Branch head: c79c242. Ready for finishing-a-development-branch.

## MERGED (2026-07-22): phase-1-identity-seam -> main, --no-ff merge 75b97b7.
All gates re-verified ON THE MERGED RESULT: boundary-check 0 violations / 170 modules, guardrails alive, SDK 162/162, core typecheck + unit 55/55 + lint + int 21/21. Feature branch deleted (was c79c242). main is 9 commits ahead of origin/main — NOT pushed (owner decision).
Migrations 20260722151900_identity_seam and 20260722153952_room_organizer_fk are now FROZEN (merged) — further changes only as new migrations.

# PLAN: Lifecycle log emit (docs/sessions/2026-07-22-realtime-log-lifecycle-emit-implementation-plan.md)
Design: docs/sessions/2026-07-22-realtime-log-lifecycle-emit-design.md
Branch: phase-1-lifecycle-log-emit. Headline: REQ-RT-010 (+ REQ-RT-001, REQ-RT-007, REQ-DEV-008).
BASE (branch start): ef2f5cb610e3a57efc2edeb8d7b8d264f6099b58
Briefs/reports: .superpowers/sdd/lifecycle-emit/

## Tasks
- Task 1: realtime.LogEvent migration + presence test — COMPLETE (commits ef2f5cb..b5dee43, review clean)
  - Implementer deviation approved by reviewer: PK assertion toBe('PRIMARY KEY ("roomId", seq)') — brief's toContain('"seq"') unsatisfiable (Postgres quotes only identifiers that need it).
  - Minor (for final review triage): FK presence test doesn't assert ON UPDATE CASCADE / referenced columns (inherited from brief); exact-string PK assertion coupled to pg_get_constraintdef formatting (theoretical; testcontainer pins image).
  - NEW FROZEN MIGRATION after merge: packages/core/prisma/migrations/<timestamp>_realtime_log_event/migration.sql (per HANDOFF freeze rule).
- Task 2: EventLogService.commitCoreEvent + RealtimeModule + readRoomLog — COMPLETE (commits b5dee43..ab20211, review clean)
  - Implementer deviation approved by reviewer: advisory-lock statement uses $executeRaw (not brief's $queryRaw) — Prisma 7.8 adapter-pg cannot deserialize void (OID 2278); semantics identical, comment added.
  - Reviewer verified named risks: SDK registry has schema/visibility/version per name; z.strictObject makes payload-rejection test real; Task 1 enum cast matches; hashtextextended single-bigint overload correct.
  - Minor (final-review triage): RoomLogRow.visibility typed string not SDK Visibility union (brief-verbatim, test-only); rows[0] unchecked (aggregate INSERT…SELECT always yields one row).
  - NOTE for future plans: $queryRaw on void-returning statements is a Prisma-7.8-adapter-pg trap — plan text should prescribe $executeRaw for pg_advisory_xact_lock.
- Task 3: RoomService.transition в транзакцию + lifecycle-эмит — COMPLETE (commits ab20211..bcce15a, review clean)
  - Ripple fix beyond brief: 4th constructor call-site in event-log.int-spec.ts (Task 2 fixture) — reviewer grep-verified exactly 5 call-sites total, all updated.
  - Reviewer verified: activate/complete/cancel delegate to transition (emission map covers them); softDelete independent, no emission; Nest DI resolves via RealtimeModule export.
  - No Minor findings.
- Task 4: экспорты, регистрация, гейты, boot — COMPLETE (commits bcce15a..b2cacb7, review clean)
  - Gates: boundary-check 0 violations (controller spot-verified), guardrails OK, lint/typecheck/build green, unit 220/220, int 33/33.
  - Boot: fresh compose stack, 4 migrations applied incl. realtime_log_event, /health/ready 200, torn down; lt-pg untouched.
  - Reviewer verified export-* surface: only RealtimeModule + EventLogService exported, no leakage.
  - No Minor findings.

## FINAL REVIEW (ef2f5cb..b2cacb7, 4 commits): Ready to merge — YES. No Critical/Important.
- Reviewer independently re-ran ALL gates on HEAD: int 33/33 (4 migrations deploy clean), unit 55/55 core + 162/162 SDK, lint, typecheck, boundary-check 0 viol, guardrails 3/3.
- Atomicity verified at depth: no lock cycle (Room row lock always before advisory lock; commitCoreEvent never touches Room row); seq density structural.
- Both deviations re-approved at branch level.
- Minors triaged: all 4 leave-as-follow-up. One NEW minor: lock-ordering convention (advisory lock leaf-most, never touch room."Room" after acquiring) undocumented — add one comment line in the next realtime slice that touches event-log.service.ts, no dedicated commit.
- Recommendations for future slices: keep DRAFT→ACTIVE→COMPLETED one-row test as regression anchor for room.activated; event-commit plan must pick up deferred actorId≠null + payload-neutrality tests from design §10.

## MERGED (2026-07-22): phase-1-lifecycle-log-emit -> main, --no-ff merge.
Merged tree byte-identical to reviewed HEAD b2cacb7 (verified: empty diff + unit smoke 55/55).
Branch deleted. Migration packages/core/prisma/migrations/20260722180147_realtime_log_event/migration.sql is now FROZEN per HANDOFF rule.
Slice COMPLETE: 4/4 tasks, all reviews clean, final review ready-to-merge.

# PLAN: appSettings write path (docs/sessions/2026-07-23-appsettings-write-path-implementation-plan.md)
Design: docs/sessions/2026-07-23-appsettings-write-path-design.md
Branch: phase-1-appsettings-write-path. Headline: REQ-RT-004 (+ REQ-CORE-007, REQ-RT-010→3/3).
BASE (branch start): f6daf68f3675701f95b740514c94cce26c028311
Briefs/reports: .superpowers/sdd/appsettings-write-path/

## Tasks
- Task 1: room app config migration + CHECK Room_config_triple — COMPLETE (commits f6daf68..3ab4dd1, review clean)
  - Minor (final-review triage): accept-тест не ассертит reread.appSettings end-to-end (brief-inherited); 3 из 6 partial-форм покрыты (остальные — по построению предиката); в плане форма `test:int -- -t` миспарсится jest — рабочая форма без `--`, донести до Tasks 3–4.
- Task 2: AppRegistryService.validateSettings (ajv + кэш) — COMPLETE (commits 3ab4dd1..4fe39b4, review clean)
  - Minor (final-review triage): нет негативного теста на не-object settings (null/строка) — путь тот же APP_SETTINGS_INVALID; ValidateFunction импортирован из draft-07 entry ('ajv'), а не из 'ajv/dist/2020' — type-only, безвредно; ключ кэша `appId@version` предполагает отсутствие '@' в appId (slug-конвенция).
- Task 3: RoomService.configure write path — COMPLETE (commits 4fe39b4..e23b63e, review clean)
  - Ripple beyond brief (grep-verified, compile-necessary): 6-й call-site конструктора в realtime/event-log.int-spec.ts — обновлён атомарно с конструктором.
  - Minor (final-review triage): success path — 2 запроса (updateMany + findUniqueOrThrow), brief-mandated, race-harmless при одной реплике; re-configure тест ассертит только appSettings (полная замена тройки не доказана независимо, но implausible при single-statement updateMany).
- Task 4: activation gate + room.activated emit — COMPLETE (commits e23b63e..b89dfcc, review clean, opus-ревьюер)
  - Named risks проверены ревьюером: leaf-most advisory lock сохранён (эмит — последний шаг, после него записи в room."Room" нет); все 14 .activate( call-sites — либо с configureQuiz, либо отказ до гейта конфигурации.
  - Minor (final-review triage): повторно — форма `test:int -- -t` в плане миспарсится; рабочая без `--`.
- Task 5: полные гейты + живой boot — COMPLETE (no commits; verification-only)
  - Gates: lint/typecheck/test (sdk 162, core 62, server 3)/test:int 49/boundary-check 0 viol (196 modules)/guardrails 3/3/build — все зелёные.
  - Boot: compose build fresh, /health/ready 200, _prisma_migrations 5 строк (последняя 20260723090841_room_app_config), down -v, lt-pg нетронут.
ALL 5 TASKS COMPLETE. Final whole-branch review next.

## Minor findings roll-up (для триажа финального ревью)
- Task 1: accept-тест не ассертит reread.appSettings end-to-end (brief-inherited); 3 из 6 partial-форм CHECK покрыты (остальные — по построению предиката).
- Task 2: нет негативного теста на не-object settings (null/строка); ValidateFunction импортирован из 'ajv' (draft-07 entry), а не 'ajv/dist/2020' — type-only; ключ кэша `appId@version` предполагает отсутствие '@' в appId.
- Task 3: success path configure — 2 запроса (updateMany + findUniqueOrThrow), race-harmless при одной реплике; re-configure тест ассертит только appSettings.
- Task 4: в плане форма `test:int -- -t` миспарсится jest (рабочая — без `--`) — поправить в плане для будущего переиспользования.

## FINAL WHOLE-BRANCH REVIEW (2026-07-23, fable): Ready to merge — YES. No Critical/Important.
Кросс-задачные инварианты проверены: post-lock re-read держит пин события == замороженной строке при любом исходе гонки; advisory lock leaf-most, configure не создаёт цикла блокировок; CHECK недостижим из сервисного пути; все отказы активации — throw в транзакции с полным откатом; швы §9 не построены (нет HTTP, actorId null, SDK не тронут); замороженные миграции нетронуты (только +20260723090841_room_app_config).
Minor-триаж: всё leave-as-follow-up. Ключевой follow-up пакет (рекомендация ревьюера, ~15 строк, в следующий срез или отдельно):
  (a) guard в configure на settings === undefined/null → AppSettingsInvalidError (сейчас: сырая P2011 от CHECK либо silent stale settings при re-configure с permissive-схемой);
  (b) ValidateFunction импорт из 'ajv/dist/2020' вместо 'ajv';
  (c) race-тест со второй версией манифеста (quiz@2) — сделать ассерт пина содержательным;
  (d) зафиксировать допущение "settings — не-null JSON" в контрактных доках при появлении транспорта.
Верифицировано ревьюером: appIdSchema = [a-z][a-z0-9-]* — '@' в appId невозможен, ключ кэша совпадает с registryKey 1:1 (не-проблема).
Branch head: b89dfcc (4 коммита от f6daf68). Ready for finishing-a-development-branch.

## MERGED (2026-07-23): PR #1 phase-1-appsettings-write-path -> main, merge commit eaada54.
Merged tree byte-identical to reviewed HEAD b89dfcc (empty diff); unit smoke 5/5 green.
Local + remote feature branch deleted. main == origin/main (eaada54).
Migration packages/core/prisma/migrations/20260723090841_room_app_config/migration.sql is now FROZEN per HANDOFF rule.
Slice COMPLETE: 5/5 tasks, all reviews clean, final review ready-to-merge.
