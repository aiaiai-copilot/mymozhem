# SDD ledger — plan: docs/sessions/2026-07-29-membership-guest-join-implementation-plan.md

Design: docs/sessions/2026-07-29-membership-guest-join-design.md
Branch: phase-1-membership-guest-join
BASE (branch start): a6d53b8c88cd855dfdd2b7fa059f6473a134b5ad

## Tasks
- Task 1: SDK — схемы roomJoinPolicy и displayName — COMPLETE (commits a6d53b8..3279301, review clean: spec ✅, Approved, 0 Critical / 0 Important, 1 Minor rolled up below; 182/182, lint+typecheck clean)
- Task 2: конфиг ядра — ROOM_CODE_* / JOIN_RATE_LIMIT_* — COMPLETE (commits 3279301..e4d8b64, review clean: spec ✅, Approved, 0 Critical / 0 Important / 0 Minor; 68/68 core suite, 10/10 loadConfig describe, lint+typecheck clean)
- Task 3: миграция + Room.code/joinPolicy + Identity.displayName (+ presence-тест индекса, кросс-kind кейс, косметика harness'а/jest)
- Task 4: IdentityService.createGuest + ORGANIZER-membership в RoomService.create
- Task 5: MembershipService.join + лимиты + JoinRateLimiter
- Task 6: wiring + гейты + boot-смоук

## Batching (owner decision 2026-07-29): one batch per session

Split by DEPENDENCY (как в срезе sdk-contract-core, решение 2026-07-16):
- **Batch 1 — фундаменты: Tasks 1–2.** SDK-контракты (roomJoinPolicy, displayName) + конфиг §4 + ConfigModule. Листовые, без БД. **Исполняется в этой сессии.**
- **Batch 2 — схема и путь create: Tasks 3–4.** Миграция + код/политика в create + createGuest + ORGANIZER-membership. Новая сессия.
- **Batch 3 — join-поток и посадка: Tasks 5–6** + финальное whole-branch ревью. Новая сессия.

Каждый батч завершается обновлением HANDOFF.md; свежая сессия резюмит с этого леджера.

## Controller pre-flight findings
- Якоря плана сверены с кодом 2026-07-29: `config.schema.ts` — ровно 3 поля (NODE_ENV/PORT/DATABASE_URL), full-replace в Task 2 корректен; `index.ts:1` содержит якорную строку экспорта; конструктор RoomService — 3 аргумента, как ожидает Task 3; `/health/ready` существует (health.controller.ts); `docker-compose.yml` в корне.
- Конфликтов задач и план-против-рубрики не найдено. Ожидаемые расхождения счётчиков тестов (Task 1: 20 новых; Task 2: «7 тестов describe» — приблизительно, 6 новых + существующие) — НЕ считать spec-failure сами по себе (конвенция прежних фаз: исполнитель сообщает фактические числа).
- Конструктор RoomService меняется дважды (Task 3: +config; Task 4: +membership перед config) и MembershipService один раз (Task 5: 1→4 аргумента) — заявлено в controller notes, ревьюеру не считать регрессией промежуточных коммитов.

## Minor findings (roll-up for the final whole-branch review)
- Task 1 minor (deferred): `invalidDisplayNames` хардкодит `'x'.repeat(41)` при символическом boundary-тесте (MAX+1) — verbatim из brief; при смене cap фикстура молча перестанет тестировать «на один больше». Косметика.
- Task 3 minor (deferred): `TEST_CONFIG` дублируется verbatim в `room.service.int-spec.ts:25` и `event-log.int-spec.ts:11` — извлекать в `src/testing/` только при появлении третьего call-site.
- Task 3 minor (deferred): `create` стоит 2 round-trip'а (INSERT + re-read из-за enum @map) — задокументировано в коде; естественно схлопнется в транзакции Task 4/5, действий не требуется.
- Task 4 minor (deferred): atomicity failure-path (откат room row при падении membership-insert) не покрыт тестом — требует fault injection; компенсировано классификатором (membership-индекс не миссклассифицируется как коллизия кода). К сведению финального ревью.
- Task 4 minor (deferred): `createOrganizerMembership` без default для tx — сознательно, единственный caller передаёт tx. К сведению финального ревью.

## Fix rounds
- Task 3: fix round 1/5 (1 addressed, 0 open — isRoomCodeCollision P2010-wrapped 23505 shape + 9 classifier unit tests; commits 6ec1277..46363d0)

## Completions
- Task 3: complete (commits 1b8729b..46363d0, review clean after 1 fix round: spec ✅, re-review PASS; unit 80/80, int 59/59, lint+typecheck clean). Deviations accepted by review: findUniqueOrThrow re-read (raw $queryRaw returns DB enum value, not Prisma @map name), `lower(email)` unquoted in presence-test assert (Postgres deparse), forced edits to 2 pre-existing raw-SQL tests + event-log call-site.
- Task 4: complete (commits 46363d0..60ee3f6, review clean: spec ✅, Approved, 0 Critical / 0 Important, 2 Minor rolled up; int 63/63, unit 80/80, lint+typecheck clean). Deviation accepted: re-read через tx (та же транзакция, видит uncommitted row). Все 3 call-site `new RoomService(` обновлены.

**Batch 2 (Tasks 3–4) COMPLETE 2026-07-29.** Batch 3 — Tasks 5–6 + финальное whole-branch ревью — новая сессия.

## Batch 3 (session 2026-07-29 evening)

- Task 5: complete (commits 47588e3..a123f0d, review clean: spec ✅, Approved, 0 Critical / 0 Important, 2 Minor rolled up; limiter unit 3/3, join int 15/15, unit 83/83, int 78/78, lint+typecheck clean). Процессная заметка: коммит a123f0d сделан первой попыткой implementer'а, умершей на API-таймауте до отчёта; второй implementer верифицировал дословное соответствие брифу и прогнал все гейты (см. task-5-report.md). RED-фаза не воспроизводилась.
- Task 5 minor (deferred): `TEST_CONFIG` дублируется verbatim уже в ТРЁХ файлах (+membership.service.int-spec.ts:17) — триггер из Task 3 minor («извлекать в src/testing/ при третьем call-site») СРАБОТАЛ. Кандидат на извлечение перед мерджем; триаж — финальное whole-branch ревью.
- Task 5 minor (deferred): `makeMembership` в membership.service.int-spec.ts ре-хардкодит дефолт лимита 500 (`?? 500`) вместо ссылки на TEST_CONFIG.ROOM_PARTICIPANT_LIMIT — косметика.
- Task 6: complete (commits a123f0d..47d7105 — d70f919 fix(server) + 47d7105 feat(core); review clean: spec ✅, Approved, 0 Critical / 0 Important, 1 Minor rolled up; lint+typecheck+unit 268+int 78+boundary-check 0+guardrails 3/3+build зелёные; живой docker boot → /health/ready 200, 6 миграций, последняя 20260729164500_membership_guest_join; down -v, lt-pg не тронут). Отклонение, принятое ревью: d70f919 — placeholder DATABASE_URL в health e2e (ConfigModule валидирует env при boot, REQ-OPS-003); scope `server` вместо шаблонного `core` — файл в apps/server, ревью согласилось.
- Task 6 minor (deferred): health.e2e-spec.ts — process.env.DATABASE_URL ??= в beforeAll без restore в afterAll; сегодня spec один в apps/server/test, ??= не клобберит — влияние нулевое; при появлении второго e2e spec добавить save/restore.
- Процессная заметка: implementer'ы Task 5/6 писали отчёты в ~/.superpowers/sdd/... (home), а не в repo-workspace; отчёты скопированы контроллером в канонический workspace. Brief task-6 читался из repo-workspace без проблем.

## Final whole-branch review (a6d53b8..47d7105, opus) — Ready to merge: With fixes
- Critical: 0. Important: 1 (TEST_CONFIG extraction trigger met, not executed). Minor: 5 (ниже).
- Fix wave: commit 107e12d refactor(core): extract shared TEST_CONFIG into src/testing (REQ-OPS-003) — scoped re-review: ALL ADDRESSED, новой поломки нет (typecheck/lint clean, int 78/78).
- Deferred-minor triage (рулинги финального ревью): 1 defer (фикстура иллюстративна, символический boundary-тест есть); 2+6 FIXED в 107e12d; 3 defer (2 round-trip, схлопнется с updateManyAndReturn); 4 defer (atomicity failure-path — fault injection, классификатор компенсирует); 5 defer (tx без default — сознательно); 7 defer (??= неклобберит, один e2e spec).

## Residual minors — parked for the TRANSPORT slice (следующий срез, которому принадлежит real-IP extraction)
- JoinRateLimiter не вытесняет протухшие IP-записи (join-rate-limiter.ts:17) — медленный unbounded-growth вектор при IP-ротации; fix = delete при expiry / периодический sweep.
- Гонка soft-delete/status-flip между проверкой и insert в join (membership.service.ts:63-79) — тот же класс принятой гонки, что count-then-insert, но design fork (б) называет только лимит; acceptance зафиксирован здесь. Fail-safe направление (сиротская membership-строка безвредна).
- Real-IP extraction (X-Forwarded-For trust) — принадлежит транспортному срезу.
- JSDoc на RoomService.create: lowercase-in ('registered') / Prisma-name-out ('REGISTERED') словарь политики (minor 3).
- health.e2e placeholder DATABASE_URL указывает на порт 5432 (lt-pg) — инертно (PrismaService замокан), при следующем касании файла заменить на мёртвый порт (54999) + save/restore env (minor 5 + defer 7).

**Batch 3 (Tasks 5–6 + final review) COMPLETE 2026-07-29. План исполнен полностью: 11 коммитов a6d53b8..107e12d, все гейты зелёные, ветка готова к мерджу.**
