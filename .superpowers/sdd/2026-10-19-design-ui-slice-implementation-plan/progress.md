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

---

# Батч B (задачи 4–6) — сессия 49 (2026-10-20)

Scope this session: **батч B (T4–T6: визуальный фундамент и вычислимое)** — правило владельца «батчи по 3 задачи, каждый батч новой сессией».
Branch: `design-ui-slice` (worktree `.worktrees/design-ui-slice`, решение владельца: один worktree/ветка на СРЕЗ, батчи B–E копятся в ней, мердж одним куском в конце среза). BASE на старте батча: `b1c7fe3` (= main с мерджем батча A `3c95e94`).
Baseline при входе: `pnpm install` + `pnpm build` + prisma:generate OK; `pnpm -r --filter '@mymozhem/*' test` (unit-сьюты всех пакетов) — зелёный (exit 0).
Spec: `docs/sessions/2026-10-19-design-ui-slice-design.md` — прочитаны §4 (палитры), §5 (лей-ауты), §6 (таймер), §7 (дорожки), §8 (состояния), «Канонические мокапы»; интерпретации плана I-1…I-12 прочитаны. План им соответствует (токены verbatim §4 + I-6 дополнения из мокапа).

## Pre-flight scan (батч B)

Проверено в коде: vitest `environment: 'node'`, include `src/**/*.spec.ts` — `tokens.spec.ts` (fs-чтение CSS) подхватывается; `apps/web/package.json` зависит от `@mymozhem/sdk` и `@mymozhem/app-quiz` (интерфейсы T6); `main.tsx:5` импортирует `./styles.css` (24 строки, есть); `index.html` без `data-theme` (добавляется T4); `standings.tsx` жив до T9 (I-4, T6 его не трогает); `projections.ts` проецирует quiz state — `lastRoundGains` T6 новый модуль, дублирования нет. Мокапы — НЕ в git (untracked `.superpowers/brainstorm/` основного чекаута, HANDOFF: «не коммитить, лицензии»); в диспатчах — абсолютные пути. woff2 в репо нет — скачиваются T4 (файлы в `public/`, не npm-зависимости — Global Constraint «ноль новых npm-зависимостей» соблюдён).

| Пара/задача | Что один производит / другой потребляет | Находка |
|---|---|---|
| T4 → T6 | токены `--track-canvas-dark/light`, `--t-race`, кнопочная система → компонент RaceTracks | Чисто: порядок T4→T6; имена/значения токенов идентичны в Interfaces обеих задач (§4 + I-6) |
| T4 ↔ T5 | — | Нет пересечения: T5 — чистая логика + хук, CSS не потребляет |
| T4 внутри | spec (fs.readFileSync tokens.css/transitions.css) → файлы по Interfaces → main.tsx/index.html wiring | Чисто: node-environment vitest допускает fs; RED-прогон реальный (файлов нет) |
| T4 vs Global Constraints | шрифты woff2 в `public/fonts/` (Oranienbaum 400, PT Sans 400/700, кириллица, OFL) | Чисто: файлы ≠ npm-зависимость; Blagovest не скачивать/не коммитить (гейт лицензии) |
| T5 → T6 | общего состояния нет; оба — потребители для T7–T9 | Чисто |
| T6 внутри | `lastRoundGains` ← `ProjectedEvent` (SDK) + payload `quiz.question.revealed` (app-quiz) | Чисто: обе зависимости объявлены в apps/web; `quiz-log.fixture.ts` (обновлён T3 под v3 + openedAt) — готовая фикстура для тестов |
| T6 vs существующее | `standings.tsx`/`projections.ts` остаются до T7–T9 | Чисто (I-4): T6 только добавляет модуль и компонент, потребителей пока нет |
| Carry батча A → батч B | «T5/T9: durationSec через quizSettingsSchema.parse на границе проекции» | Относится к потребителям проекции (T7–T9), не к T5 (получает durationSec параметром) — указатель переносится в диспатчи батча C |
| План vs рубрика ревью | T4 spec — grep-ассерты CSS по точным значениям; T5/T6 — юнит чистых функций | Чисто: дефектных паттернов (тесты без ассертов, дубли логики) план не мандатирует |

Pre-flight ruling B-1: Диспатчам T4/T6 передаются абсолютные пути мокапов основного чекаута (untracked, лицензии) — копировать мокапы в worktree/git нельзя. Cost if wrong: субагент не найдёт файл по имени и спросит — цена один раунд вопроса.
Pre-flight ruling B-2: Скачивание woff2 — через Google Fonts css2 API с desktop-UA (отдаёт woff2-URL), subset cyrillic; файл-источник не коммитится, коммитятся только woff2. Cost if wrong: неверный subset/начертание вскроется на визуальной приёмке T13/чеклисте — цена перекачка файлов.

Конфликтов, требующих остановки, нет. Диспатчу Task 4.

## Execution (батч B)
Task 4: complete (commits b1c7fe3..ec06703, review clean — spec ✅, quality approved; sonnet-ревьюер, без fix-волн). Оба заявленных отклонения подтверждены ревьюем как value-preserving: сцена привязана к `.btn-scene` вместо `.panel.dark`-обёртки мокапа (в приложении её нет); `node-test-shims.d.ts` — узкие ambient-декларации readFileSync/fileURLToPath (запрет install; header-нота об удалении при появлении @types/node). ⚠️-пункт (бинарное содержимое woff2 вне диффа) закрыт контроллером: наличие/именование/@font-face-подключение проверены ревьюем, рендер-верификация — T13/чеклист приёмки.
Task 4: minor (deferred): (1) gold focus-visible сужен до `.btn-scene` (мокап — любой `.btn` на тёмной панели; эквивалентно сегодня — watch-item T8, если консольный `.btn-primary` появится на сцене); (2) арифметика отчёта («31 токен» vs фактические 29 exact + 3 font) — косметика отчёта, не кода.
Task 5: dispatched (haiku). BASE = ec06703.
Task 5: complete (commits ec06703..b6c2a0a, review clean — spec ✅, quality approved; sonnet-ревьюер, без fix-волн). Все 8 кейсов брифа запинаны; floor-после-деления и двусторонний clamp подтверждены построчно; хук без 1-с лага (инициализатор useState), cleanup + deps на месте.
Task 5: minor (deferred): (1) граница elapsed == durationSec → ровно 0 отдельным кейсом не запинана (тот же код-путь через Math.max, риск нулевой); (2) formatTimer без защиты от нецелого входа (в реальном потоке всегда целый из remainingSec — контракт словом при следующем касании).
Task 6: dispatched (sonnet). BASE = b6c2a0a.
Ruling B-3 (диспатч T6): бриф не указывает, куда кладётся CSS дорожек — разрешено на усмотрение имплементера в рамках существующих styles/ (с обоснованием в отчёте); ревьюер оценит выбор. Cost if wrong: CSS переедет при касании T7–T9 — цена одна правка.
Task 6: complete (commits b6c2a0a..b3a0bf8, review clean — spec ✅, quality approved; sonnet-ревьюер, без fix-волн). Все 5 concerns имплементера разрешены обоснованно: единый `--track-fill` по дизайну §7 (мокапный `--console-primary` для консоли — расхождение мокапов, бриф важнее), «ещё N» дословно, `.tr-more` (бриф класс не пинит), `.fill.solo` зафиксирован как Extra из неканонических мокапов (финальное слово — T13), расширение reduced-motion блока transitions.css механически корректно (старое `.btn`-правило дословно сохранено, добавлены `.race-tracks .fill/.gain`). ⚠️-пункты (пиксель-в-пиксель мокап, a11y-минимум) — отложены брифом на T13, закрыты контроллером как by-design. Golden-тест на существующей фикстуре quiz-log.fixture.ts (два reveal) — проверяет и схему payload, и «последний reveal» на реальных данных.
Task 6: minor (deferred): (1) `.fill.solo` — Extra сверх брифа (одна строка CSS + тернарник; вердикт — T13); (2) `topN=0` → пустой список + «ещё N» (край не запрещён брифом, потребители T7–T9); (3) «ещё N» без плюрализации/слова «участников» (дословно по брифу; мокапы «+ ещё N участников» — кандидат при приёмке); (4) a11y дорожек (div'ы без ролей; в пределах паттерна репо — рассмотреть role=list на T13).

## Финревью батча B (fable, whole-branch b1c7fe3..b3a0bf8)

Вердикт: **Ready to merge: Yes.** Гейты перепрогнаны свежими на HEAD b3a0bf8: build 6/6, lint 6/6, typecheck 10/10, test 10/10 (sdk 329, core 230, app-quiz 97, app-lottery 39, web 145, server 71), test:int 223/223 testcontainers, boundary-check 0 (757 модулей), guardrails 8/8. Перекрёстных дефектов T4↔T5↔T6 и web→backend нет; все 25 var() резолвятся; контракт батча A соблюдён.
**Important #1 (дефект транскрипции плана, не имплементера):** компонент RaceTracks не рендерит числовую дельту `+N` рядом со счётом — дизайн §7: «дельта дублируется числом рядом» (a11y-обоснование мокапа: без цвета всё читается); эталон плана component-states-live.html дельту не содержал (демо с пустым gain) — потеряно при транскрипции. Решение: fix-волна сейчас (прецедент D-10.3 — Important финревью в fix-волну), до появления потребителей T7–T9.
Deferred 8/8 — stay-deferred (триаж финревью подтверждён): T4 ×2 (gold focus watch-item T8; арифметика отчёта), T5 ×2 (граница elapsed==duration; formatTimer нецелый), T6 ×4 (.fill.solo, topN=0, «ещё N» плюрализация, a11y-роли — все кандидаты T13).
Minor финревью (при следующем касании): tokens.spec.ts:122 — ассерт data-theme матчит комментарий, не index.html (добавить fs-ассерт index.html); question-timer.ts — Date.parse невалидного openedAt → NaN (контракт словом; на потоке валидировано схемой).
Рекомендации финревью владельцу/плану: (1) эталон разметки табличных компонентов — списком мокапов (канонический + контурные), не одним; (2) fs-ассерт data-theme при касании tokens.spec.
Финревью fix-волна 1/1: Important #1 (числовая дельта `+N`) — fix `8bc916d` (haiku): условный `<span className="delta">+{gain}</span>` при gain>0 внутри `.tr-score` + `.delta` (`var(--gold)`, tabular-nums, 700/12px) по мокапу console-reveal-tracks; typecheck + web 145/145 зелёные. Scoped re-review (sonnet): **ADDRESSED**, новых поломок нет, named-risk (тип gain) снят; out-of-scope: мокап красил дельту в `var(--ok)`, фикс взял `var(--gold)` в тон сегменту `.gain` — осознанно, задокументировано.

**Батч B ПРОЦЕССНО ЗАВЕРШЁН (3/3 + fix-волна, все ревью чистые).** Ветка `design-ui-slice` продолжается батчами C–E (мердж одним куском в конце среза). Следующая сессия — батч C (T7–T9: сцена и консольный каркас) новой сессией.
Carry в батч C: (1) durationSec читать через `quizSettingsSchema.parse` на границе проекции (carry батча A, потребители T7–T9); (2) watch-item T8: gold focus-visible сужен до `.btn-scene` — если консольный `.btn-primary` появится на сцене; (3) рекомендация финревью: эталон разметки табличных компонентов указывать списком мокапов (канонический + контурные); (4) при касании tokens.spec — fs-ассерт data-theme в index.html; (5) кандидаты T13: `.fill.solo`, плюрализация «ещё N», a11y-роли дорожек, рендер-верификация woff2.
Опыт сессии 49: environmentной нестабильности не было — все 7 диспатчей с первого раза (haiku ×3 имплементеры T4/T5 + fix, sonnet ×3 таск-ревью, fable финревью); диспозиция «haiku на транскрипцию/мелкие фиксы, sonnet на интеграцию и ревью, fable на финревью» — третья чистая сессия подряд без fix-волн на тасках; дефект транскрипции плана (дельта +N) пойман именно финревью с чтением контурных мокапов — целобранчевая оптика снова окупилась.

---

# Батч C (задачи 7–9) — сессия 50 (2026-10-20)

Scope this session: **батч C (T7–T9: сцена и консольный каркас)** — правило владельца «батчи по 3 задачи, каждый батч новой сессией».
Branch: `design-ui-slice` (worktree `.worktrees/design-ui-slice` — один worktree на срез). BASE на старте батча: `7a3fcfe` (леджер батча B; код-HEAD `8bc916d`).
Baseline при входе: гейты батча B перепрогнаны свежими финревью (сессия 49) на код-HEAD `8bc916d` — все зелёные (web 145, int 223, boundary 0, guardrails 8/8); `7a3fcfe` — docs-only поверх. Дерево чистое.
Spec: `docs/sessions/2026-10-19-design-ui-slice-design.md` — прочитаны целиком §0 (решения 1–19), §4–§9, §12, «Канонические мокапы»; Приложение A плана (дореформенный словарь). Мокапы проверены fs-наличием (15/15 эталонов батча C на месте, оба каталога brainstorm).

## Pre-flight scan (батч C)

Проверено в коде: `standings.tsx` потребители — ровно `play-page.tsx` (T7), `screen-page.tsx` (T8), `quiz-controls.tsx` (T9) (упоминание в race-tracks.tsx — комментарий, в quiz-log.fixture.ts — данные payload, не компонент); `QuizState.openedAt` есть (quiz-state.ts:17, fallback recordedAt); play/screen парсят questions через `quizSettingsSchema.shape.questions.safeParse` (play-page:175-178, screen-page:142-145 — carry батча A «schema-parse на границе» уже удовлетворён паттерном, zod-дефолт 30 материализуется на parse); base.css:74-85 держит `.screen-question`/`.screen-options` с комментарием «потребители живы до T8»; Winners рендерит null при пустых draws (winners.tsx:15); console-page:69-77 pinnedAppId на месте; кнопка «Завершить событие» — console-page.tsx:164-170 (внутри Files T9).

| Пара/задача | Что один производит / другой потребляет | Находка |
|---|---|---|
| T7 → T8 | `<Logo contour="scene" size="participant" />` (components/logo.tsx) → проектор 22px top-left (п. 17) | План пинит size="participant" (19px) и называет T8/T9 потребителями, но второй size не фиксирует → Ruling C-1 (ниже) |
| T7/T8 → T9 | standings.tsx удаляется в T9 (I-4) после миграции play (T7) и screen (T8) | Чисто при порядке T7→T8→T9: последний потребитель мигрирует в T9 |
| T7/T8 vs T5 | `useQuestionTimer(durationSec, openedAt)` ← questions[i].durationSec + quiz.openedAt | Чисто: обе ноги существуют; durationSec из schema-parse (см. выше) |
| T7/T8/T9 vs T6 | RaceTracks entries {actorId,name,total,gain} ← quiz.totals + rosterNames + lastRoundGains(events) | Чисто: источники на всех трёх страницах есть; сортировка/нормировка — внутри компонента |
| T8 vs T4 | base.css `.screen-question`/`.screen-options` заменяются финальными стилями | Чисто: комментарий base.css предсказывает замену; размещение финальных стилей — Ruling C-2 (прецедент B-3) |
| T9 внутри | console-page «Завершить событие» (:164-170) vs новый экран «Квиз окончен» (quiz.finished && ACTIVE) | Чисто: обе правки внутри Files T9; «Квиз окончен» — клиентское состояние (call дизайна §13) |
| T7 Step 5 vs п. 18 | Winners только при наличии розыгрыша | Чисто: Winners уже null при пустых draws; явный гард — на имплементера (семантически равно) |
| T9 Step 1 | openQuestionLabel: (2,30)→«Открыть вопрос 3 (30 с)», (2,null)→без суффикса (RF4) | Чисто: failing test первым, чистая функция |
| Приложение A | «МЫ МОЖЕМЪ», «Вопросъ N», «Правильный отвѣтъ», «Входъ в игру» | Чисто: текущие «Правильный ответ:» (play:307, screen:216) → «Правильный отвѣтъ»; консольная «Правильный ответ» — T10, не в этом батче |
| Global Constraints | ноль новых npm-зависимостей; REQ-RWD-009; REQ-SEC-009 | Чисто: батч только web/CSS; publish-контракты не тронуты |
| План vs рубрика ревью | T7/T8 — вёрстка без DOM-тестов (I-11); юнит только чистые функции | Чисто: тестов без ассертов/дублей логики план не мандатирует |
| T7 Step 1 | «кнопка «Играть» .btn .btn-primary? — НЕТ: сцена, вариант по мокапу входа» | Остаток размышления автора плана; разрешён I-9: вариант по participant-join-lobby-center-fix.html, .btn-primary консоли на сцене не используется |

Pre-flight ruling C-1: Logo — `contour: 'scene' | 'console'`, size-варианты 'participant' (19px) / 'projector' (22px); текст «МЫ МОЖЕМЪ», font-family var(--font-logo), золото на сцене. Позиционирование (центр вверху у участника / левый верхний у проектора) — обязанность страницы-родителя, не компонента. Cost if wrong: переезд одного CSS-правила при касании T8/T9 — цена одна правка.
Pre-flight ruling C-2: размещение финальных стилей экранов (замена .screen-question/.screen-options и стили новых блоков T7–T9) — на усмотрение имплементера в рамках существующего apps/web/src/styles/ (прецедент Ruling B-3), с обоснованием в отчёте; ревьюер оценит выбор. Cost if wrong: CSS переедет при касании — цена одна правка.
Pre-flight ruling C-3: carry батчей A/B учтён в диспатчах — (1) durationSec только из schema-parse на границе проекции (не raw JSON); (2) watch-item: gold focus-visible сужен до .btn-scene — T8 без интерактива, риск нулевой, отмечено в диспатче T8; (3) эталоны разметки указываются списком мокапов (канонический + контурные) — рекомендация финревью батча B; (4) tokens.spec fs-ассерт data-theme — батч C tokens.spec не касается, carry остаётся на T13/следующее касание. Cost if wrong: таск-ревью поймает расхождение с брифом — цена один fix-раунд.

Конфликтов, требующих остановки, нет. Диспатчу Task 7 (sonnet — интеграция в React-страницы из прозы + мокапы, не транскрипция).

## Execution (батч C)

Task 7: complete (commits 7a3fcfe..1a39801, review clean — spec ✅, quality approved; sonnet-имплементер, sonnet-ревьюер, без fix-волн). Сверки ревью: словарь Приложения A побайтово (ѣ=U+0463 подтверждена), пиксели против мокапов verbatim, I-9 (никакого .btn-primary на сцене), carry батча A (durationSec из schema-parse, ?? null), гард Winners п. 18, логика состояния не тронута. 9 расхождений мокапов разрешены имплементером документированно по приоритету «бриф/дизайн > мокап» — ревьюер подтвердил все.
Task 7: minor (deferred): (1) scene.css:87-90 — .play-input без сброса не-keyboard focus (нет аналога transitions.css:67 .btn:focus:not(:focus-visible)); (2) play-page.tsx:438,442 — склейка классов строкой с ведущим пробелом (clsx-стиль при следующем касании).
Task 7: carry из отчёта (не гейтит): e2e smoke.spec.ts стейл к новой разметке в 3 местах (:44, :58, :73) — планово чинится T13 (веб e2e вне гейтов до T13); мокапные литералы #354b41/#8fcaa5/#e5a092 — кандидаты в токены при следующем касании tokens.css (T13); progress.md осознанно не коммитится имплементерами (консолидируется контроллером в конце батча).
Task 8: dispatched (sonnet). BASE = 1a39801. Ruling C-4 (в диспатче T8): строка «ещё N» компонента RaceTracks не переопределяется — финализация «+ ещё N участников» остаётся отложенным кандидатом T13 (deferred T6(3)); cost if wrong: одна правка строки в компоненте на T13.
Task 8: complete (commits 1a39801..8136739, review clean — spec ✅, quality approved; sonnet-имплементер, sonnet-ревьюер, без fix-волн). Мокапная верность подтверждена построчно (таймер 56px, grid 1fr 1fr, отступ 35px, reveal-grid, финал 32/24px, кодпоинты словаря hexdump'ом). Расхождения мокапов разрешены по приоритету «бриф/дизайн > мокап» и задокументированы. ⚠️-пункт (quiz.openedAt — штамп ТЕКУЩЕГО вопроса) закрыт контроллером статически: quiz-state.ts:36-45 — currentQuestion и openedAt обновляются одной веткой редьюсера на question.opened, таймер рендерится только при accepting → штамп всегда текущего вопроса; не гэп.
Task 8: minor (deferred): (1) .screen-final-title 35px gold — выдуманное значение без эталона и без disclosure в отчёте (сохранение h1 защитимо a11y; подтвердить на ручной приёмке T14); (2) финал показывает дельты +N (lastRoundGains в финальной ветке), мокапный финал — solo без дельт; §7 молчит, прецедент участника — с дельтами; кандидат приёмки T13/T14; (3) reveal без correctIndex оставляет пустую левую колонку (семантика старого гарда, косметика).
Task 9: dispatched (sonnet). BASE = 8136739.
Task 9: complete (commits 8136739..3efda3d, review clean — spec ✅, quality approved; sonnet-имплементер, sonnet-ревьюер, без fix-волн). TDD RED→GREEN openQuestionLabel + participantsCount/pendingAwardsCount подтверждён; ландшафт-правило verbatim мокапу; «Квиз окончен» по п. 10/18 + REQ-RWD-009; standings.tsx удалён, импортов нет (grep); carry батча A соблюдён (?? null, schema-parse). 6 disclosed расхождений мокапов — все корректны по приоритету «бриф/дизайн > мокап».
Task 9: minor (deferred): (1) quiz-controls.tsx:355 — deckExhausted && current===null: disabled без причины текстом (несогласованность с :333-334, дегенеративный случай пустой колоды); (2) quiz-controls.tsx:263 — «В колоде {n} вопросов» без плюрализации; (3) quiz-controls.tsx:107,113 — финальный reveal парсится дважды; strict .parse в цикле лога крэшит рендер на malformed payload (payloads — контрактные от модуля, прежний код был cast-толерантным; наблюдение); (4) ландшафт + терминал: .console-hero grid 1fr 220px с пустой колонкой (косметика терминала).

## Финревью батча C (fable, whole-branch 7a3fcfe..3efda3d) — Ready to merge: With fixes → fix-волна 1/1, re-review ADDRESSED

Вердикт: **With fixes**; после fix-волны `d4ea739` и scoped re-review (sonnet, ADDRESSED, новых поломок нет) батч чист.
Гейты перепрогнаны ревьюером СВЕЖИМИ на HEAD 3efda3d: build 6/6, lint 6/6, typecheck 10/10, test 10/10 + свежий web 157/157 (23 файла), test:int --force 5/5 свежим (1m51s), boundary-check 0 (763 модуля), guardrails alive; `git status` после прогонов чист (кроме ожидаемого M progress.md).
**Important #1 (единственный):** потерян empty-state табло на play/screen — старый Standings показывал «Очков пока нет.», новые ветки reveal/финала рендерили заголовок над `<RaceTracks entries={[]}>` (достижимо: lottery-only, квиз без верных ответов, досрочный finish; консоль того же батча fallback имела — кросс-контурная несогласованность). Fix `d4ea739` (haiku): условный рендер по trackEntries.length > 0 с fallback «Очков пока нет.» verbatim в 4 местах 2 файлов; отклонение от образца (plain `<p>` вместо console `--muted` — тёмный токен нечитаем на сцене, generic-класса muted на сценах нет) проверено re-review как осознанное и верное. Re-review: ADDRESSED по всем 4 местам, new breakage none.
**Триаж deferred — все STAY-DEFERRED:** T7 ×2, T8 ×3, T9 ×4 (обоснования построчно в отчёте финревью; ключевые: watch-item gold focus-visible НЕ материализовался — .btn-primary на сцену не попал; плюрализация «ещё N»/«В колоде N вопросов» — слить одним пунктом T13; дельты в финале проектора/участника vs обнулённые в консоли — единое поведение решать на T13/T14; кегль логотипа консоли 19 vs мокапные 17px — T13/T14).
**Новый Minor от re-review (deferred):** fallback «Очков пока нет.» на сценах без теста (консольный — тоже; кандидат на будущий тест пустого табло).
**Declined-to-judge финревью (6 строк) — приняты контроллером:** «Комната останется доступной…» как `<p>`-заметка вместо неактивной btn-quiet мокапа (улучшение); кикер «Вопросъ N из M» сверх буквального словаря (словарь фиксирует словоформу, не суффикс; disclosed T7); «Игра завершена» vs «Игра окончена» tracks-мокапа (мокапы конфликтуют, disclosed T7); «Сыграно вопросов: X из N» при досрочном finish (разумное расширение, disclosed T9); логотип на pre-join экранах проектора (п. 17 про in-game; не вредит); стейл smoke.spec.ts (плановая территория T13).
**Сильные стороны (протокол):** кросс-таск швы чистые (Logo/таймер/RaceTracks единообразно на 3 контурах, carry батча A соблюдён везде); standings.tsx удалён полностью (grep); base.css цел после удаления старых классов; каскад main.tsx осознан и задокументирован; tokens.css не расширялся (литералы мокапов с комментариями); словарь по контуру соблюдён (кодпоинты hexdump); REQ-SEC-009/RT-009/RWD-009 не нарушены; TDD на вычислимом с RED- evidence; мокапная верность выборочно reverified финревьюм.

**Батч C ПРОЦЕССНО ЗАВЕРШЁН (3/3 + fix-волна, все ревью чистые).** Ветка `design-ui-slice` продолжается батчами D–E (мердж одним куском в конце среза). Следующая сессия — батч D (T10–T12: редактор, розыгрыш, live-ростер) новой сессией.
Carry в батч D: (1) плюрализация одним пунктом (T13, но T10/T12 касаются тех же строк — «ещё N» рендерит RaceTracks, редакторский список вопросов с длительностями — T10); (2) T10: «Правильный ответ» legend — современная орфография (Приложение A); (3) T12: устаревшие комментарии «join не эмитит событий» — play-page.tsx:131, screen-page.tsx:106, use-room-feed.ts:42,65 (use-room-feed назван в плане, play/screen — те же строки, кандидат заодно); (4) tokens.spec fs-ассерт data-theme (carry из батча B, при касании tokens.spec); (5) кандидаты T13 из батчей B/C — полный список в разделах выше.
Опыт сессии 50: environmentной нестабильности нет — 6/6 диспатчей с первого раза (sonnet ×3 имплементеры, sonnet ×3 таск-ревью, fable финревью, haiku fix, sonnet re-review — 8/8 с учётом fix-волны); четвёртая чистая сессия подряд. Финревью снова поймало то, что таск-ревью не видели (empty-state — кросс-контурная оптика: консоль fallback имела, сцены нет).
