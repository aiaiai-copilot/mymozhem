# Task 5 report: Инструментация realtime (REQ-OPS-004)

## Что проверено из работы предыдущего имплементера (git diff против брифа)

- `subscription-registry.ts` — соответствует Step 2 дословно (gauge в add/remove, конструктор с metrics, комментарий REQ-OPS-004). Принято без правок.
- `subscription-registry.spec.ts` — `makeMetrics` + gauge-тест + перевод всех конструирований на metrics. Соответствует Step 1. Принято.
- `event-outbox.ts` — третий параметр metrics, catch со счётчиком, `commitErrorLabel` (P-код Prisma либо UNKNOWN). Соответствует Step 4. Принято (кроме import type → value, см. ниже).
- `event-outbox.int-spec.ts` — два теста счётчика. Логика соответствует Step 3, но с дефектом изоляции (см. ниже).
- `realtime.gateway.spec.ts` — частично: fakeMetrics + проброс последним аргументом, bus вынесен, возврат metrics/bus из makeGateway. Недоставало: двух новых тестов Step 5 и перевода шести прямых `new SubscriptionRegistry()` в телах тестов (файл не компилировался — TS2554).

## Что поправлено в чужих правках

1. **`event-outbox.int-spec.ts` — изоляция счётчика.** `metrics` создавался в `beforeAll` и делился между тестами: серия `{code="UNKNOWN"} 1` от первого нового теста протекала в рендер второго, и assert `not.toContain('mymozhem_event_commit_errors_total{')` падал (проверено прогоном: 8 passed / 1 failed). Исправлено: каждый из двух тестов конструирует свои `MetricsService` + `EventOutbox` локально. Заодно assert по `{` (а не по имени метрики, как в брифе) сохранён — prom-client рендерит HELP/TYPE с именем даже для пустого счётчика, бриф-вариант `not.toContain('mymozhem_event_commit_errors_total')` неосуществим; это отклонение предыдущего имплементера корректно.
2. **`event-outbox.ts` и `subscription-registry.ts` — `import type` → value import `MetricsService`.** С type-only импортом emitDecoratorMetadata эмитит `Function` в design:paramtypes, и Nest DI не резолвит зависимость в RealtimeModule («Nest can't resolve dependencies of the EventOutbox (PrismaService, RealtimeBus, ?)»): падали 5 int-сьютов, boot'ящих модуль (rewards, transport-контроллеры, guest-sweep). Бриф для gateway (Step 6) и так предписывает value import; для outbox/registry формально дан `import type` — отклонение вынужденное, контракт конструктора не меняется.

## Что реализовано мной (Steps 5–9 + Ruling B-pre.1)

- **Step 5 (RED):** шесть прямых `new SubscriptionRegistry()` в `realtime.gateway.spec.ts` переведены на `fakeRegistryMetrics()` (хелпер оставлен предыдущим имплементером); добавлены два теста из брифа: «subscribe замеряет длительность replay» (через публичный handleSubscribe) и «fan-out замеряет publish→deliver по recordedAt» (через `afterInit` + захват listener'а из `bus.subscribe`, server-фейк `{use,on,to,sockets}` по брифу). RED зафиксирован на уровне компиляции: «Expected 10 arguments, but got 11» — gateway ещё не принимал metrics.
- **Step 6 (GREEN):** `realtime.gateway.ts` — value import MetricsService; последний параметр конструктора `private readonly metrics: MetricsService`; замер replay (`performance.now()` вокруг чтения лога + сборки snapshot, observe после построения snapshot, до M-3-проверки); замер publish→deliver в `fanOut` после успешного emit, ветка MODULE_PRIVATE уходит в `continue` без замера. Unit realtime: 52 passed.
- **Step 7:** `realtime.module.ts` — `MetricsModule` импортирован первым в `imports`.
- **Ruling B-pre.1 — механическое обновление точек конструирования EventOutbox (третий аргумент `new MetricsService()`):**
  - `packages/core/src/room/room.service.int-spec.ts` (×2)
  - `packages/core/src/auth/token.service.int-spec.ts`
  - `packages/core/src/realtime/event-log.int-spec.ts`
  - `packages/core/src/realtime/event-commit.int-spec.ts` (×3)
  - `packages/core/src/app-runtime/app-runtime.int-spec.ts`
  - `packages/core/src/membership/membership.service.int-spec.ts` (×2)
  - `packages/core/src/realtime/db-down.int-spec.ts`
  - `apps/server/test/realtime.e2e-spec.ts` (MetricsService из `@mymozhem/core`)
  - `apps/server/test/transport.e2e-spec.ts` (MetricsService из `@mymozhem/core`)
  - Контроль grep'ом: двухаргументных `new EventOutbox(` не осталось; `new SubscriptionRegistry(` без metrics не осталось.

## Прогоны (Step 8 + e2e)

- `pnpm --filter @mymozhem/core test -- realtime` → 5 suites, 52 tests PASS.
- `pnpm --filter @mymozhem/core test` (все unit) → 19 suites, 234 tests PASS.
- `pnpm --filter @mymozhem/core test:int -- event-outbox.int-spec` → 9 tests PASS.
- `pnpm --filter @mymozhem/core test:int` (все int) → 22 suites, 211 tests PASS.
- `pnpm build` → 6/6 successful. `pnpm run boundary-check` → no violations (718 modules).
- `pnpm --filter @mymozhem/core lint`, `pnpm --filter @mymozhem/server lint` → чисто.
- `pnpm --filter @mymozhem/server test -- realtime.e2e` → 10 PASS; `-- transport.e2e` → 20 PASS (после `pnpm build`).

## TDD Evidence

- Steps 1–4: RED показан предыдущим имплементером (его последнее сообщение: «RED confirmed. Step 4: GREEN»); RED-прогоны не воспроизводились (код уже на месте). Мной эти шаги прогнаны в GREEN: unit registry (52/52 в realtime-наборе) и int outbox (9/9) — после моего фикса изоляции счётчика.
- Step 5 RED: `realtime.gateway.spec.ts` — «Test suite failed to run, TS2554: Expected 10 arguments, but got 11» (gateway без metrics). Step 6 GREEN: тот же файл — PASS, включая оба новых теста гистограмм.
- Дополнительный RED по ходу: полный int-лан показал DI-падение 5 сьютов (type-only import) → фикс value import → весь лан GREEN (211/211).

## Files changed (commit 320e3d5)

- packages/core/src/realtime/subscription-registry.ts / .spec.ts
- packages/core/src/realtime/event-outbox.ts / .int-spec.ts
- packages/core/src/realtime/realtime.gateway.ts / .spec.ts
- packages/core/src/realtime/realtime.module.ts
- packages/core/src/realtime/event-log.int-spec.ts, event-commit.int-spec.ts, db-down.int-spec.ts
- packages/core/src/room/room.service.int-spec.ts, packages/core/src/auth/token.service.int-spec.ts, packages/core/src/app-runtime/app-runtime.int-spec.ts, packages/core/src/membership/membership.service.int-spec.ts
- apps/server/test/realtime.e2e-spec.ts, apps/server/test/transport.e2e-spec.ts

## Self-review findings

- Diff вычитан целиком. Механические правки B-pre.1 — строго import + третий аргумент, ничего лишнего.
- Комментарий «Санкционированное отклонение (леджер Task 5 → Task 7)» при вставке нового fan-out теста оторвался от своего теста — возвращён на место.
- `packages/core/src/index.ts` не тронут (баррель обновлён в Task 4) — коммит-команда брифа скорректирована под фактический набор файлов.
- `performance.now()` — глобал Node ≥16, импорт не нужен.

## Issues / concerns

- Два вынужденных отклонения от буквы брифа (оба проверены прогонами): value import вместо `import type` в outbox/registry (иначе ломается Nest DI) и assert по `{` в тесте типизированного отказа (HELP/TYPE рендерятся всегда). Контракты и семантика брифа сохранены.

---

## Fix round 1 (Ruling B-5.1): gauge-парность на re-subscribe

**Finding (Important):** `SubscriptionRegistry.add` инкрементировал gauge безусловно; re-subscribe того же socketId в ту же комнату (разрешённый путь gateway, realtime.gateway.ts:128–129 → :151) давал инкремент без парного декремента — дрейф gauge вверх.

**Что изменил:**
1. `subscription-registry.ts` — в `add()` замер `connectionAdded` выполняется только если `bySocket` ещё не содержит `sub.socketId` (`isNew`-гард); остальное тело без изменений. Комментарий о парности обновлён.
2. `subscription-registry.spec.ts` — новый тест «re-add той же подписки (тот же socketId) не двигает gauge»: add дважды тем же socketId → `connectionAdded` ровно 1 раз; remove → `connectionRemoved` ровно 1 раз.

**TDD Evidence:** RED — `pnpm --filter @mymozhem/core test -- subscription-registry.spec` → «✕ re-add той же подписки … (1 failed, 5 passed)». После фикса — GREEN.

**Покрывающие прогоны:**
- `pnpm --filter @mymozhem/core test -- subscription-registry.spec` → 6 passed, 6 total.
- `pnpm --filter @mymozhem/core test -- realtime` → 5 suites, 53 passed, 53 total.

**Commit:** c12a9cf `fix(realtime): gauge-парность на re-subscribe — add идемпотентен по socketId (Review Focus 1)` — только subscription-registry.ts и subscription-registry.spec.ts.

---

## Fix-волна финревью батча B (Ruling B-F.1): структурный предикат счётчика ошибок фиксации

**Finding (Important, дефект плана):** предикат в `event-outbox.ts` исключал только `ContractError`/`RealtimeError`. Доменные иерархии ядра (RoomError, MembershipError, AppRegistryError, IdentityError, AuthError) наследуют голый `Error` со строковым `code` — их штатные отказы гейтов (напр. RoomConflictError через RoomService.transition) ложно инкрементили `mymozhem_event_commit_errors_total{code="UNKNOWN"}`.

**Что изменил:**
1. `event-outbox.ts` — instanceof-пара заменена на структурный предикат в `commitErrorLabel` (теперь возвращает `string | undefined`): PrismaClientKnownRequestError → P-код (ветка ДО структурной проверки — Prisma-ошибка тоже несёт string code); любая ошибка со строковым `code` → undefined (не считаем; конвенция «string code = типизированный отказ» покрывает ContractError/RealtimeError/все доменные иерархии ядра и будущие); остальное → UNKNOWN. Импорты ContractError/RealtimeError убраны. Комментарий фиксирует конвенцию и принятый промах (Node/system-ошибки со string code вне обёртки Prisma исключаются; adapter-pg оборачивает сбои БД в P2010).
2. `event-outbox.int-spec.ts` — новый тест: `outbox.run` reject `RoomConflictError` ('changed concurrently', импорт `../room/room.errors` по местному стилю) → серии `mymozhem_event_commit_errors_total{` нет. Существующие тесты (UNKNOWN считается, ContractError не считается) остались зелёными. Теста P-кода label в файле нет — не добавлял (вне scope фикса).

**TDD Evidence:** RED — новый тест падал на старом предикате (RoomConflictError инкрементил UNKNOWN): «✕ типизированный отказ домена ядра … (1 failed, 9 passed)». После фикса — GREEN.

**Прогоны (команды + вывод):**
- `pnpm --filter @mymozhem/core test:int -- event-outbox.int-spec` → 10 passed, 10 total.
- `pnpm --filter @mymozhem/core test -- realtime` → 5 suites, 53 passed, 53 total.
- `pnpm --filter @mymozhem/core typecheck` → чисто (tsc --noEmit, без ошибок).
- `pnpm --filter @mymozhem/core lint` → чисто.

**Commit:** d1e73a8 `fix(realtime): commit-error counter — исключить все типизированные доменные отказы (string code), не только Contract/Realtime (Ruling B-F.1)` — только event-outbox.ts и event-outbox.int-spec.ts.
