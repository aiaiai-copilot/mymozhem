# Task 11 — ревью: composition root фазы 3 + boundary rewards + lint Math.random + guardrails

Рецензируемый диапазон: `e8f32b8..2b69756` (1 коммит, 10 файлов, +121/−11).
Метод: сверка с брифом, затем качество кода. Прогоны не повторялись; выполнены точечные read-only проверки (депкруиз/eslint на временных probe с правилом и без, grep по barrel и потребителям токенов).

## Spec compliance: ✅

Чеклист требований брифа:

- ✅ **Step 1 — probe boundary rewards** (`scripts/verify-guardrails.mjs`): probe `packages/core/src/room/__probe-rewards-boundary.ts` по существующему паттерну `writeFileSync + expectFailure(depcruise) + cleanup в finally`. Отклонение (относительный импорт `'../rewards/rewards.module'` вместо пакетного `'@mymozhem/core/src/…'`) обосновано и **проверено независимо**: без правила depcruise по probe даёт `✔ no dependency violations found (exit=0)`, с правилом — `error rewards-only-through-di-tokens: …room/__probe… → …rewards/rewards.module.ts`. Probe честный: стреляет ровно по новому правилу, не по `not-to-unresolvable` и не по `no-circular`. Отклонение — корректное исполнение, а не ослабление гардрейла.
- ✅ **Step 2 — probe eslint Math.random**: `packages/app-quiz/src/__probe-math-random.ts` с `export const x = Math.random();`, запуск `pnpm exec eslint`, cleanup. Проверено независимо: без блока в конфиге eslint молчит (exit=0; `moduleLevelMutableRule` ловит только `let`/`var`, probe на `const` его не задевает), с блоком — ошибка с точным message из брифа. Probe честный.
- ✅ **Step 3 — правила verbatim**: `.dependency-cruiser.cjs` — правило `rewards-only-through-di-tokens` в форме брифа + Ruling C-F.1: `from.pathNot` дополнен `'[.]int-spec[.]ts$'` **с поясняющим комментарием** (int-spec — миниатюры composition root). Проверено, что исключение не декоративное: `guest-sweep.int-spec.ts:15-17` и `app-runtime.int-spec.ts:23` реально импортируют `../rewards/*`. `eslint.config.js` — блок `no-restricted-syntax` с точным selector/message из брифа на `packages/app-*/src/**/*.ts` (REQ-RWD-011).
- ✅ **Step 4 — RewardsModule**: `@Global()`, провайдер `{ provide: AWARD_EFFECT_HANDLER, useExisting: RewardsService }`, экспорт токена, комментарий про DI-шов. `RewardsService implements AwardEffectHandler` с `import type` из `../app-runtime/effects` — разрешённое направление (rewards → app-runtime); сигнатура `executeEffects(tx, roomId, sourceAppId, effects)` совпадает с интерфейсом в `packages/core/src/app-runtime/effects.ts:8-15` (build зелёный).
- ✅ **Step 5 — composition root**: `apps/server/src/anonymization-guards.module.ts` verbatim (глобальный, фабрика `ANONYMIZATION_GUARDS` → массив гардов, `inject: [RewardsAnonymizationGuard]`). `apps/server/src/app.module.ts` — финальный файл сверен построчно с брифом: `ScheduleModule.forRoot()`, quiz+lottery в обоих реестрах, RewardsModule, IdentitySweepModule, AnonymizationGuardsModule — совпадает. `apps/server/package.json`: `+@mymozhem/app-lottery: workspace:*`, `+@nestjs/schedule: ^6.1.3` — линейка совпадает с `packages/core/package.json:20`; lockfile обновлён (+6 строк, только эти две связки).
- ✅ **Step 6 — pipeline green** (по отчёту: build 5/5, lint 5/5, boundary-check 0 violations на 619 модулях, guardrails 5/5 OK, e2e apps/server 58/58 на реальном AppModule, int 188/188). Точечные проверки консистентны с отчётом; RED-блок в отчёте показывает честный FAIL обоих probes до введения правил.
- ✅ **Step 7 — коммит**: состав и сообщение по брифу (+ один обоснованный файл сверх списка).
- ✅ **Связка токенов подтверждена в источниках**: `ANONYMIZATION_GUARDS` объявлен в `identity/anonymization-guards.ts:10`, потребляется `@Optional() @Inject(...)` с дефолтом `[]` в `guest-sweep.service.ts:19` — без подключённого rewards свип работает без приостановки (design §5). Barrel `index.ts:25-27,49-52` экспортирует всё необходимое, не тронут — подтверждено.

Ничего лишнего: все 10 файлов — из списка брифа + один санкционированный фикс. Новых модулей «про запас» нет (YAGNI соблюдён).

## Strengths

- **Честные guardrail-probes, доказанные, а не заявленные.** Реализатор сам поймал ложноположительный probe (пакетный subpath не резолвится depcruise → срабатывал `not-to-unresolvable`), исправил на относительный импорт с комментарием в коде и подтвердил RED. Независимая проверка рецензента воспроизвела: оба probe молчат без своих правил и стреляют по именно целевому правилу/сообщению с ними. Это эталонное исполнение guardrail-задачи.
- **Фикс `identity-sweep.module.ts` минимален и правильно мотивирован.** Асимметрия NestJS реальна: `app.init()` без `listen()` не вызывает `onApplicationBootstrap`, но `app.close()` вызывает `onApplicationShutdown` — безусловный `deleteInterval` бросал. Гард через `doesExist('interval', …)` идемпотентен, прод-путь (listen → bootstrap → shutdown) не меняется: интервал существует → удаляется как раньше. Комментарий объясняет именно причину, а не пересказывает код.
- Комментарии в новых местах объясняют «почему» (DI-шов REQ-RWD-001, int-spec как миниатюра composition root, REQ-RWD-011 со ссылкой на решение владельца) — плотность и стиль соответствуют окружающему коду.
- Коммит атомарен по задаче: правила + probes + wiring + lockfile одним срезом.

## Issues

### Minor

1. **`packages/core/src/identity/identity-sweep.module.ts:9-10` — устаревший комментарий.** Шапка файла гласит: «Регистрация интервала свипа — только в composition root (этот модуль не импортируется тестами…)». После этой задачи утверждение неверно: `AppModule` теперь импортирует `IdentitySweepModule`, а все 5 e2e-suites apps/server boot'ят реальный `AppModule` — модуль тестами импортируется, что и явилась причиной фикса в `onApplicationShutdown` (который сам это задокументировал). Сценарий: следующий читатель видит противоречие между шапкой и новым комментарием в shutdown-хуке и не понимает, какое из утверждений актуально. Рекомендация: поправить шапку — «не импортируется int-spec'ами (логика свипа покрыта прямым вызовом), но входит в AppModule e2e — отсюда идемпотентный shutdown». Не блокирует.

Критических и важных проблем нет.

## Cannot verify from diff

- Полные результаты `pnpm test` / `pnpm test:int` (58/58 e2e, 188/188 int) — приняты из отчёта; инструкция запрещает перезапускать suites. Косвенно подтверждено: DI-граф (глобальные RewardsModule/AnonymizationGuardsModule, `@Optional`-инъекция guards, SchedulerRegistry из `ScheduleModule.forRoot()`) типографически согласован с потребителями в источниках, а boot-валидация контейнером именно это и проверяет.
- RED-прогон с фиксацией «FAIL до правил» — из отчёта; однако честность probes подтверждена независимым воспроизведением (см. выше), что сильнее транскрипта.

## Verdict

**Spec compliance: ✅ — все пункты брифа закрыты, отклонения обоснованы и проверены.**
**Code quality: Approved.** Единственное замечание — устаревший комментарий в шапке `identity-sweep.module.ts` (Minor), можно поправить следующим коммитом без перевыпуска задачи.
