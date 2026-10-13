# SDD ledger — plan: docs/sessions/2026-10-12-adr-012-zero-pii-implementation-plan.md

Сессия 33 (2026-10-12): батч A — T1 амендмент v1.5, T2 SDK 2.0.0, T3 конфиг.
Worktree: .worktrees/adr-012-zero-pii, ветка adr-012-zero-pii, BASE батча = b82008a.
Spec: docs/sessions/2026-10-12-adr-012-zero-pii-design.md (§0 решения владельца) + docs/adr/adr-012-zero-pii-mvp.md — прочитаны контроллером.

## Pre-flight scan (батч A)

Ожидаемое промежуточное состояние: T2/T3 намеренно оставляют красное дерево
потребителей (oauth-контур, transport-фабрики, e2e) — зеленеет в T4 (батч B),
интерпретация плана I-1 + шаг 5 T2/T3. Гейты монорепы в конце батча A НЕ будут
полностью зелёными — это зафиксированное состояние плана, не дефект.
Эскалация только если красное вне инвентаря T4.

Пары задач × общие файлы/интерфейсы:

| Пара | Общее | Находка |
|---|---|---|
| T1 × T2/T3 | нет общих файлов (docs/spec vs packages) | чисто |
| T2 × T3 | нет общих файлов (sdk vs core config/testing) | чисто; обе задачи санкционируют красное дерево потребителей до T4 — правила эскалации шагов 5 идентичны и согласованы |
| T2 внутри | delete-список vs grep | подтверждён: oauth-start-query.ts, oauth-callback-query.ts, oauth-query.contract.spec.ts, 7 OAUTH_* в error-codes.ts (строки 29-36 точны), barrel-строки 32-33 точны |
| T3 внутри | схема/спека/test-config | якоря точны: OAuth-ключи ~57-75, Google-if'ы superRefine ~90-102, JWT_SECRET на :16 (точка вставки), TEST_CONFIG держит ровно 3 OAUTH-ключа (27-29) |

Ruling pre-flight 1: строка Global Constraints «гейты зелёные в конце каждой задачи»
уступает шагам 5 задач T2/T3 (план санкционирует красное дерево потребителей до T4,
интерпретация I-1). Выход батча A фиксирует инвентарь ожидаемого красного вместо
полной зелени гейтов. Цена ошибки: красный коммит в середине среза — планом принято.
Ruling pre-flight 2: упоминания oauth/GOOGLE вне инвентаря T4 (token.service.ts,
token.service.int-spec.ts, realtime.gateway.ts, authenticate.ts, seed-identity.ts,
host-session.ts) — только исторические комментарии, кодовой связки нет; не эскалация
по правилу шага 5. Чистка этих комментариев планом T4 не заказана — остаются
кандидатом косметики, не гейтом.

## Исполнение

Task 1: minor (deferred): нет verbatim blanket-клаузы ADR-012:74 («SEC/RT/CORE/CTR/DEV/OPS группы не затрагиваются») — скоуп ограничен строкой Статус, косметика.
Task 1: minor (deferred): словесная коллизия в строке REQ-RWD-014 («снят из манифеста» vs «guests_allowed — единственное значение» vs «сужение» в §3) — текст дословно из драфта плана; флаг автору плана, не имплементеру.
Task 1: complete (commits b82008a..b5729c7, review clean)

Task 2: BLOCKED на шаге 5 → Ruling T2.1: красное `join.controller.ts(28,73)`
(string | undefined → MembershipService.join) — спроектированное промежуточное
состояние между T2 и T6 (план T6 дословно: «Modify join.controller.ts /
membership.service.ts», «Consumes: T2 displayName optional»), параллельно
oauth-красному T4. Инвентарь ожидаемого красного батча A расширяется:
T4-инвентарь (oauth) + T6-инвентарь (join.controller/membership displayName).
Цена ошибки: красный коммит в середине среза — паттерн уже принят планом (I-1).
Отклонение имплементера: contract-version.contract.spec.ts обновлён под 2.x
(спека не была в списке файлов брифа, но бамп 2.0.0 её ломал — вынужденно,
предикаты не тронуты). Принято.

Task 2: minor (deferred): рассинхрон брифа — Interfaces (z.string()) vs Step 3 (z.string().min(1)) для joinResponseSchema.displayName; реализация взяла строжайшее (min(1)). Реконсилияция текста плана — при следующем касании T6/T7 не цитировать нестрогую форму.
Task 2: minor (deferred): join-response.contract.spec.ts без кейса extra-key — strictObject-через-extend гарантирован семантикой zod, не тестом (однострочный пин-кандидат).
Task 2: complete (commits b5729c7..351d14a, review clean; ruling T2.1)

Task 3: minor (deferred): stale имя теста 'applies defaults when only DATABASE_URL is provided' (base несёт JWT_SECRET и теперь ORGANIZER_SETUP_TOKEN) — пре-существующее, переименовать при следующем касании.
Task 3: minor (deferred→carry в T4): apps/server typecheck не прогонялся (turbo стопнулся на core) — в T4 подтвердить, что в apps/server нет красного вне инвентаря.
Task 3: complete (commits 351d14a..5743300, review clean)

## Финальное ревью батча A (fable)

Вердикт: With fixes — 1 Important: каскад эпохи контракта 2.0.0. Фикстуры
`contractRange: '^1.0.0'` (sdk manifest.fixtures.ts:7,42; core app-registry.spec.ts,
app-registry.service.spec.ts:80; int-specы app-runtime/event-commit/event-outbox/db-down;
realtime.e2e-spec.ts:45) красят 2 unit-сьюты core СЕЙЧАС (вне санкционированного
красного) и int/e2e-гейты батчей B/C. Плановый пропуск: T2 Files не нёс каскад эпохи
за пределы contract-version.contract.spec. Плюс app-registry.spec.ts:40 использует
'^2.0.0' как ИСКЛЮЧАЮЩИЙ диапазон — теперь удовлетворяется (флипнуть на '^1.0.0'/^3.0.0').
Minor: error-codes.ts:16 stale комментарий «OAuth-срез» над ROOM_ORGANIZER_NOT_REGISTERED
(едет с фиксом). Триаж 6 deferred-миноров таск-ревью: все stay-deferred.
Опыт для будущих мажорных бампов: T2-стиль задач обязан включать grep эпохи
по потребителям ('^1\.0\.0') — записать в HANDOFF.
Фикс-волна: один диспатч (resume T2-имплементера), затем одно скопированное ре-ревью.

Fix wave: round 1 (2 addressed, 0 open; commits 5743300..9565e97) — ре-ревью чистое:
все 9 точек каскада + 1 вне списка (projection.service.spec.ts:23, настоящий промах
координатора), флип исключающего диапазона корректен (^1.0.0 исключает 2.0.0,
полярность ассерта сохранена), derived `^${CONTRACT_VERSION}` в manifest.fixtures
(эпоха-пруфинг следующих мажоров), stale-комментарий error-codes.ts:16 переведён на
REQ-ID-005/ADR-012. Новой поломки нет.

## БАТЧ A ЗАВЕРШЁН (2026-10-12, сессия 33)

Коммиты: b5729c7 (T1), 351d14a (T2), 5743300 (T3), 9565e97 (fix wave). Ветка
adr-012-zero-pii. Известное красное дерево (санкционировано, лечится батчем B):
T4-инвентарь oauth + T6 join.controller.ts. Unit-гейты: sdk 327/327 зелёные,
core config.schema 26/26 и app-registry 38/38 зелёные; прочее core/apps —
ожидаемое красное инвентаря. Опыт сессии: мажорный бамп контракта требует
grep эпохи ('^1\.0\.0') по потребителям в задаче бампа; core резолвит sdk через
dist — перед прогоном core-спек пересобирать sdk dist. Следующая сессия — батч B
(T4/T5/T6), carry: подтвердить отсутствие не-инвентарного красного в apps/server
(deferred T3).

## Pre-flight scan (батч B) — сессия 34 (2026-10-12)

BASE батча B = 9565e97. Задачи: T4 (oauth-удаление + миграция), T5 (bootstrap endpoint), T6 (псевдонимы).

Пары задач × общие файлы/интерфейсы:

| Пара | Общее | Находка |
|---|---|---|
| T4 × T5 | identity.service.ts, transport.module.ts, auth.tokens.ts, http-exception.filter.ts(+спек) | последовательны, конфликтов нет; комментарий инварианта T4 шаг 3 уже ссылается на findOrCreateOrganizer (T5) — согласованная forward-ссылка; T4 производит индекс, T5 race-тест на нём стоит |
| T4 × T6 | нет общих файлов (identity/transport vs membership/join.controller) | чисто |
| T5 × T6 | auth.controller vs join.controller — разные контроллеры | чисто |
| T4 внутри | delete-список vs grep | подтверждён: oauth/ = ровно 8 файлов; identity.errors.ts потребителей вне скоупа нет (identity.service — in-scope правка; event-outbox.ts:27 — только комментарий); batch A ruling pre-flight 2 (исторические комментарии в token.service/authenticate/realtime.gateway/seed-identity — не гейт) действует |
| T5 внутри | DI + методы | `issueRegisteredTokens` существует (token.service.ts:38); AuthController уже инжектирует config; **IdentityService НЕ достижим транзитивно** (MembershipModule экспортирует только MembershipService) → плановое «проверить» разрешено заранее, см. Ruling B-pre.1 |
| T6 внутри | тест 3 pseudonym.spec vs NOUNS | **конфликт**: тест хардкодит «Лиса» как NOUNS[0], но словарь плана начинается с «Барсук» и даже отсортированный по-кириллически «Барсук» < «Лиса» — тест 3 красный при дословной реализации. См. Ruling B-pre.2 |

Ruling B-pre.1: TransportModule ОБЯЗАН добавить IdentityModule в imports (IdentityService
нужен AuthController для findOrCreateOrganizer; MembershipModule его не экспортирует).
План это предусмотрел («если DI не разрешится — добавить IdentityModule, прецедент
T7-шова Quiz-среза») — проверка проведена заранее, ответ: не разрешится. Цена ошибки:
ноль — импорт и так обязателен.
Ruling B-pre.2: тест 3 pseudonym.spec («исчерпание 10–99») не хардкодит «Лиса» —
выводит выбранное существительное пробным вызовом generatePseudonym(new Set(), sequence([0,0]))
и строит exhaustion-сет для него; ассерт расширения диапазона (1\d\d|\d{4}) сохраняется.
Семантика Review Focus не затронута (это не RF-пин, а unit генератора). Цена ошибки:
тест слегка слабее как документация, инвариант расширения запинан поведенчески.
Ruling B-pre.3 (carry T3 + примечание T4 шаг 5): web-контур (лендинг OAuth, smoke.spec)
чинится в T9 — красный vitest apps/web/playwright в батче B санкционирован планом;
гейты батча B зелёные для sdk/core/apps-server, apps/web — зафиксировать, не чинить.
Цена ошибки: отложенное web-красное — планом принято (T9).

Task 4: dispatched implementer (sonnet), brief task-4-brief.md, BASE=9565e97.
Task 4: implementer DONE_WITH_CONCERNS (commit e2c4ffc, 36 файлов +121/−1562): гейты зелёные кроме санкционированного join.controller.ts (T2.1/T6); вне брифа — починены 7 фикстурных suites (blast radius индекса), удалён 1 membership-тест, it.skip lottery verified-e2e, добавлен jest-env-setup.ts. Диспатчен таск-ревьюер (opus), пакет review-9565e97..e2c4ffc.diff.
Task 4: minor (deferred): identity-schema.int-spec.ts:42-54 — два rejection-теста email-индекса теперь проходят по новому kind-индексу (первый выстрел), а не по email-индексу; присутствие email-индекса запинано отдельно, семантика «allows» покрыта — inherent к ADR-012, не дефект.
Task 4: minor (deferred): асимметрия delete vs skip — membership-тест «REGISTERED-цель сохраняет сессии» удалён с комментарием, lottery verified — it.skip; при возврате аккаунтов membership-пин восстанавливать по git history (e2c4ffc~).
Task 4: ⚠️-resolution: гейты перепроверены контроллером — `pnpm --filter @mymozhem/core build` красное РОВНО на join.controller.ts(28,73) TS2322 (санкционировано T2.1/T6), остальное по отчёту + ревьюеру.
Task 4: complete (commits 9565e97..e2c4ffc, review clean — spec ✅, quality Approved, 0 Critical/Important, 2 minor deferred)
Task 5: dispatched implementer (sonnet), brief task-5-brief.md, BASE=e2c4ffc, Ruling B-pre.1 в диспатче (IdentityModule в imports TransportModule обязателен).
Task 5: implementer DONE (commit 0f16856): 219/219 unit, 210/210 int (race-тест 5 параллельных bootstrap → 1 REGISTERED), e2e 62+1skip (organizer-bootstrap 5/5); красное только санкционированное T6. Диспатчен таск-ревьюер (opus), пакет review-e2c4ffc..0f16856.diff.
Task 5: minor (deferred): organizer-bootstrap.e2e happy-path делит один per-IP лимитер (app.inject = один remoteAddress) — снижение дефолта ORGANIZER_RATE_LIMIT сделает тесты 429-флейками; rate-limit-контур уже в отдельном describe с ORGANIZER_RATE_LIMIT=2.
Task 5: minor (deferred): findOrCreateOrganizer catch ловит любой P2002, не только от Identity_single_registered_key — сегодня других конфликтов на записи нет, winner=null → rethrow безопасен.
Task 5: ⚠️-resolution: трейлер Co-Authored-By в 0f16856 проверен контроллером — на месте.
Task 5: complete (commits e2c4ffc..0f16856, review clean — spec ✅, quality Approved, 0 Critical/Important, 2 minor deferred)
Task 6: dispatched implementer (sonnet), brief task-6-brief.md, BASE=0f16856, Ruling B-pre.2 в диспатче (тест исчерпания без хардкода 'Лиса'). Критерий: всё дерево зелёное после коммита (T6 снимает санкционированное красное T2.1).
Task 6: implementer DONE (commit b9cf868): все гейты зелёные, санкционированное красное T2.1 снято; B-pre.2 применён; отступление — sequence-хелпер без _bound (lint). Диспатчен таск-ревьюер (opus), пакет review-0f16856..b9cf868.diff.
Task 6: minor (deferred): ветка детерминированного скана псевдонимов (3-й цикл) без теста — дешёвый пин терминируемости (все 990 заняты → Слово-1000), бриф не требовал.
Task 6: minor (deferred, осознанный приём): уникальность псевдонимов вероятностная, не гарантированная — конкурентные безымянные join могут получить дубликат (нет unique-ограничения; §0.1 дизайна — best-effort retry, не инвариант).
Task 6: ⚠️-resolution контроллером: трейлер Co-Authored-By в b9cf868 на месте; спот-гейты build/typecheck/boundary-check зелёные (turbo cache после прогонов имплементера).
Task 6: complete (commits 0f16856..b9cf868, review clean — spec ✅, quality Approved, 0 Critical/Important, 2 minor deferred)
БАТЧ B: все 3 задачи complete (T4 e2c4ffc, T5 0f16856, T6 b9cf868). Диспатчен финальный целобатчевый ревьюер (opus), пакет review-9565e97..b9cf868.diff, триаж 6 deferred-миноров в брифе.

## Финревью батча B (2026-10-12, сессия 34)

Вердикт: With fixes. 2 Important, 3 Minor, все 6 deferred-миноров таск-ревью — stay-deferred (подтверждены финревьюм).
Ruling B-F.1: Important #1 — `apps/server/scripts/create-room.mjs` удаляется fix-волной (уже сломан с 934ae8b — конструктор MembershipService += PinoLogger; создаёт REGISTERED с email = PII против ADR-012 и падает о Identity_single_registered_key на bootstrapped-инстансе). Плановый пробел (план знал e2e-web-seed.mjs в T9, но не этот скрипт). Цена ошибки: скрипт восстановим из git при возврате аккаунтов; зафиксировать в HANDOFF для владельца.
Ruling B-F.2: Important #2 — warn-log ContractError ORGANIZER_SETUP_INVALID в http-exception.filter (security-observability норма удалённого OAuth-контура: сигнал брутфорса единственной креденшалы должен пережить {code}-only wire) + кейс в спек фильтра. В fix-волну. Цена ошибки: без него брутфорс setup-токена невидим в логах.
Ruling B-F.3: Minor #1 финревью (инвариант-комментарий «двух мест» vs реальных трёх: identity.service.ts:6-8 + room.service.ts:82-83 со stale именем старого индекса) — тоже в fix-волну (дёшево, та же область). Minors #2 (stale OAuth-комментарии — ruling батча A «не гейт») и #3 (dead pointer bootstrap-smoke в jest-env-setup.ts) — stay-deferred... уточнение: #3 однострочник, включён в fix-волну; #2 stay-deferred.
Fix wave: один диспатч (sonnet), затем одно скопированное ре-ревью. FIX_BASE=b9cf868.
Fix wave: DONE (commit b05ba77): PinoLogger-claim подтверждён (скрипт передавал 4 параметра из 5), create-room.mjs удалён; warn-log ORGANIZER_SETUP_INVALID + спек-кейсы; инвариант-комментарии выровнены; jest-env-setup указатель поправлен. Все гейты зелёные (unit 224/224, int 213/213, e2e 63+1skip). Concern для HANDOFF/T9: e2e-web-seed.mjs сам несёт staleness (REGISTERED+email, ссылка на OAuth-complete) — скоуп T9. Нетронутые doc-ссылки на create-room.mjs: 4 файла в docs/sessions/* (исторические). Диспатчено скопированное ре-ревью (sonnet), пакет review-b9cf868..b05ba77.diff.
Fix wave: re-review clean — все 4 finding ADDRESSED, новой поломки нет. Deferred-кандидаты ре-ревью (stay-deferred): stale имя индекса в комментарии e2e-web-seed.mjs:160; e2e-web-seed.mjs сеет через issueRegisteredTokens + OAuth-лендинг-комментарий (скоуп T9, см. concern фикс-волны); спек фильтра без явного ассерта reply.status(401) (запинан wire-код → мапа).

## БАТЧ B ЗАВЕРШЁН (2026-10-12, сессия 34)

Коммиты: e2c4ffc (T4), 0f16856 (T5), b9cf868 (T6), b05ba77 (fix wave). Ветка adr-012-zero-pii.
Все гейты монорепы зелёные ПОЛНОСТЬЮ (санкционированное красное батча A снято в T6).
Готовность к батчу C: индекс + bootstrap + псевдонимы на месте; web-контур (лендинг OAuth, strict joinRoom, smoke.spec) — санкционированный скоуп T9; e2e-web-seed.mjs — T9 (несёт REGISTERED+email и OAuth-ссылки).
Опыт сессии: (1) миграция с новым инвариантом «один живой REGISTERED» имеет blast radius на фикстуры, сеющие 2+ REGISTERED — будущим инвариант-миграциям включать grep фикстур в задачу; (2) предподтверждённые факты в диспатче (DI-разрешение, потребители файлов) снимают класс «проверить» с имплементера; (3) серверные e2e бутают ConfigModule из process.env — обязательные ключи конфига требуют jest-env-setup (паттерн закреплён).

## Pre-flight scan (батч C) — сессия 35 (2026-10-12)

BASE батча C = b05ba77. Задачи: T7 (prize_mode-гейт + lottery v2), T8 (свип += joinIp/Exclusion), T9 (web+ops+docs).
План и дизайн (спека, §0 решения владельца) прочитаны контроллером.

Пары задач × общие файлы/интерфейсы:

| Пара | Общее | Находка |
|---|---|---|
| T7 × T8 | нет общих файлов (rewards/app-lottery vs identity/membership) | чисто |
| T7 × T9 | интерфейс: drawCompletedPayload.prizeId null (T7 производит → T9 потребляет в winners.tsx/prizes-panel) | последовательны, файлового пересечения нет |
| T8 × T9 | нет общих файлов | чисто |
| T7 внутри | delete/модификация-якоря | подтверждены: manifest.contract.spec drawEligibility-кейсы ~61-85, LOTTERY_MANIFEST_VERSION=1, it.skip verified lottery.e2e:346 (carry из T4 — владелец T7, план шаг 6 удаляет), rooms-lifecycle.int-spec:30-43 (локальный манифест v1 + drawEligibility). **Новая находка: blast radius PRIZE_MODE** — см. Ruling C-pre.1 |
| T8 внутри | якоря симуляции свипа | сместились после T6: фактически describe listActiveParticipantPool ~315-330 (не 296-302), содержание совпадает — C-pre.3 |
| T9 внутри | host-session, compose, CI, smoke | anonClient в host-session.ts НЕ экспортирован (скетч плана его использует) — C-pre.2; compose OAuth-блок подтверждён ~28-37; CI seed-шаг подтверждён ci.yml:80-84 + job env JWT_SECRET:50 — C-pre.4; playwright baseURL зашит http://localhost:3000 (намеренно не из env) — прогон только против локального compose-стенда, prod-safety соблюдена |

Ruling C-pre.1 (blast radius гейта PRIZE_MODE): существующие призовые тесты получают
PRIZE_MODE='on' (спека §7: «on → прежнее поведение»), новые гейт-кейсы — 'off'. Точки:
(а) rewards.int-spec.ts и rewards.controller.int-spec.ts — override APP_CONFIG с TEST_CONFIG
(off) красит ВСЕ существующие призовые кейсы → базовый override становится
{...TEST_CONFIG, PRIZE_MODE: 'on'}, новый describe гейта — модуль с 'off';
(б) app-runtime.int-spec.ts:645 — скетч плана (голый TEST_CONFIG) сделал бы красным тест
дубля award.prize с реальным RewardsService → конструировать с {...TEST_CONFIG, PRIZE_MODE: 'on'}
(плановая неточность, спека — авторитет);
(в) lottery.e2e-spec.ts main describe — process.env.PRIZE_MODE='on' в beforeAll с save/restore
(прецедент JWT_SECRET), иначе все призовые сценарии красны при env-дефолте off; RF3-кейс
(draw.run с prizeId при off → PRIZES_DISABLED, откат) — отдельный describe с собственным
boot при PRIZE_MODE='off'; безпризовой сценарий не загейчен — может жить в main suite;
(г) guest-sweep.int-spec.ts НЕ затронут гейтом (сеет award'ы напрямую prisma.award.create,
использует только fulfill/revoke — вне гейта по §0.3).
Цена ошибки: перепутанный режим мгновенно красит соответствующие тесты — самодетектируется.
Ruling C-pre.2 (host-session anonClient): экспортировать существующий module-level anonClient
из host-session.ts (скетч плана HostLoginPage использует его, но он module-private); новый
ApiClient в host-login-page НЕ создавать (пин HANDOFF «консоль не создаёт второй SessionStore»
по духу распространяется и на клиент). Цена ошибки: ноль — добавление export.
Ruling C-pre.3 (координаты T8): блок симуляции свипа membership.service.int-spec.ts фактически
~315-330 (describe listActiveParticipantPool, тест P2) — якоря «296-302» устарели после T6;
содержание блока совпадает с описанием плана.
Ruling C-pre.4 (CI): seed-шаг .github/workflows/ci.yml:80-84 (e2e-web-seed.mjs + E2E_REFRESH_TOKEN)
удаляется в T9; ORGANIZER_SETUP_TOKEN добавляется в job-level env e2e-джоба (рядом с JWT_SECRET,
строка ~50, прецедент ci-e2e-dummy значения) — compose-директива :? и playwright-прогон наследуют
одно значение.

## Исполнение (батч C)

Task 7: dispatched implementer (sonnet), brief task-7-brief.md, BASE=b05ba77, rulings C-pre.1 (полностью) в диспатче.
Task 7: implementer DONE_WITH_CONCERNS (commit e0b65c8): все гейты зелёные (unit; core int 218/218, 23 suites; lottery.e2e 8/8; app-lottery 39/39), TDD RED/GREEN зафиксирован для обеих волн. Concern 1 — уточнение C-pre.1(г): предпосылка ruling'а неверна — guest-sweep.int-spec.ts:224/238 исполняет award.prize через executeEffects (не только prisma.award.create + fulfill/revoke); фикс имплементера config-only (override PRIZE_MODE:'on' в REQ-RWD-013 describe), поведение под тестом не тронуто — в духе ruling'а, ПРИНЯТО контроллером (фактическая поправка к предпосылке, не к решению). Concern 2 — скетч брифа для безпризового handler-теста требовал drawPool: POOL (пустой пул по умолчанию бросает DRAW_POOL_EMPTY) — принято.
Task 7: minor (deferred): гейт в createPrize стоит до assertOrganizer (буква брифа «первая строка») — не-организатор при off получает PRIZES_DISABLED вместо ACTOR_NOT_ORGANIZER; режим узнаваем до проверки роли, держать в уме при будущих изменениях порядка.
Task 7: minor (deferred): off-describes в rewards.int-spec/rewards.controller.int-spec дублируют bootstrap модуля + testcontainer (~+15 c); предписано C-pre.1, при росте конфиг-вариантов — фабрика модуля.
Task 7: complete (commits b05ba77..e0b65c8, review clean — spec ✅, quality Approved, 0 Critical/Important, 2 minor deferred)
Task 8: dispatched implementer (sonnet), brief task-8-brief.md, BASE=e0b65c8, Ruling C-pre.3 в диспатче.
Task 8: implementer DONE (commit 5e837c1): полные гейты зелёные, core int 220/220 (23 suites), новый describe 2/2, RED зафиксирован (joinIp вместо null). Шаг 4 — выбор: ручная симуляция ДОПОЛНЕНА (не заменена реальным свипом): свип по TTL смёл бы обоих гостей теста и P1-GUEST из beforeAll; выбор зафиксирован в коммите. Диспатчен таск-ревьюер (sonnet — диф мал, код дан планом дословно), пакет review-e0b65c8..5e837c1.diff.
Task 8: minor (deferred): обоснование выбора шага 4 в комментарии membership.service.int-spec.ts:325-330 и сообщении коммита ПРЕУВЕЛИЧЕНО («смёл бы обоих гостей и P1» — на самом деле P1 не expired при GUEST_TTL=86400, а backdating createdAt возможен; истинный блокер — wiring гардов + backdating SQL). Выбор санкционирован и верен, формулировка — поправить при следующем касании.
Task 8: minor (deferred): симуляция P2 не несёт session.updateMany (отзыв сессий) и email:null из реального свипа — дрейф по объёму, для listActiveParticipantPool иррелевантно; полстроки в комментарий при касании.
Task 8: complete (commits e0b65c8..5e837c1, review clean — spec ✅, quality Approved, 0 Critical/Important, 2 minor deferred)
Task 9: dispatched implementer (sonnet), brief task-9-brief.md, BASE=5e837c1, rulings C-pre.2/C-pre.4 в диспатче.
Task 9: implementer DONE (commit c577c8e): web vitest 75/75, playwright smoke 1/1 против локального compose-стенда (UI-bootstrap → квиз полный круг), полные гейты зелёные, стенд погашен down -v. Concerns (наблюдения): (1) host-gate.tsx держит OAuth-комментарий — файл заморожен дизайном §9, не тронут; (2) чеклист §9 при дефолтном PRIZE_MODE=off упирается в PRIZES_DISABLED — пометка «требует PRIZE_MODE=on» вне брифа, кандидат владельцу (exit-аудит/HANDOFF); (3) маппинг ORGANIZER_SETUP_INVALID только в host-login-page (единственное место, где код возможен) — отклонение от буквы брифа («маппинги += оба кода»), на суд таск-ревьюера. Диспатчен таск-ревьюер (opus), пакет review-5e837c1..c577c8e.diff.
Task 9: minor (deferred): чеклист §9 (~124-133) при дефолтном PRIZE_MODE=off упирается в PRIZES_DISABLED на шаге 9.1 — пометки «требует PRIZE_MODE=on» нет; кандидат владельцу при ревизии чеклиста (exit-аудит).
Task 9: minor (deferred): host-gate.tsx — устаревший OAuth-комментарий; файл заморожен дизайном §9, правка отдельным санкционированным изменением.
Task 9: minor (deferred, plan-mandated): host-login-page.tsx:17 — токен сабмитится без .trim() (скетч брифа не тримит); вставка с хвостовым пробелом → «Неверный токен организатора.» при визуально верном вводе.
Task 9: отклонение «маппинг ORGANIZER_SETUP_INVALID только в host-login-page» ВЕРИФИЦИРОВАНО ревьюером как разумная минимизация (единственный producer — auth.controller.ts:62, единственный клиент — bootstrapOrganizer; скетч шага 2 брифа сам предписывает inline-маппинг в странице).
Task 9: complete (commits 5e837c1..c577c8e, review clean — spec ✅, quality Approved, 0 Critical/Important, 3 minor deferred)
БАТЧ C: все 3 задачи complete (T7 e0b65c8, T8 5e837c1, T9 c577c8e). Диспатчен финальный целобатчевый ревьюер (fable), пакет review-b05ba77..c577c8e.diff, триаж 7 deferred-миноров в брифе.

## Финревью батча C (2026-10-12, сессия 35)

Вердикт: With fixes — 1 Important, 1 Minor, declined-to-judge 6 строк. Все cross-task швы верифицированы живым деревом: единственная точка гейта award.prize (producers/executors), RF3-откат запинан, T7↔T9 wire-консистентность точная (клиент не шлёт prizeId:null в draw.run; draw.completed несёт явный null), T9↔T5 кука-контракт чист (setRefreshCookie общий), T8↔живой контур не тронут (rejoin по {roomId,ip} для живых записей работает), прод-готовность держится (compose fail-closed, нет висячих ссылок OAuth/seed/drawEligibility).
Ruling C-F.1: Important #1 — чеклист §9 (строки 9.1-9.4) непроходим при задокументированном батчем дефолте PRIZE_MODE=off (createPrize → PRIZES_DISABLED); это поверхность критерия выхода 6 (чеклист поименован) → fix-волна в этом срезе, НЕ follow-up. Фикс: пометка в шапке §9 «прогоняется при PRIZE_MODE=on; при дефолте вместо 9.1-9.2 — «Разыграть участника» (победитель без приза)» + строка дефолтного режима. Minor #2 (drift line-refs §0.3 prizes-panel.tsx:30-31) — едет с фиксом (та же область, дёшево).
Триаж deferred: 6/7 stay-deferred (гейт до assertOrganizer — plan-mandated I-3; дубль bootstrap off-describes — изоляция C-pre.1; преувеличенный комментарий T8 — comment-only; симуляция P2 без session/email — иррелевантно читаемому; host-gate OAuth-комментарий — файл заморожен §9; .trim() — plan-mandated, сервер чисто отказывает). №5 (чеклист §9) = Important #1 → fix.
Fix wave: один диспатч (resume T9-имплементера), затем одно скопированное ре-ревью. FIX_BASE=c577c8e.
Fix wave: DONE (commit 9891b65): §9 размечен по PRIZE_MODE (шапка «Режим прогона», строка 9.5 безпризового режима, протокол-таблица согласована), ref §0.3 → prizes-panel.tsx:31-32 (верифицировано), заодно §8.1 «создать приз» → «Закрыть вопрос» (quiz-команда вне гейта). Диспатчено скопированное ре-ревью (sonnet), пакет review-c577c8e..9891b65.diff.
Fix wave: re-review clean — Important #1 и Minor #2 ADDRESSED, фикс §8.1 верифицирован, тексты ошибок сверены с кодом focused check, новой поломки нет. Out-of-scope minors (stay-deferred): протокол-строка 0.3 «честная ошибка "Разыграть"» vs «Разыграть участника» (косметика); цитата ошибки LAN без финальной точки (предсуществовало).

## БАТЧ C ЗАВЕРШЁН (2026-10-12, сессия 35) — СРЕЗ ADR-012 ИСПОЛНЕН ЦЕЛИКОМ

Коммиты батча C: e0b65c8 (T7), 5e837c1 (T8), c577c8e (T9), 9891b65 (fix wave). Ветка adr-012-zero-pii.
Срез целиком: батч A (b5729c7, 351d14a, 5743300, 9565e97), батч B (e2c4ffc, 0f16856, b9cf868, b05ba77), батч C (выше).
Далее: exit-аудит по 6 критериям §10 дизайна (контроллер) + HANDOFF. Мердж ветки — решение владельца.
