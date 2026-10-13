# Task 8 — отчёт: TTL-свип гостей + ANONYMIZATION_GUARDS + scheduler

## Что реализовано

1. **`identity/anonymization-guards.ts`** (verbatim бриф): интерфейс `AnonymizationGuard` + DI-токен `ANONYMIZATION_GUARDS` (symbol). Identity объявляет токен, про rewards не знает (REQ-RWD-001).
2. **`identity/guest-sweep.service.ts`** (verbatim бриф): `GuestSweepService.sweepExpiredGuests(now?)` — выборка expired-гостей (`kind=GUEST, deletedAt=null, createdAt < now − GUEST_TTL`), опрос гардов, анонимизация (`displayName/email → NULL, deletedAt = now`) и отзыв живых сессий; выборка+запись — одна транзакция, гард читает вне неё (см. fix round 1 ниже). Гарды — `@Optional() @Inject(ANONYMIZATION_GUARDS)` с дефолтом `[]` (проверено по исходнику injector Nest 11.1.28: промах optional-зависимости резолвится в `undefined`, дефолт параметра срабатывает).
3. **`identity/identity.module.ts`**: providers/exports += `GuestSweepService`; imports += `ConfigModule` (ruling 1, прецедент AuthModule).
4. **`rewards/rewards-anonymization.guard.ts`** (verbatim бриф): `RewardsAnonymizationGuard` — winnerId с `status='AWARDED'` (FULFILLED/REVOKED — решённые).
5. **`rewards/rewards.module.ts`**: providers/exports += `RewardsAnonymizationGuard`.
6. **`identity/identity-sweep.module.ts`** (verbatim бриф): `GuestSweepScheduler` на `SchedulerRegistry` (bootstrap/shutdown), интервал `CLEANUP_INTERVAL`. НЕ подключён в composition root (Task 11), НЕ импортируется тестами.
7. **`index.ts`**: barrel += 4 экспорта (бриф Step 4).
8. **`package.json`**: `"@nestjs/schedule": "^6.1.3"` + `pnpm install` (один lockfile).

## Тесты и результаты

`packages/core/src/identity/guest-sweep.int-spec.ts` — 4 теста в двух describe (два независимых DI-модуля):

- **Describe A (без RewardsModule — ветка REQ-RWD-001):** ConfigModule + PrismaModule + IdentityModule + AuthModule, override APP_CONFIG → TEST_CONFIG.
  1. expired-гость анонимизируется: PII → NULL, deletedAt выставлен, id сохранён, сессия (создана через `TokenService.issueGuestTokens`) отозвана.
  2. свежий гость и backdated REGISTERED не тронуты (email на месте).
  3. без подключённых гардов приостановки нет: открытая AWARDED (прямой `prisma.award.create`) не спасает — анонимизирован.
- **Describe B (с гардом — REQ-RWD-013):** бутстрап rewards.int-spec.ts + IdentityModule + test-local wiring-модуль.
  4. гость с открытой AWARDED (через `RewardsService.executeEffects` в `outbox.run`) приостановлен (sweep → 0, displayName на месте); после `fulfill` анонимизируется следующим проходом; ветка `revoke` — то же на втором госте.

### Механизм связывания гардов (отклонение-уточнение брифа)

Бриф не специфицировал, КАК `ANONYMIZATION_GUARDS` попадает в `GuestSweepService` («связывает composition root, Task 11»). Проверено по исходнику Nest 11 (`injector.js:283-345`): резолюция зависимости ограничена скоупом модуля (свои провайдеры + экспорты импортированных, транзитивно) — провайдер корневого testing-модуля из IdentityModule НЕ виден, а IdentityModule не может импортировать RewardsModule (цикл: rewards → membership → identity). Рабочий механизм — `@Global()` wiring-модуль (глобальные модули добавляются в imports каждого модуля). В спеке это `TestAnonymizationWiringModule` (factory `guard → [guard]`, inject RewardsAnonymizationGuard); та же схема потребуется composition root в Task 11 — механизм тестом уже проверен.

## TDD-доказательства

**RED** — `pnpm --filter @mymozhem/core test:int guest-sweep`:
```
FAIL src/identity/guest-sweep.int-spec.ts
  ● Test suite failed to run
    error TS2307: Cannot find module '../rewards/rewards-anonymization.guard' …
    error TS2307: Cannot find module './anonymization-guards' …
    error TS2307: Cannot find module './guest-sweep.service' …
Test Suites: 1 failed, 1 total
```

**GREEN** — та же команда после реализации:
```
PASS src/identity/guest-sweep.int-spec.ts (9.054 s)
Tests: 4 passed, 4 total
```

**Полные ланы (watch-item ruling 1 — транзитивный APP_CONFIG через IdentityModule в oauth/membership):**
- `pnpm build` — 4/4 successful.
- `pnpm --filter @mymozhem/core test` — **223/223** (18 suites).
- `pnpm --filter @mymozhem/core test:int` — **188/188** (20 suites), включая rewards/oauth/membership-спеки с overrideProvider(APP_CONFIG).
- `pnpm --filter @mymozhem/core lint` — чисто; `pnpm boundary-check` — no dependency violations (585 modules).

## Фактическая версия @nestjs/schedule

`^6.1.3` (установлена 6.1.3; peerDependencies `@nestjs/common ^10 || ^11` — совместимо с Nest 11, проверено по npm). Бриф санкционировал `^6.0.0`; pnpm нормализовал до последней в линейке. На npm существует также 12.0.2 (peers `^11 || ^12`) — остались на версии брифа.

## Изменённые файлы

- `packages/core/src/identity/anonymization-guards.ts` (new)
- `packages/core/src/identity/guest-sweep.service.ts` (new)
- `packages/core/src/identity/identity-sweep.module.ts` (new)
- `packages/core/src/identity/guest-sweep.int-spec.ts` (new)
- `packages/core/src/identity/identity.module.ts` (ConfigModule + GuestSweepService)
- `packages/core/src/rewards/rewards-anonymization.guard.ts` (new)
- `packages/core/src/rewards/rewards.module.ts` (guard provider + export)
- `packages/core/src/index.ts` (barrel +4)
- `packages/core/package.json` (+@nestjs/schedule)
- `pnpm-lock.yaml`

## Self-review находки

1. Verbatim-код брифа перенесён дословно во все 4 новых source-файла; отклонения только в тесте (механизм wiring, см. выше) и в нормализации версии зависимости.
2. Оба describe делят паттерн «один контейнер на describe» (прецедент репозитория); identity не транкейтится — count-ассерты опираются на порядок объявления тестов (как в rewards.int-spec.ts: identity копится, значения уникальны на вызов).
3. `seedIdentity` не принимает displayName (ruling 3) — PII выставляется прямым prisma-апдейтом в хелпере `expiredGuest`.
4. `Award.sourceAppId` обязателен — прямой `award.create` в тесте 3 describe A заполняет `'lottery'`.
5. `IdentitySweepModule` нигде не импортируется (ни composition root — Task 11, ни тесты) — только компилируется; `SchedulerRegistry` разрешится из `ScheduleModule.forRoot()` composition root'а (комментарий брифа в файле).

## Concerns

1. **Task 11 обязан использовать @Global()-wiring для ANONYMIZATION_GUARDS** — иного способа дотянуться из IdentityModule нет (скоуп DI). Механизм проверен тестом, но это требование к composition root, которого в брифе Task 11 может не быть.
2. `@nestjs/schedule@12.0.2` (актуальная линейка, peers ^11||^12) сознательно не взята — бриф пинит ^6.0.0; если владелец захочет свежую — отдельное решение.
3. `SchedulerRegistry.addInterval` в @nestjs/schedule 6 при повторном имени бросает `ScheduleException` — при одной реплике (REQ-OPS-005) и одном bootstrap'е неактуально; рестарт процесса создаёт новый реестр.

---

## Fix round 1 (C-8.1): ложное утверждение о закрытии гонки гард-чека

**Находка ревью:** комментарий над `sweepExpiredGuests` заявлял «вся выборка/гард/запись — одна транзакция: гард-чек внутри неё закрывает окно гонки». Это ложно: `RewardsAnonymizationGuard.hasOpenAwards` читает через `this.prisma` (отдельное соединение, вне транзакции свипа), и даже на tx READ COMMITTED не защитил бы от award, закоммиченного между гард-чеком и коммитом.

**Что изменено (только формулировки, код не тронут — поведение = намерение плана):**
1. `packages/core/src/identity/guest-sweep.service.ts` — комментарий над `sweepExpiredGuests` переписан: одна транзакция даёт атомарность самого свипа (выборка+запись) и перечитывание `deletedAt` в updateMany как вторую линию от гонки с ручным исключением; гард читает ВНЕ транзакции — остаётся узкое окно «award закоммичен между гард-чеком и коммитом свипа», принято как риск MVP (свип раз в CLEANUP_INTERVAL, окно миллисекунды); закрытие окна — design-level решение (tx-aware гард / serializable+retry), для владельца.
2. Этот отчёт, раздел «Что реализовано» п.2 — формулировка «всё одной транзакцией» исправлена на «выборка+запись — одна транзакция, гард читает вне неё».

**Команда прогона:** `pnpm --filter @mymozhem/core test:int guest-sweep`

**Вывод:**
```
PASS src/identity/guest-sweep.int-spec.ts
Tests: 4 passed, 4 total
Ran all test suites matching /guest-sweep/i.
```
(1 suite, >0 матчей — паттерн сматчил ровно целевой файл.)

**Коммит:** `25c1820` docs(core): честный комментарий о гонке гард-чека в GuestSweepService — гард вне транзакции, окно принято как риск MVP
