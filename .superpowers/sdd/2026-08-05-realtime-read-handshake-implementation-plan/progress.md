# SDD ledger — plan: docs/sessions/2026-08-05-realtime-read-handshake-implementation-plan.md
Task 1: complete (commits 3d7de83..7957449, review clean)
Task 2: complete (commits 7957449..23cfa4d, review clean)
Task 2: minor (deferred): нет негативных кейсов strictObject для ack-схем; realtime-фикстуры не ре-экспортированы из index.ts (понадобятся — добавить экспорт)
Task 3: complete (commits 23cfa4d..df47465, review clean)
Task 3: minor (deferred): RealtimeError импортирован value-импортом при type-only использовании (verbatim из плана; на усмотрение Task 9 lint)
Batch 1 (Tasks 1-3) complete df47465
Task 4: complete (commits df47465..bf1f432, review clean)
Task 5: complete (commits bf1f432..45083ee, review clean, 1 important deferred)
Task 5: important (deferred to Task 7): RealtimeBus.publish синхронно пропагирует исключения слушателей — когда gateway fan-out подпишется (Task 7), бросок в fanOut отклонит outbox.run ПОСЛЕ успешного коммита. Адресовать в Task 7 (try/catch в fanOut или изоляция слушателей в bus); зафиксировано в dispatch Task 7 и в батч-отчёте владельцу.
Task 5: minor (deferred): RealtimeBus без unsubscribe/лимита слушателей — легально при одной реплике и одном подписчике (gateway)
Task 6: complete (commits 45083ee..3f27ea6, review clean)
Task 6: minor (deferred, for Task 7 dispatch): SubscriptionRegistry.add не идемпотентен при смене (identityId, roomId) для того же socketId — контракт вызывающего «remove перед re-add» либо защитная чистка в add; учесть в Task 7
Batch 2 (Tasks 4-6) complete 3f27ea6
Batch 3 started; owner sanctioned deviation: fanOut в gateway изолирует исключения (try/catch + server log), чтобы бросок слушателя не отклонял outbox.run после коммита (Task 5 important).
Task 7: complete (commits 3f27ea6..b6cd3b5, review clean after adjudication)
Task 7: important → SANCTIONED owner 2026-08-05 (fix in Task 8): handleSubscribe error-containment — try/catch → ack {code:'INTERNAL_ERROR'} + server log + тест; verbatim-план нарушал дух REQ-SEC-006 (unhandled rejection, риск падения единственной реплики)
Task 7: out-of-brief adjudicated: .dependency-cruiser.cjs — dist-исключение в pathNot правила socketio-only-in-realtime (CI build→boundary-check ловил скомпилированные .d.ts); ревью подтвердил: src-покрытие не ослаблено, правило на src-probe срабатывает
Task 7: minor (deferred): dead code claims2 в gateway spec (verbatim плана); createIOServer returns unknown (разрешено планом)
Task 8 fix commit 2d4799a: review clean (spec ✅, approved, 2 minor deferred)
Task 8: minor (deferred): asLogEvent fallback ?? row.visibility — fail-open при расширении enum; кандидат fail-closed throw
Task 8: minor (deferred): io-adapter httpServer: object — слабая типизация, косметика
Task 8: bug fixes adjudicated clean: visibility-нормализация staged-событий (raw DB label vs Prisma enum — известная ловушка adapter-pg), httpServer в ConfigurableIoAdapter (prod main.ts тоже был затронут)
Task 8: boundary — owner 2026-08-05: якорь to.path на серверный пакет socket.io (trailing separator), socket.io-client вне правила
Task 8: complete (commits b6cd3b5..1c28137, review clean; boundary anchor probe-confirmed)
Task 9: complete (gates green: build/lint/typecheck/test/test:int/boundary-check/guardrails)
Final review: WITH FIXES — I-1 (subscribe order lossy vs design §4) + M-1 (replay visibility e2e) SANCTIONED owner 2026-08-05; minors M-2..M-5 ride
Final-review fix wave: complete (commit 3483503, re-review: both ADDRESSED, no new breakage)
SLICE COMPLETE: 9/9 tasks + final review clean 3483503
