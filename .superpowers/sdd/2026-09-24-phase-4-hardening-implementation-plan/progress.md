# SDD ledger — plan: docs/sessions/2026-09-24-phase-4-hardening-implementation-plan.md

Сессия 25 (2026-09-25) — батч A (Tasks 1–3, C-8.1). Worktree `.worktrees/phase-4-hardening`, ветка `phase-4-hardening` от `a114453`. Baseline: build cached, core unit 227/227 PASS.

## Pre-flight scan (батч A)

Global Constraints отмечены: один lockfile; core без fastify-импортов; REQ-CORE-004 (нет мутабельного module-level в src — отсюда конструкция RacingGuard с целью в DI-токене); in-tx catch unique-violation запрещён; sdk build после правок SDK; фильтры jest проверять на >0 матчей; в worktree testPathPattern матчит путь целиком (имя worktree `phase-4-hardening` безопасно — не матчится с именами сьютов).

(таблица конфликтов — ниже после сверки файлов)

## Pre-flight scan — результаты (батч A)

Сверены против worktree: error-codes.ts/.contract.spec.ts, anonymization-guards.ts, rewards-anonymization.guard.ts, guest-sweep.service.ts, guest-sweep.int-spec.ts (оба describe целиком), rewards.errors.ts, awardPrize (rewards.service.ts:64-99), STATUS_BY_WIRE_CODE (http-exception.filter.ts:13-52). Все вызовы hasOpenAwards — grep: только sweep service + interface/impl (4 вхождения), ручных конструирований гарда вне DI нет.

| Пара/задача | Что проверено | Находка |
|---|---|---|
| T1: spec-файл vs Files | план зовёт `error-codes.spec.ts` | **дефект плана:** фактически `error-codes.contract.spec.ts` (и `contract-version.contract.spec.ts`); run-паттерн тоже |
| T1: тесты vs код | структура спеки | чисто: тест «exports exactly…» и phase-3 it.each существуют, точки вставки плана совпадают |
| T2: стаб-гонка vs guest-sweep.int-spec | хелперы/бутстрап | чисто: seedIdentity, TestAnonymizationWiringModule-прецедент, TRUNCATE, дерево модулей 2-го describe — всё есть; сиды Prize/Award в плане совпадают с существующими (строки 127-136) |
| T2: новая сигнатура vs вызовы | grep hasOpenAwards | чисто: единственный вызывающий — sweep; DI-потребители (wiring-модули) сигнатуры не касаются |
| T2: RacingGuard vs REQ-CORE-004 | module-level state | чисто: цель — в DI-токене (Symbol), calls — поле экземпляра; план сам это мотивирует |
| T2 vs T3 | общие файлы | не пересекаются (T2: identity/guard-файлы; T3: rewards/transport) |
| T3: вставка гарды vs awardPrize | точка «после prize, до raw-INSERT» | чисто: строки 71-78 совпадают с описанием плана; in-tx catch не добавляется (констрейнт соблюдён) |
| T3: ошибка vs rewards.errors.ts | паттерн классов | чисто: ContractError-подклассы — тот же шаблон |
| T3: маппинг vs фильтр | REWARD_ALREADY_RESOLVED: 409 | чисто: строка 48, точка вставки плана существует |
| T1→T3 | sdk build между задачами | чисто: констрейнт «после правок SDK — sdk build» в Interfaces T3 явно |

**Ruling A-pre.1:** T1 исполняется против фактических имён файлов (`error-codes.contract.spec.ts`, run `pnpm --filter @mymozhem/sdk test -- error-codes.contract.spec`) — имена в плане устарели, смысл (RED/GREEN по тем же тестам) не меняется. Если бы неверно: правка косметическая, diff ревью покажет.

## Исполнение

Task 1: complete (commits a114453..7e564ef, review clean — Spec ✅, Issues none, Approved). Санкционированное отклонение: 5-й файл `contract-version.contract.spec.ts` — фикстура `'>=1.8.0'` → `'>=2.0.0'` (стала satisfied после бампа; класс «version-dependent кейс» уже числится deferred-минором в HANDOFF; ревьюер подтвердил минимальность и стабильность выбора). Concern #2 (фикстуры `>=1.x.0` стареют каждый минор) — кандидат в follow-up пакет батча.

Task 2: Ruling A-2.1 — первый имплементер (sonnet) перестал отвечать на 3 пинга (~2 ч без коммита/отчёта, jest-процессов нет) → остановлен; kill-нотификация показала, что он дошёл до GREEN (5/5, включая гоночный describe) и стоял на Step 5. Его незакоммиченные правки 4 файлов сохранены в worktree. Перезапуск свежим имплементером (sonnet) с точки «проверить правки против брифа, прогнать Step 5, закоммитить». Если бы неверно (правки скрыто дефектны): таск-ревью поймает — diff против BASE 7e564ef полный.

Task 2: complete (commits 7e564ef..6e4a80c, review clean — Spec ✅, Approved; DI-отклонение подтверждено необходимым). Первый ревьюер заменён за недоставку вердикта (4 пинга; kill-нотификация показала, что он делал реальную верификацию — проверял DI-claim и lock-conflict claim против схемы; свежий ревьюер довёл до вердикта).
Task 2: minor (deferred): восстановить выбывшие комментарии при следующем касании guest-sweep.service.ts — (а) прецедент отзыва сессий (membership.service.ts:118-123), (б) rationale «deletedAt: null в updateMany.where — вторая линия от гонки с ручным исключением» (verbatim-тело брифа их не несло; код неизменен, потеряна только мотивировка).
Task 2: env-факт (не код): `/var/run/docker.sock` мёртв на машине → int-прогоны с `DOCKER_HOST=unix:///Users/alexanderlapygin/.orbstack/run/docker.sock`; занести в HANDOFF.

Task 3: complete (commits 6e4a80c..3b6e190, review clean — Spec ✅, Issues none, Approved; 5 файлов, +37/−0; гарда same-tx, до любых записей; SDK 1.8.0 подтверждён и в dist). Санкционированное отклонение: int-тест использует существующие хелперы файла (guest()/prizeEffect) вместо inline-литералов брифа — бриф это явно разрешает.

## Финревью батча A (opus, свежий ревьюер после двух зависших)

**Вердикт: ACCEPT WITH FIXES.** Два первых финревьюера зависли на анализе вопроса (a) — как выяснилось, оба жевали именно остаточную гонку.

**Important-1 (design-level): остаточная interleaving C-8.1 не закрыта.** Гард в awardPrize — неблокирующий SELECT до INSERT: если гард-чтение выполнилось до коммита свипа (deletedAt NULL → проходит), а INSERT и коммит award'а — после коммита свипа, то award оказывается на анонимизированной identity, и НИ re-check свипа (award некоммичен/невидим), НИ award-гарда (чтение было stale) его не ловят. Остальные 3 чередования закрыты честно.

**Important-2 (фактическая ошибка дизайна §4):** «FK-проверка Award (FOR KEY SHARE) конфликтует с updateMany свипа (FOR NO KEY UPDATE)» — НЕВЕРНО: FOR KEY SHARE конфликтует только с FOR UPDATE. Эскалации до FOR UPDATE нет: Postgres учитывает для неё только уникальные индексы, пригодные для FK, а `"Identity_registered_email_key"` — выраженческий (lower(email)) И частичный (предикат) — верифицировано в `20260722151900_identity_seam/migration.sql:23-26`. Значит свип берёт FOR NO KEY UPDATE, INSERT award'а НЕ блокируется вообще, «пути сериализуются на строке identity» — ложно, окно шире анализа дизайна. Та же неверная пара lock-режимов в комментариях guest-sweep.service.ts (новый блок C-8.1) и rewards.service.ts.

**Кандидат-фикс (на решение владельца, трогает дизайн §0.4 — сам не правлю):** award-гарда = блокирующее чтение (`SELECT "deletedAt" ... FOR NO KEY UPDATE` на строке identity) — тогда намерение дизайна «сериализация на строке identity» становится истинным: кто первый взял блокировку, тот выиграл; проигравший видит финальное состояние (свип → deletedAt; award → re-check свипа откатывает). + поправка lock-режимов в комментариях + детерминированный тест interleaving'а. Альтернатива: принять остаточный риск документально (свип раз в час, окно ~мс, последствие — сиротский приз, видимый организатору).

**Триаж deferred:** lost rationale comments (2 шт, guest-sweep.service.ts) → must-fix в fix-волне; contract-version fixtures → stay-deferred; docker.sock → stay-deferred (env).

**СТОП для владельца** (CLAUDE.md: вскрытое противоречие в принятом решении §0.4 дизайна — порог: предложение + решение владельца). Батч A кодом исполнен по плану, гейты зелёные, таск-ревью чистые; ветка phase-4-hardening @ 3b6e190, НЕ принят как «C-8.1 закрыт» до решения.

## Решение владельца (2026-09-25): вариант (а) — амендмент с блокирующим чтением

Амендмент записан в конец `docs/sessions/2026-09-24-phase-4-hardening-design.md` (коммит `53fbee7`, main): гард = `SELECT "deletedAt" … FOR NO KEY UPDATE` (сериализация на строке identity становится истинной — конфликт режима с самим собой); поправка lock-режимов в комментариях; детерминированный тест interleaving'а; дедуп ON CONFLICT и исключение award.points неизменны; serializable не вводится. Вариант (б) отклонён.

**Fix-волна перенесена в новую сессию** (решение по вопросу владельца о переносе: батч закрыт по конвенции финревью+HANDOFF+стоп; fix-волна — отдельная единица). Состав fix-волны (вход следующей сессии — HANDOFF «Следующее действие»): (1) блокирующее чтение в awardPrize (RED новым тестом); (2) детерминированный тест гонки в rewards.int-spec.ts (tx-«свип» с барьером); (3) поправка lock-комментариев в guest-sweep.service.ts и rewards.service.ts; (4) восстановление 2 rationale-комментариев в guest-sweep.service.ts. Затем scoped re-review → батч A принят → батч B новой сессией. Напоминание диспатчам: DOCKER_HOST override обязателен.

## Fix-волна батча A (сессия 2026-09-25, новая сессия после решения владельца)

Fix-волна: запущена одна диспатч (sonnet), BASE 3b6e190, бриф `-sessions/fix-batch-a-brief.md` (4 пункта по амендменту `53fbee7`: блокирующее чтение FOR NO KEY UPDATE в awardPrize; детерминированный тест interleaving'а с барьером (RED→GREEN); поправка lock-режимов в комментариях guest-sweep/rewards; восстановление 2 rationale-комментариев). Env-примечание: docker.sock починен владельцем (`fc90555`), override DOCKER_HOST снят — бриф обновлён против леджерной записи «override обязателен» (устарела).
Fix-волна: имплементер DONE — коммиты cc5eec9 (пункты 1–2: блокирующее чтение + детерминированный гоночный тест, RED→GREEN подтверждены) и 1f390d3 (пункты 3–4: lock-комментарии + rationale). Concerns: (1) ссылка прецедента обновлена 118-123→147-153 (файл вырос); (2) синхронизация теста усилена tx-прокси на чтении гарды — буквальная схема давала недетерминированный RED (findUnique гарды гонялся с COMMIT свипа). Тесты: rewards.int-spec 9/9 ×5, guest-sweep 5/5, build/lint/typecheck чисто. Scoped re-review (opus) запущен.
Fix-волна: scoped re-review (opus) — APPROVED, все 4 пункта ADDRESSED; новых Critical/Important нет; 2 Minor (информационные): прокси гоночного теста привязан к форме вызова гарды (сигнал громкий, осознанная цена детерминизма); гипотетический регрессионный RED при реверте гарды на неблокирующий $queryRaw формально гоночен (на findUnique-реверте строго детерминистичен).
Fix-волна: complete (commits 3b6e190..1f390d3, re-review clean).
**БАТЧ A ПРИНЯТ** (Tasks 1–3 + fix-волна; C-8.1 закрыт по амендменту 2026-09-25: re-check свипа + блокирующая award-гарда FOR NO KEY UPDATE). Далее — батч B (Tasks 4–6, метрики) новой сессией.

## Сессия 27 (2026-09-25) — батч B (Tasks 4–6, метрики REQ-OPS-004)

Worktree `.worktrees/phase-4-hardening` @ 1f390d3 (батч A принят). DOCKER_HOST override не нужен (sock починен владельцем, с.26).

## Pre-flight scan (батч B)

| Пара/задача | Что проверено | Находка |
|---|---|---|
| T4→T5 | MetricsService/MetricsModule vs потребители | чисто: набор методов совпадает (connectionAdded/Removed, incCommitError, observePublishToDeliver, observeReplayDuration, render, contentType) |
| T4→T6 | MetricsService → контроллер | чисто |
| T5: конструктор EventOutbox vs точки конструирования | grep `new EventOutbox` | **дефект плана:** 12 ручных точек вне Files T5 сломают компиляцию (room.service.int ×2, token.service.int, event-log.int, event-commit.int ×3, app-runtime.int, membership.service.int ×2, db-down.int, realtime.e2e, transport.e2e) |
| T5: конструктор SubscriptionRegistry vs точки | grep | чисто: только 2 спек-файла из Files T5 (registry.spec ×4, gateway.spec ×8) |
| T5: конструктор RealtimeGateway vs точки | grep | чисто: единственная ручная точка — gateway.spec (в Files); прод — DI |
| T5 Step 9 commit vs Files | `git add packages/core/src/index.ts` | устаревшая команда: T5 index.ts не трогает (баррель обновлён в T4) — коммитить только реально изменённые файлы |
| T5/T6 vs Global Constraints | fastify-free core, REQ-CORE-004 | чисто: состояние MetricsService — поля экземпляра; контроллер через структурный MetricsReply (ReplyLike-прецедент) |
| T6: правила vs .dependency-cruiser.cjs | структура forbidden, probes | чисто: 8 probes → нумерация 9/10 верна; точка вставки есть |
| T6: int-spec паттерн | rewards.controller.int-spec.ts | существует — образец бутстрапа на месте |
| T6 probe libs | prom-client резолвится из core | чисто: T4 Step 0 добавляет dep до probes |
| RealtimeModule ← MetricsModule | DI-деревья int-спек | чисто: MetricsModule беззависим, экспортирует сервис; деревья получают транзитивно |

**Ruling B-pre.1:** T5 расширяется механической правкой 12 ручных точек конструирования EventOutbox — третий аргумент `new MetricsService()` (импорт из `@mymozhem/core` в e2e apps/server, из `../observability/metrics.service`/`../../src` в core-спеках — по местному стилю импортов файла). Смысл плана (явный параметр, «все int-ланы зелёные» Step 8) это требует; verbatim-бриф точек не знал. Если бы неверно: таск-ревью T5 видит полный diff; правка механическая, вариант «опциональный параметр с дефолтом» отклонён — молчаливая потеря метрик в проде при ручном конструировании хуже явности.

## Исполнение (батч B)

Task 4: complete (commits 1f390d3..efdc606, review clean — Spec ✅, Approved; verbatim брифа, оба Review Focus (stale-series, skew-клэмп) реально запинаны ассертами по отрендеренному тексту).
Task 4: minor (deferred): prom-client@15.1.3 registry-deprecated («replaced by @prometheus-io/client») — миграция на 16.x/@prometheus-io/client — решение владельца, пин ^15.1.3 из плана исполнен корректно.
Task 4: minor (deferred): «ровно 4 метрики» ассертится по presence, не по exclusivity (пятая серия не сломала бы спеку) — зеркало брифа, план-уровень.

Task 5: ВНЕШНИЙ БЛОКЕР (не код): имплементер дважды умер — (1) stream watchdog 600s, резюмирован; (2) API 403 «5-hour usage limit» (провайдерская квота модели субагентов). Работа НЕ потеряна: working tree worktree несёт незакоммиченные правки Steps 1–4 + часть Step 5 (5 файлов realtime/*, +93/−11): subscription-registry.ts/.spec.ts (RED+GREEN gauge), event-outbox.ts/.int-spec.ts (RED+GREEN счётчик), realtime.gateway.spec.ts (частично — Step 5 в процессе). Осталось: довести Step 5 (gateway spec), Steps 6–7 (gateway + module), Ruling B-pre.1 (12 точек EventOutbox), Step 8 (прогоны), Step 9 (коммит). Возобновление: свежий диспатч с тем же брифом task-5-brief.md + указанием «правки в дереве, проверить против брифа, довести».

Task 5: ревью (sonnet) — Spec ⚠️→✅ по шагам, оба заявленных отклонения имплементера ПОДТВЕРЖДЕНЫ обоснованными (value import для DI; assert по `{` — HELP/TYPE рендерятся всегда). 1 Important (plan-mandated): gauge-дрейф на re-subscribe в ту же комнату — `registry.add` инкрементит безусловно, перезапись socketId не имеет парного декремента; путь живой (gateway:128–151, тест «re-subscribe в ту же — ок»), инвариант Review Focus 1 ложен для него. 1 Minor (deferred): общий `metrics` в describe-скоупе event-outbox.int-spec используется только для конструирования — косметика.

**Ruling B-5.1:** finding принят в fix-волну, несмотря на plan-mandated: авторитет — заявленный самим планом инвариант «парность гарантирована построением» (Review Focus 1) и критерий выхода §7.1 («gauge сходится с реальностью»); verbatim-код брифа недопоставляет собственный инвариант. Фикс: в `SubscriptionRegistry.add` пропускать `connectionAdded`, если `bySocket` уже содержит socketId (контракт вызывающего — перезапись только той же пары identityId+roomId, задокументирован в gateway), + тест «re-add той же подписки не двигает gauge». Если бы неверно (дрейф недостижим): лишний гард безопасен, тест запинает идемпотентность re-add — дёшево в обе стороны.

Task 5: fix round 1/5 (1 addressed, 0 open — gauge-дрейф на re-subscribe закрыт isNew-гардом + тест; commits 320e3d5..c12a9cf). Re-review clean, новых повреждений нет.
Task 5: minor (deferred, out-of-scope re-review): гипотетический re-add socketId с ДРУГИМ roomId оставил бы протухшую запись в socketsByMembership — путь недостижим (gateway отклоняет чужую комнату), семантика перезаписи существовала до фикса.
Task 5: complete (commits efdc606..c12a9cf, review clean после fix round 1; два санкционированных отклонения от брифа — value import MetricsService для Nest DI, assert по `{` вместо полного имени метрики — подтверждены ревьюером обоснованными).

Task 6: complete (commits c12a9cf..27becbb, review clean — Spec ✅, Approved). Санкционированное отклонение: `pathNot` правила observability-is-leaf расширен `'[.]int-spec[.]ts$'` (verbatim-регулярка брифа `[.]spec[.]ts$` не матчит `.int-spec.ts` из-за `$`-суффикса — boundary-check падал на собственной спеке задачи; прецедент rewards-правила, семантика не ослаблена — ревьюер подтвердил эмпирически).
Task 6: minor (deferred): `app.listen(0, ...)` в observability.int-spec избыточен для inject (по образцу rewards-спеки — консистентность).
Task 6: minor (deferred): дублирование пары spec/int-spec суффиксов в двух depcruise-правилах с разным форматированием — при третьем исключении вынести общий паттерн.

## Финревью батча B (opus): ACCEPT WITH FIXES — 1 Important (дефект плана)

**Important-1:** предикат счётчика ошибок фиксации (event-outbox.ts) исключает только ContractError/RealtimeError; иерархии Room/Membership/AppRegistry/Identity/Auth наследуют голый Error → штатные типизированные отказы гейтов через RoomService.transition (RoomNotConfigured, RoomConflict «changed concurrently» — спроектированные 4xx-исходы) ложно инкрементят mymozhem_event_commit_errors_total{code="UNKNOWN"}, вопреки дизайну §3 («типизированные отказы гейтов НЕ считаем»). Вскрыто только батч-взглядом на всех вызывающих outbox.run — per-task ревью шов не видело.

**Ruling B-F.1 (контроллер):** finding принят, фикс в fix-волне батча B, вариант (б) структурный. Авторитет — дизайн §3 (binding). Предикат: считать ТОЛЬКО (1) Prisma.PrismaClientKnownRequestError (label = P-код) и (2) ошибки БЕЗ строкового свойства `code` (label UNKNOWN); любая ошибка со строковым `code` — типизированный доменный отказ по конвенции кодабазы (все 6 иерархий + ContractError следуют ей) → не считаем. Принятый промах: Node/system-ошибки со строковым code (ECONNREFUSED) вне обёртки Prisma будут исключены — мизерный класс (adapter-pg оборачивает сбои БД в P2010 — репо-констрейнт HANDOFF), и направление промаха соответствует дизайну (лучше пропустить экзотический сбой, чем считать штатные отказы). Вариант (а) — импорты 4–5 доменных errors-модулей в realtime-инфраструктуру — отклонён: лейеринг + не самоподдерживается при новых иерархиях. Если бы неверно (вариант (б) пропустил бы класс реальных сбоев): метрика занижена на экзотике, но не врёт на штатном пути — обратимо точечной правкой.

Fix-волна: event-outbox.ts (предикат + комментарий конвенции), event-outbox.int-spec.ts (тест: reject RoomError → счётчик не тронут; Prisma-код — считается), прогоны, один коммит. Затем scoped re-review → HANDOFF → стоп.

Триаж deferred финревьюм: все 6 minor stay-deferred, must-fix нет. Рекомендации: (1) дизайн §3 слово «global» рассинхрон с фактической не-global реализацией MetricsModule — поправить слово при следующем касании дизайна, код не трогать (кандидат в HANDOFF); (2) Task 9 — e2e-ассерт «/metrics 200 без заголовков» на прод-дереве AppModule (уже есть в плане Task 9 шаг 5 — напоминание).

Fix-волна батча B: complete (commits 27becbb..d1e73a8, scoped re-review clean — Ruling B-F.1 ADDRESSED, новых повреждений нет; 2 out-of-scope наблюдения non-blocking: кросс-модульный импорт room.errors в spec-файле — spec = миниатюра composition root; нет теста на label=P-код — вне scope фикса).
**БАТЧ B ПРИНЯТ (2026-09-25):** Tasks 4–6 + fix-волна финревью. Ветка phase-4-hardening @ d1e73a8. Следующая сессия — батч C (Tasks 7–9, логи).

Сессия 28 (2026-09-25) — батч C (Tasks 7–9, логи REQ-OPS-004). Worktree `.worktrees/phase-4-hardening`, BASE `d1e73a8`.

## Pre-flight scan — результаты (батч C)

| Пара/задача | Что проверено | Находка |
|---|---|---|
| T7: PinoLoggerModule → ConfigModule vs observability-is-leaf | текст правила | чисто: у правила явное config-исключение (Task 6 предвидел pino-фабрику) |
| T7: точка вставки LOG_LEVEL | config.schema.ts:75 OAUTH_RATE_LIMIT | чисто |
| T7: test-config.ts | литерал AppConfig | чисто: новое обязательное поле план добавляет (Step 1) |
| T8: verbatim `import { PinoLogger } from 'nestjs-pino'` в 5 файлах (filter, sweep, sweep-module, gateway, membership) vs observability-libs-contained (T6) + дизайн §6 | текст правила (from.pathNot = observability/barrel/main.ts) | **КОНФЛИКТ → Ruling C-pre.1** (ниже) |
| T8: 5 точек `new Logger(...)` | grep | чисто: ровно 5, как в плане |
| T8: порядок конструктора gateway | metrics — последний после T5 | чисто: logger добавляется после metrics (Self-review плана последователен) |
| T8: gateway spec — существующий паттерн подмены `.logger` (строки 119-136) | realtime.gateway.spec.ts | чисто: имя поля `logger` сохраняется, подмена продолжает работать |
| T8: фильтр-спека makeHost | нет getRequest | чисто: план добавляет (Step 1) |
| T8: форма ошибки свипа | SweepSuspensionRaceError.racedCount (guest-sweep.service.ts:15) | чисто |
| T8: membership лог-линия | membership.service.ts:161-163 | чисто |
| T9: observability.module.ts | фасад с комментарием «(батч C) pino-конфигурация» | чисто: предвидено батчем B |
| T9: observability.int-spec дерево | ConfigModule+ObservabilityModule, override APP_CONFIG | чисто: провайдер PINO_STREAM вписывается |
| T9: app.module.ts / main.ts | точки вставки | чисто |
| T9: realtime.e2e хелперы | activeRoomWithGuest, organizerToken, connect, emitAck, waitEvent | чисто |
| T9: ожидаемые строки метрик vs фактические labelNames | metrics.service.ts (visibility/level/code/roomId) | чисто |
| T9: main.ts `Logger` из nestjs-pino | main.ts в pathNot libs-contained | чисто |
| T8/T9: jest testPathPattern в worktree | имя `phase-4-hardening` не матчится со сьютами | чисто |

**Ruling C-pre.1:** Task 8 исполняет миграцию на PinoLogger НЕ прямыми импортами `nestjs-pino` в доменных файлах (verbatim брифа), а через ре-экспорт: `export { PinoLogger } from 'nestjs-pino';` в `packages/core/src/observability/pino-logger.module.ts` (value-реэкспорт — класс нужен как DI-токен через design:paramtypes), потребители импортируют из `../observability/pino-logger.module`. Авторитет: дизайн §6 (binding — «Импортёры nestjs-pino — только observability и bootstrap») + правило observability-libs-contained, принятое и запинанное probe'ом в батче B; verbatim-строки брифа ему противоречат. Намерение плана (PinoLogger в конструкторах, setContext, поля корреляции) не меняется — меняется только путь импорта. Если бы неверно: boundary-check падает на гейтах Task 8 Step 6 сразу — дёшево обнаружимо и обратимо.

## Исполнение (батч C)

Task 7: complete (commits d1e73a8..690ba56, review clean — Spec ✅, Approved; санкционированные отклонения: (1) ре-экспорт PinoLogger из pino-logger.module.ts — Ruling C-pre.1; (2) useFactory-параметр `stream?: DestinationStream` вместо `unknown` — typecheck на фактических версиях nestjs-pino 4.6.1/pino-http 10.5.0/pino 9.14.0; ревьюер верифицировал оба против node_modules: sound и minimal). Ревьюер один раз завис (stream watchdog) — резюм сработал, вердикт доставлен.
Task 7: minor (deferred): buildPinoHttpOptions возвращает рукописный структурный тип, не pino-http Options — безопасно сейчас (typecheck валидирует spread), дрейф возможен на будущем мажоре pino-http; держит фабрику юнит-тестируемой без Nest (by design).
Task 7: ⚠️-итемы ревью разрешены контроллером: глобальность LoggerModule и дедуп по ссылке — упражняются int-ланами Task 8; путь импорта PinoLogger в доменных модулях — зафиксирован в диспатче Task 8; PINO_STREAM-консумция — Task 9.

Task 8: имплементер (sonnet) трижды умер на stream watchdog (после filter-spec, после membership, на правке точек конструирования в int-спеках). Резюмы №1–2 продвигали работу, после 3-го — остановлен по паттерну восстановления (прецеденты A-2.1, B/Task 5). Незакоммиченное дерево содержит Steps 1–4 + часть адаптации int-спеков (16 файлов: 5 прод-точек + gateway/filter спеки + 8 int-спеков с ручным конструированием DI + test-config). Перезапуск свежим имплементером (sonnet): «проверить правки против брифа, довести Steps 5–7». Если бы неверно (правки скрыто дефектны): таск-ревью видит полный diff против BASE 690ba56.
Task 8: complete (commits 690ba56..934ae8b, review clean — Spec ✅, Approved, findings нет). Исполнен восстановительным диспатчем после 3 сталлов первого имплементера (паттерн A-2.1 подтверждён третий раз); аудит предшественника нашёл 4 недоведённых сайта int-спеков (event-outbox + 3 в membership) — пойманы полным test:int (root typecheck int-спеки НЕ покрывает — кандидат в follow-up). Ревьюер подтвердил: C-pre.1 соблюдён везде (единственный импорт nestjs-pino — в pino-logger.module), 3 сайта post-construction подмены `.logger` в gateway-спеке валидны, 'subscribed' строго после ack, payload не логируется, membership — без новых логов. ⚠️-итемы разрешены: транзитивное DI-разрешение PinoLogger подтверждено зелёным test:int (23/23).
Task 8: minor (deferred): root `pnpm typecheck` не покрывает int-спеки — дрейф сигнатур конструкторов в int-спеках ловится только ts-jest прогоном (кандидат: включить int-spec в typecheck-конфиг).

Task 9: ревью (sonnet) — Spec ❌ по одному Critical: дубль инстансов nestjs-pino (apps/server без пина pino → второй снапшот против pino@10.3.1; класс Logger иной идентичности → `app.get(Logger)` в main.ts падает на прод-бутстрапе; e2e useLogger не вызывает, гейты слепы). Ревьюер воспроизвёл против dist. Все 4 отклонения имплементера приняты по существу (верификация по node_modules: middie `raw.id = req.id` в fastify-middie.js:208 делает genReqId мёртвым — подтверждено; pino-http `req.id || genReqId` logger.js:141; порядок глобальных middleware — middleware-module.js:78-92, задокументирован и запинан двумя тестами; `req.raw?.id ?? req.id` — форма верна; PINO_STREAM через @Global test-module — корректная DI-семантика forRootAsync; fakeLogger-починка e2e — минимальна). Отклонение формы ассертов метрик (инкременты вместо абсолютных `_count 1` — shared app в файле, кумулятивные гистограммы) принято ревьюером. Fix round 1: резюм имплементера с finding verbatim + требованием boot-path проверки, ловящей этот класс.
Task 9: minor (deferred, из ревью): e2e-stdout шумит per-request JSON-логами (LOG_LEVEL=info в e2e-буте) — безвредно, кандидат на решение при росте шума.
Task 9: fix round 1/5 (1 addressed, 0 open — дубль nestjs-pino устранён пином pino@^9.14.0 в apps/server, lockfile несёт один снапшот; новый bootstrap.e2e-spec спаунит dist/main.js и ловит класс дефекта RED→GREEN; commits 82ea28b..2df82ae). Re-review clean, новых повреждений нет.
Task 9: minor (deferred, out-of-scope re-review): у bootstrap-спека нет 'error'-слушателя на spawn (фейл громкий в любом случае); пин apps/server на pino ^9 при peer-диапазоне nestjs-pino 10.x — будущий бамп pino 10 двигать вместе в обоих пакетах (кандидат комментария).
Task 9: complete (commits 934ae8b..2df82ae, review clean после fix round 1; 4 отклонения имплементера верифицированы ревьюером по node_modules и приняты: RequestIdModule pre-middleware с задокументированным порядком, req.raw?.id в фильтре, PINO_STREAM через @Global test-module, fakeLogger-починка e2e; форма ассертов метрик — инкременты).

## Финревью батча C (opus): ACCEPT WITH FIXES — 1 Critical + 1 Important

**Critical C-1:** redact покрывает только req-сторону; pino-std-serializers v7 res-сериализатор по умолчанию сериализует заголовки ответа → `set-cookie` (refresh-токен, OAuth state/PKCE) утекает в каждую строку "request completed" на всех токен-эмитящих эндпоинтах. Верифицировано эмпирически с фактическими опциями. Класс предсказан Review Focus 5, но премисса плана («body не логируется → Set-Cookie безопасен») никто не сверил с v7 res-сериализатором — батч-дефект композиции, невидимый per-task ревью. Фикс верифицирован: `'res.headers["set-cookie"]'` в redact.paths + пин-тест.

**Important I-1:** OAuth `code`/`state` попадают в логи через `req.url` (query) и `raw.query` (middie копирует). Фикс — кастомный `serializers.req` в buildPinoHttpOptions, режущий query. Дёшево в той же волне.

**Ruling C-F.1 (контроллер):** оба finding приняты в fix-волну. Авторитет — дизайн §2 (binding: «токены, куки, тела не логируем»; «Pino redact на заголовках authorization/cookie — явно, с тестом» — норма о направлении, не исчерпывающий список путей). Порога владельца нет: фикс реализует принятую норму, не пересматривает её. Если бы неверно (I-1 избыточен — code одноразовый и бесполезен без client_secret+PKCE): стоимость — один кастомный сериализатор с тестом, обратимо.

Minor M-1 (CORS preflight вне request-id/лог-режима — benign, «все запросы» читать как «после cors-хука») и примечание о плановом сужении §2 (child-логеры commit/join/oauth не созданы — сужение плана, не дефект) → в exit-аудит (Task 10). Триаж deferred: все 5 stay-deferred; пин pino ^9 в apps/server — load-bearing для single-instance фикса (записать в HANDOFF). Owner-ноты: standing rule — v7 res-сериализатор логирует заголовки ответа по умолчанию (redact-ревью в обе стороны); err-сериализатор копирует все enumerable props (держать типы ошибок чистыми от request/config); room-коды в логируемых URL — решение владельца при exit-аудите.

Fix-волна: C-1 + I-1 одним диспатчем (резюм имплементера T9) → scoped re-review → HANDOFF → стоп.

Fix-волна батча C: complete (commits 2df82ae..a64a425, scoped re-review clean — C-1 и I-1 ADDRESSED с эмпирической верификацией re-review'ером (негативный контроль воспроизведён: без пути set-cookie утекает, с путём — [redacted]; прод-цепочка pino-http wrapRequestSerializer проверена); новых повреждений нет, boundary чист).
Fix-волна: minor (deferred, out-of-scope): комментарий pino-logger.module.ts:75-76 обещает remoteAddress — в прод-цепочке (двойная std-сериализация) remoteAddress/remotePort теряются (не утечка, деградация наблюдаемости; поправить комментарий при касании); ветка `delete serialized.query` запинана мягко (фейковый req без own query — ассерт прошёл бы и без delete; механизм верифицирован эмпирически, url-вектор запинан жёстко).

**БАТЧ C ПРИНЯТ (2026-09-25):** Tasks 7–9 + fix-волна финревью. Ветка phase-4-hardening @ a64a425. Следующая сессия — батч D (Task 10, exit-аудит среза; вход — план Task 10 + owner-ноты финревью батча C: трактовка «все запросы», плановое сужение §2 (child-логеры commit/join/oauth не созданы), room-коды в URL логов — решение владельца, пин pino ^9 load-bearing, standing rule про res-сериализатор v7).

## Батч D (Task 10, exit-аудит) — сессия 29 (2026-10-12, inline)

Task 10: исполняется inline (усмотрение владельца по HANDOFF). Гейты свежего прогона на a64a425: build/boundary/guardrails/lint/typecheck/test/test:int — все 0 (/tmp/batch-d-gates/). Критерии §7 сверены с артефактами файл:строка; owner-ноты финревью батча C разобраны; room-коды в URL логов — РЕШЕНИЕ ВЛАДЕЛЬЦА (2026-10-12): принято для MVP, триггер пересмотра REQ-RT-008 (маскирование обязательно в той задаче).
Task 10: Ruling: имя файла аудита 2026-10-12 по фактической дате (план-плейсхолдер 2026-09-2X) — косметика сортировки docs/sessions.
Task 10: Ruling: аудит-документ коммитится в ветку (90af6c9), HANDOFF — отдельно на main по стоящей конвенции (плановый Step 4 объединял; разделено, чтобы main-HANDOFF не устаревал до мерджа) — стоимость ошибки: одна повторная правка HANDOFF.
Task 10: финревью батча D (opus, целосрезовое a114453..90af6c9) — WITH FIXES, 1 Important: утечка OAuth state через res.headers.location на 302 authorize (ревьюер воспроизвёл эмпирически; тот же класс, что C-1/I-1). Фиделити аудита — образцовая, cross-batch композиция чистая, interleaving-матрица C-8.1 закрыта, rulings взвешены. Minors: HANDOFF на main (Step 3, исполняется), remoteAddress-комментарий, мягкий пин delete query — stay-deferred.
Task 10: Ruling: Important #1 в fix-волну без эскалации владельцу (прецедент C-F.1 — фикс реализует норму дизайна §2, не пересматривает) — вариант (а) serializers.res со strip query из location — стоимость ошибки: один сериализатор с тестом, обратимо.
Task 10: Final: fixed OAuth state через res.headers.location — «query (state/code_challenge) срезан из res.headers.location на 302 authorize» RED→GREEN, build/typecheck/core unit/obs-int 3/3 зелёные (commit 6f0775a).
Task 10: complete (commits a64a425..HEAD: аудит 90af6c9 + fix 6f0775a + аудит-fixup, гейты 7/7 зелёные на a64a425 + fix-верификация на 6f0775a; аудит docs/sessions/2026-10-12-phase-4-hardening-exit-audit.md). БАТЧ D ИСПОЛНЕН, срез готов к мерджу (решение владельца).
