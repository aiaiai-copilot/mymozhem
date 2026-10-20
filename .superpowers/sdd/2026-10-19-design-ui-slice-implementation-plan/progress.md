# SDD ledger — plan: docs/sessions/2026-10-19-design-ui-slice-implementation-plan.md

Scope this session: **батч A (задачи 1–3)** — правило владельца «батчи по 3 задачи, каждый батч новой сессией».
Branch: `design-ui-batch-a` (worktree `.worktrees/design-ui-batch-a`), BASE на старте: `995f5df`.
Baseline при входе: `pnpm install` + `pnpm build` + prisma:generate OK; `pnpm test` (turbo, 10 пакетов, вкл. server e2e 70/70) — зелёный.
Spec: `docs/sessions/2026-10-19-design-ui-slice-design.md` (принят владельцем). Прочитаны §6, §9, §10, §12, §13 — план им соответствует (payload identityId-only, минорный бамп SDK, quiz@3, 5–600, openedAt из AppHostContext.now, эффект редеплоя по прецеденту lottery@1).

## Pre-flight scan (батч A)

Проверено в коде: `CONTRACT_VERSION = '2.0.0'` (contract-version.ts:8); CORE_EVENTS = room.activated/completed/cancelled (core-events.ts); пины `contractRange: '^2.0.0'` в 7 спеках (sdk 2, core 5, server 1) — `^2.0.0` удовлетворяет 2.1.0 (semver), риплов эпохи НЕТ (в отличие от мажорного бампа 1→2, опыт батча A ADR-012).

| Пара/задача | Что один производит / другой потребляет | Находка |
|---|---|---|
| T1 → T2 | `CORE_EVENTS['member.joined']`, `coreEventType('member.joined')`, CONTRACT_VERSION 2.1.0 → ядро коммитит событие | Чисто: интерфейс явный (Interfaces T1/T2), схема strictObject({identityId: uuid}) совпадает с REQ-SEC-009 |
| T1 → T3 | бамп SDK 2.0.0→2.1.0 → app-quiz манифест (`contractRange '^2.0.0'`) | Чисто: minor-бамп внутри мажора, satisfies покрывает; пин версии quiz-манифеста (:42-45 contract-спеки) — о манифесте quiz, не о SDK |
| T2 → T3 | `member.joined` в логе каждой комнаты → seq-baseline'ы server e2e (quiz.e2e, quiz-points) | План предусматривает: T2 step 7 владеет правкой baseline'ов («относительно baseline», ruling ф.2); PII-цикл quiz-points не затронут (payload id-only). Конфликта нет — порядок T2→T3 корректен |
| T2 внутри | Step 1 (failing int-test) → Step 3 (рефактор EventLogModule) → Step 4 (коммит в join) | Чисто: рефактор под существующими тестами до смены поведения; DI-рипл AppRegistryModule.register([]) с прецедентом (rooms-lifecycle.controller.int-spec) |
| T3 внутри | Step 1/2 failing tests → Step 4 реализация → Step 6 риплы (web-фикстура, серверные прогоны) | Чисто: рипл-файлы (quiz-log.fixture.ts, пин версии) названы явно; эффект редеплоя quiz@2 → APP_MANIFEST_UNKNOWN принят дизайном §13 |
| План vs рубрика ревью | — | Ничего не мандатирует дефектных паттернов (тесты без ассертов, дублирование логики). «Фабрика лимитера переезжает verbatim» — перенос, не копия |

Pre-flight ruling 1: Пины `^2.0.0` не трогаем — minor-бамп 2.1.0 удовлетворяет диапазону; санкционированных красных сьютов в батче нет (в отличие от батча A ADR-012). Если где-то всплывёт точный пин `= 2.0.0` — правится в задаче-владельце как рипл. Cost if wrong: красный сьют вскроется на шаге полных гейтов T2/T3 и будет починен там же — цена одна итерация.

Конфликтов, требующих остановки, нет. Диспатчу Task 1.

## Execution

Task 1: complete (commits 995f5df..2545889, review clean — spec ✅, quality approved; sonnet-ревьюер, без fix-волн). ⚠️-пункт ревью (парность CONTRACT_VERSION ≡ package.json вне диффа) закрыт контроллером эмпирически: `pnpm --filter @mymozhem/sdk test -- contract-version` → 24/24 GREEN.
Task 1: minor (deferred): (1) нет прямого ассерта `coreEventType('member.joined') === 'core.member.joined'` (держится конструкцией composeEventType; опциональный пин для потребителя T12); (2) RED был compile-time TS7053, не runtime-ассертом (природа ts-jest при отсутствующем ключе реестра — к записи).

Task 2: dispatched (sonnet). BASE = 2545889.
Task 2: complete (commits 2545889..260a164, review clean — spec ✅, quality HIGH; sonnet-ревьюер, без fix-волн). DI-рипл AppRegistryModule.register([]) НЕ понадобился (0 сайтов — все тестовые модули уже имели транзитив через RealtimeModule; отрицательный результат подтверждён полным прогоном). Seq-baseline правки (3, realtime.e2e) признаны принципиальными. Флаг «member.joined в DRAFT-комнатах» — by design (core-path без status-гейта; нужен для live-ростера до старта; payload — псевдонимный uuid), действий нет.
Task 2: minor (deferred): (1) event-log.int-spec.ts:40 и room.service.int-spec.ts:43,582 конструируют второй EventLogService вместо переиспользования shared (безвредно, инконсистентно); (2) realtime.module.ts сохраняет частично дублирующие импорты MetricsModule/PrismaModule (безопасно, возможно нужны gateway/projection).

Task 3: dispatched (sonnet). BASE = 260a164.
Task 3 (carry для батчей B/C, из отчёта имплементера): комнаты, сконфигурированные без `durationSec`, хранят/проецируют JSON как передан — T5/T9 обязаны читать длительность через schema-parse (или `?? 30`), не raw JSON. Проверяется таск-ревью T3; при вердикте «дефект» уйдёт в fix-волну, иначе — carry в диспатчи T5/T9.

Task 3 review: первый ревьюер умер mid-run (output stale >1ч, статус «running» — класс watchdog/quota-смерти; опыт сессий 37–42). Убит контроллером, редиспатч fresh. Перед смертью успел поднять вопрос: локальный Ajv контракт-спеки без addFormats — может ли негативный кейс не-ISO `openedAt` вообще дискриминировать (вакуумность теста). Передано новому ревьюеру как обязательный к разрешению пункт.
Task 3 review: второй ревьюер умер тем же паттерном (~25 мин, stale 159 байт) — оба погибли на ad-hoc shell-экспериментах вокруг Ajv («pnpm doesn't hoist ajv to root»). Третий диспатч с жёсткими правилами среды: никаких install/npx/node -e/scratch-файлов; единственная эмпирика — `pnpm --filter @mymozhem/app-quiz test`; Ajv-вопрос решать статическим чтением (new Ajv/addFormats в sdk/app-quiz, toRegisteredSchema).
Task 3 review: третий ревьюер умер (~25 мин) — установил факт: контракт-спека конструирует `new Ajv2020({ allErrors: true, strict: false })` БЕЗ addFormats (format "date-time" в Ajv-артефакте игнорируется при strict:false). Четвёртый (fable) умер тем же паттерном — успел закрыть вопрос raw-JSON: handler перепарсивает settings (quiz-handlers.ts:191), дефолты материализуются на parse — carry-сoncern имплементера снят; ушёл в последнюю проверку (repo-wide ripple grep), ревью шло к чистому вердикту, но вердикта НЕТ.

## ДОРЕВЬЮ T3 (сессия 48, 2026-10-20) — ревью ЧИСТОЕ, вердикт Ready to merge: Yes

Один диспатч (sonnet) по протоколу стоп-леджера: жёсткие правила среды соблюдены, смертей не было (~7 мин, 32 tool-вызова). Все три открытых вопроса разрешены в пользу реализации:
1. **Ajv/addFormats — кейс НЕ вакуумен.** Премisa умершего ревьюера верна (спека: `new Ajv2020({allErrors:true, strict:false})` без addFormats, format "date-time" игнорируется — warning виден в выводе сьюта), но вывод неверен: zod v4 `toJSONSchema` для `z.iso.datetime()` эмитит **`pattern` рядом с `format`** (`$ZodCheckStringFormat` → `bag.patterns`, zod@4.4.3 v4/core/checks.cjs:438-441 → json-schema-processors.cjs:37-40); Ajv форсит `pattern` нативно — `'in a minute'` отвергается независимо от format-поддержки. Сьют перепрогнан ревьюером: 97/97.
2. **Ripple grep — полон.** Собственный grep ревьюера: все `manifestVersion: 2` — легитимно не-quiz (lottery-манифест, TEST_APP_V2, generic wire shape, локальная SDK-фикстура); потребители `QUIZ_MANIFEST_VERSION` едут на константе; web-референсы, публикующие `{questionIndex}` без openedAt, легальны (wire-optional + reducer fallback). Стейла нет.
3. **raw-JSON — documented carry, не дефект.** `quiz-handlers.ts:191` перепарсивает settings на каждом dispatch (дефолты материализуются); core-проекция (projection.service.ts:60-64) фильтрует сырой JSON по ключу без re-parse → потребители T5/T9 обязаны schema-parse или `?? 30` (carry подтверждён, потребителей ещё нет).

Task 3: **complete** (cd88edd). Minor (deferred): Ajv-харнес контракт-спеки расходится с прод-гейтом (core app-registry.service.ts:27-28 использует addFormats, спека — нет): сегодня безвредно (pattern покрывает date-time), но будущий format-only констрейнт без pattern-трассы будет форситься в проде и молча не тестироваться здесь + warning-шум в выводе. Fix при следующем касании: addFormats(ajv) (зависимость уже в workspace) или комментарий об осознанной дивергенции.

Рекомендации ревьюера (не гейтят): T5/T9 — читать durationSec через `quizSettingsSchema.parse` на границе проекции (дефолт single-sourced в схеме), не `?? 30` по компонентам; опционально ужесточить quiz.e2e:399 с `expect.any(String)` до ISO-regex.

## ФИНРЕВЬЮ БАТЧА A (сессия 48, 2026-10-20, fable, whole-branch 995f5df..f30ebff) — ЧИСТОЕ, Ready to merge: Yes

Гейты перепрогнаны ревьюером СВЕЖИМИ прогонами на HEAD f30ebff: build 6/6, typecheck 10/10, lint 6/6, sdk 329/329, core 230/230, app-quiz 97/97, web 117/117, server 71/71, test:int 223/223 (testcontainers), boundary-check 0 нарушений (747 модулей), guardrails 4/4. `git status` после прогонов чист.

**Триаж deferred-миноров — все 5 STAY-DEFERRED:** T1(1) — wire-строка 'core.member.joined' теперь запинана end-to-end в realtime.e2e (snapshot + live) — сильнее юнит-пина; T1(2) — природа ts-jest, GREEN рантайм-верифицирован; T2(1) — test-only инконсистентность; T2(2) — Nest дедупит инстансы модулей, нулевой эффект; T3(1) — независимо перепроверен pattern-трейс zod v4 (checks.cjs:436-441 → json-schema-processors.cjs:37-40), риск гипотетический, fix при следующем касании.

**Новые Minor (2, оба «при следующем касании файла»):** (1) quiz.e2e-spec.ts:399-400 — `expect.any(String)` → ISO-regex `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/` (defense-in-depth); (2) quiz-points.e2e-spec.ts:29 — восстановить первое предложение комментария о provenance «копия quiz.e2e helpers» (утеряно при правке).

**Сильные стороны (для протокола):** EventLogModule-экстракция разрывает DI-цикл Membership↔Realtime, re-export оставляет потребителей нетронутыми, EventLogModule без socket.io (REQ-RT-006); member.joined — последний шаг join-tx, доставка строго post-commit через outbox-staging; REQ-SEC-009 на уровне схемы (негативный тест extra-key displayName); REQ-RT-009 — rebuild payload вместо spread; REQ-RT-013 сохранён (оба источника openedAt — серверные часы); baseline-правки принципиальные с комментариями; кросс-таск консистентность T1↔T2↔T3 и версионная когерентность SDK 2.1.0 подтверждены; счета гейтов леджера воспроизвелись точно.

**Заметка к мерджу:** main ушёл от merge-base на один docs-only коммит (af36090, HANDOFF.md) — мердж бесконфликтный; после мерджа обновить HANDOFF.md на main (текст предшествует чистому доревью).

**Батч A ПРОЦЕССНО ЗАВЕРШЁН (3/3, оба ревью чистые). Готов к мерджу по ритуалу.**

## СТОП СЕССИИ (2026-10-20 ~05:45) — environmentная нестабильность [РАЗРЕШЕНО доревью выше]

Ruling (стоп): после 4 подряд смертей таск-ревьюеров T3 по единому паттерну (~25 мин жизни, output 159 байт, статус «running» навсегда; sonnet ×3 + fable ×1) редиспатчи прекращены — причина environmentная (класс watchdog/quota-смертей из опыта сессий 37–42), а не в задаче. T1/T2 прошли полный цикл чисто до ~00:30; деградация началась после полуночи. Cost if wrong: одна лишняя сессия на доревью T3 — приемлемо против бесконечного редиспатча.

**Состояние батча A на стоп:**
- T1: complete (2545889, ревью чистое). T2: complete (260a164, ревью HIGH). T3: РЕАЛИЗОВАН (cd88edd; гейты зелёные по evidence: app-quiz 97/97, web 117/117, server 71/71, int 223/223, build/lint/typecheck чисто), таск-ревью НЕ ЗАВЕРШЕНО — формально задача не complete.
- Незакрытые вопросы ревью T3 (для следующей сессии, частично разрешённые умершими ревьюерами): (1) Ajv/addFormats — контракт-спека без addFormats, strict:false → негативный кейс не-ISO `openedAt` через Ajv-артефакт ВАКУУМЕН, если он ходит через toRegisteredSchema, а не через zod; проверить, каким путём идёт кейс (если вакуумен — Minor/Important, усилить или зафиксировать); (2) raw-JSON concern — СНЯТ (дефолты на parse, quiz-handlers.ts:191); (3) repo-wide ripple grep версий — не завершён (implementer проgrepал и отчитался: projections.spec, quiz-editor.spec, e2e QUIZ_SETTINGS ×2, quiz.e2e:398).
- Финревью батча (whole-branch, fable) — НЕ начато.
- Следующая сессия: доделать таск-ревью T3 (при желании — одним диспатчем с этими тремя пунктами), затем финревью батча, finishing-a-development-branch, консолидация леджера (снять вложенный .superpowers/sdd/.gitignore), HANDOFF.
