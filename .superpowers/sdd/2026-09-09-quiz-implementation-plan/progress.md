# SDD ledger — plan: docs/sessions/2026-09-09-quiz-implementation-plan.md

Worktree: `.worktrees/quiz` (branch `quiz`, BASE = a75346e = main HEAD + gitignore .worktrees). Spec: `docs/sessions/2026-09-09-quiz-module-design.md` (утверждена владельцем) — читана контролёром. Prisma client сгенерирован в worktree (`DATABASE_URL` dummy, generate only). Baseline: build + all unit/e2e зелёные до старта.

## Pre-flight scan (2026-09-09)

Проверено вживую против кода (grep/read):

| Пара/точка | Что проверено | Результат |
|---|---|---|
| T1 → T6/T11 | `CONTRACT_ERROR_CODES`, `ContractError(code, message)` ctor, место перед `INTERNAL_ERROR` | OK, сигнатуры совпадают |
| T2 → T8 | `displayNameSchema` в `sdk/src/identity/display-name.ts`; wire lowercase spectator → `MemberRole` маппинг в membership | OK |
| T3 → T6/T9 | `manifestEventSchema` (manifest.schema.ts:30s), `define-app.ts` маппинг; литералы манифестов: sdk fixtures, `realtime.e2e-spec.ts` TEST_APP (вкл. `round.hinted`), `event-commit.int-spec.ts` TEST_APP (`note.posted`/`secret.recorded`) | OK; grep-список в плане полон (`round.hinted` живёт в realtime.e2e, не в event-commit) |
| T4 → T6, T9–11 | `shortEventNameSchema` (events/event-type.ts:27), `MemberRole`, `AppManifest`, `visibilitySchema` — существуют в SDK | OK |
| T5 → T7/T12 | seam `AppRegistryModule.register`; e2e `overrideProvider(APP_MANIFESTS)` совместимость | OK (динамический провайдер переопределяется тем же API) |
| T6 consumes | `getEventDefinition`/`eventValidatorFor`/`describeEventErrors` (app-registry.service.ts:52/62/78), `findActiveMembership` (membership.service.ts:64), `commitAppEvent(tx, roomId, name, payload, visibility, actorId)` (event-log.service.ts:108), `RoomNotActiveError`/`EventPayloadInvalidError` (realtime.errors.ts), Room.appId/manifestVersion/appSettings (schema.prisma:44-46), `readRoomLog` (testing/read-room-log.ts) | OK, все сигнатуры совпадают |
| T6 wire-коды | `RoomNotActiveError` → wire `ROOM_LOG_SEALED`, `EventTypeUnknownError` → `EVENT_UNKNOWN_TYPE` (error-mapping.ts); `wireCodeOf` обрабатывает и RealtimeError, и ContractError напрямую (gateway:283-289) | OK — ожидания тестов плана на уровне wire верны |
| T7 | `handlePublish` (gateway:193-223): `sub.roomId`, `claimsOf(socket).sub`, `resolveTypeOwner` — имена совпадают со сниппетом плана; `effectiveVisibility` удаляется | OK |
| T8 | count фильтрует `role: 'PARTICIPANT'` уже (membership.service.ts:181) — спектатор слота не занимает без правок лимита; `SPECTATOR` в Prisma-enum есть (schema.prisma:156) | OK |
| T9 | `readPropertyVisibility` существует (define-app.contract.spec.ts:5), `.meta({x-visibility})` — паттерн фазы 1 | OK |
| T13 | harness realtime.e2e (createApp/connect/emitAck/waitEvent), `seedIdentity`, `RoomService.create(organizerId, joinPolicy='guests')` | OK |

### Rulings pre-flight

- **Ruling: T6 тест 8 «seq плотные 1..20» — ассерт плотности относительно baseline** (seq первого app-события), не абсолютных 1..20: в логе комнаты уже есть lifecycle-события (create/configure/activate) до app-событий. То же для теста 1 «два события подряд» — консекутивность среди app-событий. — Почему: буквальное 1..20 невыполнимо при существующем lifecycle-эмите (фаза 1). — Цена ошибки: тест чуть слабее абсолютной формулировки; плотность и полнота проверяются.
- **Ruling: worktree создан git-fallback, не EnterWorktree** — нативный инструмент по дефолту ветвится от origin/main (20 коммитов позади local main, потерял бы фазу 1 и правки спеки 1.5.0). Ветвление от `main` HEAD (a75346e). — Цена ошибки: нет, ветка `quiz` от корректной базы.

Task 1: complete (commits a75346e..7112534, review clean — spec ✅, quality Approved; ⚠️ trailer проверен контролёром: есть). Отклонение исполнителя: фикстура несовместимого диапазона >=1.5.0 → >=1.6.0 в contract-version.contract.spec.ts (неизбежное следствие bump'а, семантика «следующий minor» сохранена) — reviewer подтвердил корректность.
Task 2: complete (commits 7112534..eafee47, review clean — spec ✅, quality Approved, без findings; ⚠️ trailer проверен контролёром: есть).
Task 3: complete (commits eafee47..2d4c39c, review clean — spec ✅, quality Approved; ⚠️ trailer проверен контролёром: есть). Исполнитель обновил 2 манифест-литерала вне явного списка брифа (event-outbox.int-spec, db-down.int-spec) — grep-обязанность брифа, reviewer подтвердил необходимость.
Task 3: minor (deferred): отклонение missing-clientInitiated покрыто опосредованно через invalidManifestCases (нет отдельного it в manifest.contract.spec) — паттерн файла; `?.clientInitiated` в ассертах — verbatim из плана (plan-mandated).

## Батч-граница (решение владельца 2026-09-09): батчи по 3 задачи, каждый батч — новая сессия.
## БАТЧ 1 (Tasks 1-3) ЗАКРЫТ. Следующая сессия: батч 2 = Tasks 4-6 (SDK рантайм-контракт; APP_MANIFESTS seam; app-runtime диспетчер).
Task 4: complete (commits 2d4c39c..4f994ff, review clean — spec ✅, quality Approved; ⚠️ trailer проверен контролёром: есть). Отклонение исполнителя: `core.round.opened` исключён из invalid-shortName кейсов — валидный dotted shortName по shortEventNameSchema; reviewer подтвердил против event-type.ts:14. Minor (deferred): describe-лейбл спека говорит REQ-CTR-002/003, задача закрывает и 005.
Task 5: complete (commits 4f994ff..9a161e4, review clean — spec ✅, quality Approved, без findings; trailer проверен ревьюером: есть). Санкционированное отклонение: describe('AppRegistryModule') в app-registry.service.spec.ts переведён на register([]) — статический импорт теперь fail-closed ломается; reviewer подтвердил сохранность покрытия.
Task 6: complete (commits 9a161e4..13d5d0e, review clean — spec ✅, quality Approved; trailer есть). Named-risk проверки ревьюера чистые: commitAppEvent сигнатура, outbox.run семантика, коллизии экспортов. Оба ruling контролёра (baseline-seq, 20 акторов) соблюдены.
Task 6: minor (deferred): CacheEntry.lastSeq пишется, не читается — plan-mandated shape (точка будущей эвикции); pin-mismatch переиспользует EVENT_UNKNOWN_TYPE — verbatim из плана, wire-семантика осознанная.

## БАТЧ 3 (Tasks 7-9) — сессия 2026-09-09 (пятая). BASE батча: 13d5d0e.
Task 7: dispatched (implementer sonnet, brief task-7-brief.md, report task-7-report.md).
Task 7: complete (commits 13d5d0e..e376385, review clean — spec ✅, quality Approved; ⚠️ trailer проверен контролёром: есть). Санкционированное отклонение: `AppRuntimeModule.register` получил `imports: [PrismaModule, MembershipModule, RealtimeModule]` — без них Nest DI не разрешает deps AppRuntimeService (Task 6 не вскрыл: int-spec строит сервис вручную, минуя контейнер); reviewer подтвердил минимальность и отсутствие цикла. Удалённый unit-тест «defaults visibility to the type ceiling» — поведение переехало в модуль, покрыто e2e passthrough (reviewer подтвердил).
Task 7: minor (deferred): устаревший комментарий над createApp в realtime.e2e-spec.ts:90 («APP_RUNTIME_MODULES пуст») — поправить при следующем касании.
Task 8: complete (commits e376385..9036b96, review clean — spec ✅, quality Approved; ⚠️ trailer проверен контролёром: есть). Санкционированное отклонение: гард лимита участников обёрнут `if (params.role !== 'spectator')` — бриф говорил «лимит не менять», но его же тест требует входа зрителя в заполненную комнату; count-запрос (фильтр PARTICIPANT) не тронут, порядок прочих гейтов (exclusion по IP, rate-limit) сохранён — reviewer подтвердил (a)/(b)/(c).
Task 8: minor (deferred): (1) литеральное `'participant' | 'spectator'` в сигнатуре join дублирует enum SDK — plan-mandated verbatim; кандидат `JoinRequest['role']` при следующем касании. (2) Неограниченный рост spectators (только per-IP rate limit) — осознанно по дизайну, но в normative-package прямо не прописано: кандидат формулировки при следующей ревизии спеки.
Task 9: BLOCKED → Ruling: имена событий квиза переведены из camelCase (`questionOpened`…) в dotted-lowercase (`question.opened`, `answer.submitted`, `question.closed`, `game.finish`, `answer.accepted`, `question.revealed`, `game.finished`) — `shortEventNameSchema` (sdk/src/events/event-type.ts:27, контракт фазы 1) принимает только dotted-lowercase, и дизайн-док не учёл это. Почему не (A) ослабить схему: это изменение контракта для ВСЕХ приложений (REQ-CTR-008) ради нейминга одного — blast radius несопоставим; дисциплина неймспейсов — часть принуждения ADR-002. Почему (B) безопасно: семантика 7 типов (visibility, clientInitiated, payload) не изменена, переименование механическое; TS-идентификаторы (*Payload) сохранены. Цена ошибки: wire-имена отличаются от тех, что владелец видел в дизайне; при несогласии — обратное переименование до мерджа дёшево (события ещё не на проводе). Применено: erratum в design §3, переименование в плане (Tasks 9–14) и brief — коммит a0002fa. Исполнитель Task 9 резюмирован с ruling.
Task 9: complete (commits a0002fa..5cf1df7 + docs-erratum a0002fa, review clean — spec ✅, quality Approved; ⚠️ trailer проверен контролёром: есть). Нейминг по ruling (dotted-lowercase). Ревьюер подтвердил: зеркало sdk-конфигов, все 7 типов с точными visibility/clientInitiated, все 4 пункта контрактного теста, Ajv2020 над зарегистрированными схемами.
Task 9: minor (deferred): (1) pnpm-lock.yaml несёт побочную deprecated-аннотацию eslint@9.39.5 (пере-резолюция pnpm, безвредно); (2) негативный кейс correctIndex неверного типа для question.revealed не покрыт (polish, покрытие уже шире брифа).

## БАТЧ 3 (Tasks 7-9) ЗАКРЫТ. Следующая сессия: батч 4 = Tasks 10-12 (quiz редьюсер/проекция; quiz handlePublish команды+скоринг; регистрация модуля в app.module) в worktree .worktrees/quiz.

## БАТЧ 4 (Tasks 10-12) — сессия 2026-09-09 (шестая). BASE батча: 5cf1df7.
Task 10: dispatched (implementer sonnet, brief task-10-brief.md, report task-10-report.md).
Task 10: complete (commits 5cf1df7..27c63f3, review clean — spec ✅, quality Approved; ⚠️ trailer проверен ревьюером: есть; ⚠️ barrel AppLogEvent проверен контролёром: sdk/src/index.ts:38). Отклонение исполнителя: reduceQuiz игнорирует payload.totals, перестраивает из awarded (запинено тестом с заведомо неверным totals) — защитная семантика проекции, reviewer подтвердил.
Task 10: minor (deferred): (1) quiz-state.spec.ts:120-127 — фикстура раунда 2 опускает обязательный correctIndex (безвредно, редьюсер поле не читает); (2) answer.submitted пишется и при accepting===false — соответствует брифу, гейтинг в Task 11.
Task 11: dispatched (implementer sonnet, brief task-11-brief.md, report task-11-report.md).
Task 11: fix round 1/5 (1 addressed, 0 open — dense-rank был competition ranking (1,2,2,4), исправлен на плотный 1,2,2,3 + различающий тест {100,50,50,30}; commits 9750944..4d33181). Re-review: ADDRESSED, новой поломки нет.
Task 11: complete (commits 27c63f3..4d33181, review clean после fix round 1; ⚠️ trailer проверен ревьюером: есть). Judgment calls исполнителя (согласованы с брифом ревьюером): детерминированный порядок totals/standings (total desc, tie-break actorId), awarded с 0 очков при clamp, защитный EVENT_UNKNOWN_TYPE на неизвестный shortName.
Task 11: minor (deferred): (1) скоринг-тест покрывает 2 правильных ответа вместо 3 из брифа (k=2 и clamp-ветки без отдельного кейса — формула покрыта); (2) тесты await'ят синхронный handleQuizPublish (безвредно).
Task 12: dispatched (implementer haiku — verbatim-код в брифе, transcription+verification, brief task-12-brief.md, report task-12-report.md).
Task 12: complete (commits 4d33181..e30ac5a, review clean — spec ✅, quality Approved, без findings; ⚠️ trailer проверен ревьюером: есть). Контекст-уточнение контролёра было неточным (imports живут внутри AppRuntimeModule.register, call site одноаргументный) — исполнитель применил бриф корректно, ревьюер подтвердил по коду. Модульный `const quiz` не нарушает REQ-CORE-004 (мутабельное состояние per-room, не процессного уровня).

## БАТЧ 4 (Tasks 10-12) ЗАКРЫТ. Следующая сессия: батч 5 = Tasks 13-14 (quiz e2e приёмка фазы 2; финальное ревью всего среза) в worktree .worktrees/quiz. После Task 14 — мердж в main (не между батчами).

## БАТЧ 5 (Tasks 13-14) — сессия 2026-09-10 (седьмая). BASE батча: e30ac5a.
Task 13: dispatched (implementer sonnet, brief task-13-brief.md, report task-13-report.md).
Task 13: complete (commits e30ac5a..88fab49, review clean — spec ✅, quality Approved; ⚠️ trailer проверен контролёром: есть).
Task 13: отклонения исполнителя (reviewer подтвердил): без override'ов APP_MANIFESTS/APP_RUNTIME_MODULES (composition root уже регистрирует quiz — сильнее буквы brief, под тестом фактическая сборка); readRoomLog не экспортирован из barrel ядра (утверждение brief устарело) — хелпер скопирован локально в спек; противоречие brief (Step 2 «гость без правильных ответов в standings с total 0» vs сценарий 1 «P3 не попадает») разрешено в пользу сценария 1 и reviewed-реализации Task 11 (totals только из awarded).
Task 13: minor (deferred): (1) quiz.e2e-spec.ts:379 — push closed-ack в preReveal после проверочного цикла (мёртвый push; closed-кадр — единственный pre-reveal трафик вне сериализационной проверки чит-теста); (2) lines 351-352 — live-listeners не отписаны после acceptedOrg (revealed с correctIndex попадает в preReveal после проверки — ложное падение при рефакторинге); (3) lines 325-327 — отсутствие optionIndex в answer.accepted проверено только по ленте P1 из четырёх захваченных; (4) AJV warning `unknown format "uuid" ignored` — PRE-EXISTING (zod v4 эмитит format uuid, stock Ajv 8 без ajv-formats не принуждает; не введён этим diff) — кандидат на решение владельца: enforcement формата uuid на commit-гейте.
Task 14: step 1 конвейер ЗЕЛЁНЫЙ (build/lint/typecheck/boundary-check/guardrails — guardrails alive; test:int 159/159 (16 suites); unit+e2e: sdk 280/280, core 213/213, app-quiz 83/83, server 58/58 incl. quiz 9/9). verify-guardrails.mjs — probe-based, список пакетов отсутствует, дополнение app-quiz не требуется.
Task 14: dispatched final review (reviewer fable, whole-branch a75346e..88fab49, review-a75346e..88fab49.diff, двухстадийное: REQ + критерии фазы 2 → quality; триаж 9 deferred minors).
Task 14: final review CLEAN (reviewer fable) — Stage 1 spec PASS по всем группам REQ (CTR-001..009, CORE-004/005/008, RT-004/007/009/013, ID-011 SPECTATOR) и всем 4 критериям выхода фазы 2 (REQ-RT-007 покрыт app-runtime.int-spec.ts тестом 8 — 20 конкурентных dispatch, seq dense); erratum dotted-lowercase подтверждён (camelCase wire-литералов нет). Stage 2: 0 Critical, 0 Important. Ready to merge: YES.
Task 14: триаж deferred minors финальным ревьюером — все 9 stay-deferred (обоснования в отчёте ревьюера; T9(d) AJV uuid-format — кандидат решения владельца, вне среза).
Task 14: minor (deferred, новые из финального ревью): (1) AppProjectionCache — неограниченный рост per-room записей без эвикции (класс T8; фаза-4 hardening); (2) quiz-handlers.ts:73 — clamp-ветка Math.max(base−k·step,0) без теста (провод защищён схемой points min(0)); (3) realtime.e2e-spec.ts:89-90 — устаревший комментарий «провайдер пуст» (подтверждён T7).
## БАТЧ 5 (Tasks 13-14) — исполнение Task 14 step 3: HANDOFF + exit-аудит фазы 2; затем мердж quiz → main (санкционировано: «после Task 14»), push — НЕ выполнять.
Task 14: complete (merge quiz→main 7f6d86f, exit-аудит f7b6b3b, конвейер на слитом main зелёный, HANDOFF b176635; worktree и ветка удалены, леджер перенесён в основной чекаут).
## Quiz-срез ЗАКРЫТ. Фаза 2 закрыта (exit-аудит). Следующий срез — выбор владельца.
