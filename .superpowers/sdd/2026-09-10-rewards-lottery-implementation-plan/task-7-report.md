# Task 7 — отчёт: app-runtime — исполнение эффектов, capability-гейт, наполнение хост-примитивов

**Статус:** DONE
**Коммит:** `3800220` feat(core): исполнение эффектов в app-runtime — capability-гейт, AWARD_EFFECT_HANDLER, drawPool/randomInt наполнение
**Ветка:** rewards-lottery (worktree). Push не выполнялся (по инструкции).

## Что реализовано

1. **`packages/core/src/app-runtime/effects.ts` (новый)** — DI-шов REQ-RWD-001, дословно по брифу Step 3: `AwardEffectHandler` (сигнатура `(tx, roomId, sourceAppId, effects)` — совместима с `RewardsService.executeEffects` из Task 5) и токен `AWARD_EFFECT_HANDLER: symbol`. Импорты только `@prisma/client` (type) и `@mymozhem/sdk` (type) — ядро не зависит от rewards.
2. **`MembershipService.listActiveParticipantPool(roomId)`** — дословно по брифу Step 4: активные (`deletedAt: null`, живая комната) PARTICIPANT-членства → `DrawPoolEntry[]`; ORGANIZER/SPECTATOR/исключённые не входят.
3. **Диспетчер (`app-runtime.service.ts`)**:
   - Конструктор += `@Optional() @Inject(AWARD_EFFECT_HANDLER) awardEffectHandler?: AwardEffectHandler` (последним параметром; Nest-путь для composition root Task 11, позиционный — для спека).
   - `hasRewardsCapability = mod.manifest.capabilities?.includes('rewards') ?? false` после разрешения модуля.
   - `ctx.drawPool` наполняется через `listActiveParticipantPool` только для модулей с capability 'rewards', снапшот до вызова модуля; plain-модулям — `[]` (publish квиза не грузит membership).
   - Capability-гейт: эффекты без capability → `CAPABILITY_UNAVAILABLE` (сообщение с appId@version); с capability, но без провайдера → `CAPABILITY_UNAVAILABLE` ('rewards effect handler is not wired in this deployment') — fail-closed.
   - Эффекты исполняются в `outbox.run` **до** цикла коммитов одной транзакцией; отказ эффекта откатывает события (REQ-RWD-003/010). Валидация `appEffectSchema` из Task 3 сохранена и идёт раньше гейта (тест 11 — malformed-эффект → EVENT_PAYLOAD_INVALID — зелёный).
4. **Barrel** `packages/core/src/index.ts` += `export * from './app-runtime/effects';`.
5. `app-runtime.module.ts` — без правок (бриф: `@Optional()` в сервисе достаточно).

## Тесты

Новый nested describe «эффекты и хост-примитивы (Task 7)» в `app-runtime.int-spec.ts` — 7 кейсов:

1. backward compat: голый `AppCommit[]` коммитится как прежде.
2. Эффекты без capability → CAPABILITY_UNAVAILABLE, `logEvent.count` == baseline.
3. Эффекты с capability, сервис сконструирован без 8-го аргумента → CAPABILITY_UNAVAILABLE (fail-closed; прочитано по ruling 1).
4. Спай-handler, бросающий `PRIZE_FUND_EXHAUSTED`: dispatch отклонён с этим кодом; спай вызван ровно раз с `(tx, roomId, 'test-app', effects)`; **порядок «эффекты до коммитов» доказан чтением `tx.logEvent.count` внутри спая** — на момент вызова лога нет (== baseline), после отказа лог пуст (откат).
5. **Ruling 2 (обязательный кейс с реальным RewardsService):** capability-модуль возвращает 2 коммита + ДВА одинаковых `award.prize` в одном dispatch → dispatch успешен, `award.count == 1`, `quantity` приза 2→1 (ровно −1), в логе `test-app.note.posted`, `test-app.note.echoed` и ровно один `rewards.reward.awarded`. Handler — `new RewardsService(db.prisma, membership, eventLog, outbox)` (позиции сверены с конструктором); приз сидится прямым `prisma.prize.create` (паттерн seedPrize из rewards.int-spec.ts); комната ACTIVE с пином манифеста v3 через существующий `activeRoom(3)`; победитель — свежий guest (`randomUUID()` — валидный RFC 4122 для z.uuid() и FK).
6. drawPool: комната = организатор (REGISTERED/ORGANIZER) + P1/P2 (GUEST PARTICIPANT) + SPEC (SPECTATOR) + P3 (soft-deleted membership) → capability-модуль видит ровно 2 записи `{identityId: P1|P2, kind: 'GUEST'}`; plain-модуль → `drawPool: []`.
7. `ctx.randomInt(3)` × 3000: все значения в [0,3), встречаются все три (REQ-RWD-011 sanity).

Фикстуры по ruling 3: `TEST_APP_CAPABLE` (тот же appId 'test-app', `manifestVersion: 3`, `capabilities: ['rewards']`), зарегистрирован в `AppRegistryService` массивом вместе с TEST_APP/TEST_APP_V2; `CapableRuntime` (manifest с capabilities, захват ctx) и `PlainResultRuntime` (без capabilities, форма AppPublishResult, захват ctx) — по образцу `EffectEmittingRuntime`. Существующий тест 10 (EffectEmittingRuntime без capabilities → CAPABILITY_UNAVAILABLE) сохранён и зелёный (ruling 4).

## TDD-доказательства

**RED** (после Step 1; спек компилируется — ts-jest с полным typecheck, поэтому вместе с тестами добавлены `effects.ts` (Step 3, чистые типы, нулевое поведение) и опциональный 8-й параметр конструктора (Step 5.1, на RED не читался)):

```
$ pnpm --filter @mymozhem/core test:int app-runtime.int-spec
✕ с подключённым исполнителем эффекты исполняются ДО коммитов… — Expected: "PRIZE_FUND_EXHAUSTED", Received: "CAPABILITY_UNAVAILABLE"
✕ дубль award.prize … с реальным RewardsService — ContractError: award effects are not executable in this deployment
✕ drawPool: capability-модуль получает активных PARTICIPANT… — Expected length: 2, Received length: 0
Tests: 3 failed, 18 passed, 21 total
```

Падения ровно по предсказанию брифа («CAPABILITY_UNAVAILABLE есть, но drawPool/исполнение не реализованы»): гейт-тесты и старые 14 кейсов зелёные уже на RED.

**GREEN:**

```
$ pnpm --filter @mymozhem/core test:int app-runtime.int-spec
Tests: 21 passed, 21 total   (все 7 новых + 14 прежних)

$ pnpm build
Tasks: 4 successful, 4 total

$ pnpm --filter @mymozhem/core test
Tests: 223 passed, 223 total (18 suites)

$ pnpm --filter @mymozhem/core test:int
Tests: 184 passed, 184 total (19 suites)

$ pnpm --filter @mymozhem/core lint && typecheck — чисто
$ pnpm boundary-check — ✔ no dependency violations found (571 modules, 1704 dependencies)
```

## Изменённые файлы

- `packages/core/src/app-runtime/effects.ts` (новый)
- `packages/core/src/app-runtime/app-runtime.service.ts`
- `packages/core/src/app-runtime/app-runtime.int-spec.ts`
- `packages/core/src/membership/membership.service.ts`
- `packages/core/src/index.ts`

## Self-review находки

1. **Отклонение от verbatim брифа (Step 5.5), осознанное:** бриф показывает `outbox.run` без внешнего `if`; оставлена гварда `if (commits.length > 0 || effectHandler)` и `foldCommitted` под `committed.length > 0`. Причины: (а) сохраняется существующий fast-path пустого результата модуля (no-op publish без транзакции); (б) effect-only publish (коммитов нет) всё равно исполняет эффекты — семантика брифа полностью покрыта; (в) безусловный `foldCommitted` с пустым `committed` писал бы `lastSeq: 0` в кэш проекции (поле сейчас не читается, но это тихий клоббер). Поведение всех кейсов брифа и rulings идентично.
2. **RED-фаза потребовала compile-skeleton** (effects.ts + 8-й параметр конструктора): ts-jest typecheck'ит весь файл, иначе RED был бы ошибкой компиляции, а не поведением. Скелет — чистые типы/сигнатуры без логики; RED-падения поведенческие (см. вывод выше).
3. Доказательство порядка «эффекты до коммитов» — сильнее предложенного в брифе «упрощённо»: спай читает `logEvent.count` **внутри присланной tx** — увидел бы незакоммиченные события, если бы коммиты шли первыми.
4. `drawPool`-снапшот берётся до вызова модуля (комментарий брифа соблюдён); гонка «участник исключён между снапшотом и коммитом» — принятый дизайном снапшот на момент команды.
5. Проверено: других позиционных конструирований `AppRuntimeService` вне спека нет; Nest-путь через `AppRuntimeModule.register([])` без провайдера не сломан (rewards.int-spec собирает DI-контейнер — прошёл в полной int-лане).
6. Замороженные миграции и схема БД не тронуты; SDK не менялся.

## Concerns

- Нет блокирующих. Единственное отклонение от дословного кода брифа — п.1 self-review (гварды вокруг `outbox.run`/`foldCommitted`); на рассмотрение ревьюера.
