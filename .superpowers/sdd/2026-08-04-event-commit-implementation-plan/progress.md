# SDD ledger — plan: docs/sessions/2026-08-04-event-commit-implementation-plan.md
Task 1: complete (commits fc53f2d..39f3a2e, review clean)
Task 2: complete (commits 39f3a2e..c54d5a0, review clean)
Task 3: minor (deferred): eventValidatorFor cache key ignores schema arg — stale validator if called twice with same key+different schema; accepted design (mirrors validatorFor), single caller in Task 5
Task 3: complete (commits c54d5a0..ec7f15e, review clean; ⚠️ resolved: fields pre-exist per green typecheck, TS target ES2023 — extends Error safe)
Task 4: complete (commits ec7f15e..f9e3076, review clean; behavior-preservation corroborated by diff — no assertion edits)
Task 5: minor (deferred): JSON.stringify before schema validation — undefined/BigInt/circular payload throws raw TypeError, not contract error (accepted design edge, prescribed step order)
Task 5: minor (deferred): oversized payload for unknown type yields EVENT_PAYLOAD_TOO_LARGE not EVENT_TYPE_UNKNOWN (deliberate cheap-rejections-first order)
Task 5: complete (commits f9e3076..964859c, review clean; only sanctioned deviation — unused import removed)
Task 6: complete (commits 964859c..2794691, review clean)
Task 7: complete (commits 2794691..57b32ec, review clean)
Task 8: minor (deferred): test 2 не проверяет round-trip содержимого blob под гонкой (integrity payload покрыт более ранними describe)
Task 8: complete (commits 57b32ec..64d2447, review clean; 3 прогона без флаков)
Task 9: complete (no commits — gates all green, coverage 12/12 verified; spot-checked by controller)
Final review (fable): With fixes — 0 Critical, 2 Important (TOCTOU REQ-RT-016; raw TypeError stringify), 4 Minor
Owner decisions: TOCTOU + stringify — fix now; error-name parity — leave, record core→contract mapping seam in HANDOFF
Final fix wave: 1 round (commits 64d2447..aefe96d; re-review: all ADDRESSED, no new breakage)
Final review: CLEAN (fixes verified)
Residual minors (ride): eventValidatorFor schema-arg (Task 3), size-before-registry precedence (by design), lazy fail of uncompilable schemas (app-registration slice), 6 manual construction sites drift
