# SDD ledger — plan: docs/sessions/2026-07-30-transport-http-auth-implementation-plan.md
Task 1: minor (deferred): stale test name in error-codes.contract.spec.ts ("design §8" — now also REQ-SEC-006 codes)
Task 1: minor (deferred): no test asserting `code` itself is trimmed in joinRequestSchema (only displayName trim covered)
Task 1: complete (commits f4ec5a7..6ca517e, review clean)
Task 2: minor (deferred): REFRESH_TOKEN_TTL has no .max() upper bound (capped effectively by GUEST_TTL invariant)
Task 2: minor (deferred): no equality-boundary test (REFRESH==GUEST passes) / lower-bound rejection tests for new numeric fields
Task 2: complete (commits 6ca517e..5e3609d, review clean)
Task 3: minor (deferred): plan's `-t "Session schema"` jest filter matches zero tests (double-quote inside describe name) — filter should be `-t "Session"`; spec kept verbatim per brief, tests ran green via file-path filter
Task 3: minor (deferred): unique-index assertion is ILIKE-based (looser than membership spec's exact indexname match) — brief-prescribed
Task 3: complete (commits 5e3609d..7503459, review clean; report initially miswritten to ~/.superpowers, canonical copy restored)
Batch 1 (tasks 1-3) COMPLETE 2026-07-30; next batch: tasks 4-5 (TokenService) in a new session per owner batching decision
Task 4: minor (deferred): familyId asserted only as expect.any(String) — no uuid-format/per-call-distinctness assertion (brief-verbatim test)
Task 4: minor (deferred): AuthError message embeds raw jsonwebtoken error text — safe while REQ-SEC-006 filter ships only code outward
Task 4: complete (commits e365a5f..eaba0d8, review clean)
Task 5: minor (deferred): expired-session test uses unscoped updateMany (no where) — harmless under TRUNCATE isolation, fragile if seed grows
Task 5: minor (deferred): guest Identity rows accumulate across tests (TRUNCATE misses identity."Identity") — inherited from membership spec pattern
Task 5: complete (commits eaba0d8..d71e1b2, review clean; race-test alive-count predicate corrected to {revokedAt: null, replacedById: null} per design §4; terminal-room seed via cancel per brief allowance)
Batch 2 (tasks 4-5) COMPLETE 2026-07-30; next batch: tasks 6-8 (limiter/filter/TransportModule) in a new session per owner batching decision
Task 6: minor (deferred): new tests reach into private `attempts` map via cast — couples test to field name (brief-prescribed)
Task 6: minor (deferred): mixed comment languages in join-rate-limiter.ts (English header, Russian inline) — brief-verbatim
Task 6: complete (commits ccfaca9..83ce6da, review clean)
Task 7: minor (deferred): HttpException classified twice (instanceof in catch + toWireCode) — single {code,status} classification tidier
Task 7: minor (deferred): getResponse<ReplyLike>() unchecked cast; ReplyLike structural instead of FastifyReply (core lacks fastify dep — justified, adapter-agnostic); HttpException keeps own status per plan table (404→REQUEST_INVALID)
Task 7: minor (deferred): SDK ContractError unmapped → 500 INTERNAL_ERROR (design-conformant; flag for configure-HTTP slice)
Task 7: complete (commits 83ce6da..4853742, review clean)
Task 8: minor (deferred): auth.controller imports JoinRateLimiter/JoinRateLimitedError from membership — layering smell, candidate shared-kernel rename if a third transport appears
Task 8: minor (deferred): join responds 201 (Nest default) while refresh pinned 200 — spec-silent; Task 10 e2e should assert join status consciously
Task 8: minor (deferred): RequestLike.cookies typed always-defined but runtime depends on @fastify/cookie registration in apps/server (Task 9 duty; Task 10 e2e is the guard)
Task 8: complete (commits 4853742..4394208, review clean; structural RequestLike/ReplyLike in transport/http.types.ts per Task 7 pattern — no fastify dep in core)
Batch 3 (tasks 6-8) COMPLETE 2026-07-30; next batch: tasks 9-10 (server wiring, HTTP e2e) in a new session per owner batching decision
Task 9: minor (deferred): commit 55afe8f lacks Co-Authored-By trailer (brief dictated exact commit command) — consistency note for final review
Task 9: minor (deferred): loadConfig parses env twice per boot (main.ts + ConfigModule factory) — harmless, arguably intentional
Task 9: minor (deferred): bootstrap path unexercised by tests — real plugin boot verified only in Task 12 docker smoke
Task 9: FORWARD-NOTE Task 12: compose sets NODE_ENV=production → refresh cookie Secure over plain HTTP → cookie-honoring client won't round-trip it; smoke must assert Set-Cookie header or use non-cookie-jar client
Task 9: complete (commits 28a9a6b..55afe8f, review clean)
Task 10: minor (deferred→HANDOFF at Task 12): core barrel re-exports testing/postgres.testcontainer → apps/server boot requires testcontainers at require-time; safe while Dockerfile ships full node_modules, crashes prod boot if devDeps ever pruned — HANDOFF line required
Task 10: minor (deferred→HANDOFF at Task 12): NODE_OPTIONS=--experimental-vm-modules pinned in apps/server test script (ESM-only cookie@2 under jest 29 CJS; verified, confined to test script) — revisit on jest 30 or @fastify/cookie require(ESM)
Task 10: minor (deferred): TRUNCATE list excludes identity."Identity" (ORG seeded once per file, mirrors token int-spec, commented in spec)
Task 10: complete (commits 55afe8f..a6bb3ad, review clean; deviations adjudicated: vm-modules acceptable, @mymozhem/sdk direct dep sound, cancel-for-COMPLETED intent preserved)
Batch 4 (tasks 9-10) COMPLETE 2026-07-30; next batch: tasks 11-12 (seed script, gates+smoke+HANDOFF) in a new session per owner batching decision
Task 11: minor (deferred): create-room.mjs findFirst matches exact email but unique index is lower(email) — case-variant email → raw unique-violation instead of reuse (edge case, seed script)
Task 11: minor (deferred): dist/*.js subpath imports silently bypass any future `exports` field on @mymozhem/core — note in the barrel-fix follow-up
Task 11: minor (deferred→FOLLOW-UP candidate): prod barrel of core requires testcontainers at load time (testing exports) — split testing into separate entry point; do not let the subpath workaround become permanent
Task 11: complete (commits 6ff7614..386802e, review clean; subpath imports justified+verified, joinPolicy=GUESTS cosmetic, 2-run idempotency verified)
Task 12: complete (gates green: build/lint/typecheck/unit 320/int 88/boundary-check/guardrails; docker smoke passed 403 ROOM_JOIN_DENIED; no code commit)
Batch 5 (tasks 11-12) COMPLETE 2026-07-30 — plan fully executed (12/12)
Final review: MERGE-READY, 1 Important (reuse-detection unlogged, design §11) — owner ruled fix-before-merge
Final fix: 519fd8a logger.warn on AuthError branch + spec flip — re-review: ADDRESSED, no new breakage, no token material in logs
Final review residual risks (for merge/HANDOFF): strict rotation retry edge (lost response → benign retry revokes family, REQ-ID-007 as designed); access tokens valid ≤15min after termination (design §11 accepted); health 503 body now {code:INTERNAL_ERROR}; REGISTERED rotation must not inherit guest TTL cap (OAuth slice); separate-origin web client needs CORS credentials revisit
