# Task 13 — отчёт исполнителя (e2e квиз-начислений)

Дата: 2026-09-23. Ворктри: `.worktrees/rewards-lottery`, ветка `rewards-lottery`.
Scope диспатча: brief Steps 1–2 + коммит. Steps 3–5 (exit-аудит, финальное ревью, HANDOFF) — контроллеру.

## Статус: DONE_WITH_CONCERNS

Тест 1 (сходимость ledger↔табло) — написан, зелёный, стабилен (2 прогона), слит коммитом.
Тест 2 (гейт quiz@1-пина) — **BLOCKED по инструкции 9 диспатча**: скетч недостижим на проводе, импровизированную замену не делал. Точное наблюдаемое поведение — ниже.

## Что построено

`apps/server/test/quiz-points.e2e-spec.ts` (новый, 286 строк) — приёмка фазы 3, design §7 п.8 (первая половина):

- **Бутстрап** — копия хелперов `quiz.e2e-spec.ts` (QUIZ_SETTINGS, readRoomLog, activeQuizRoom, joinGuest/organizerSocket/subscribe/publish, waitEventWhere). `quiz.e2e-spec.ts` не тронут — остаётся приёмкой ф.2 на manifestVersion 2.
- **Composition root реальный** (`apps/server/src/app.module.ts`): quiz@2 + lottery, RewardsModule @Global. Без override'ов APP_MANIFESTS/APP_RUNTIME_MODULES (прецедент lottery.e2e).
- **TRUNCATE** (решение E-pre.1): `rewards."Award", rewards."Prize", rewards."PointsGrant", identity."Session", membership."Membership", room."Room" CASCADE`.

### Тест 1 — «после reveal ledger-записи появляются и сходятся с табло; повторный закрытый раунд не дублирует начисления»

Сценарий по скетчу дословно:
- Комната квиза (QUIZ_SETTINGS: 2 вопроса, scoring `{ base: 1000, step: 100 }`, передан явно — обход C-9.1), два гостя (`'Гость P1'`, `'Гость P2'` — под PII-ассерт), организатор; все подписаны.
- Раунд 0: оба отвечают верно, P2 первым (порядок зафиксирован await'ом ack до publish следующего ответа): P2=1000, P1=900. Раунд 1: только P1=1000. `question.closed` на каждый раунд от организатора; waiter'ы на `quiz.question.revealed` навешены ДО publish closed (fan-out синхронен с коммитом).
- Ассерты:
  - live-payload'ы revealed: `awarded` = `[{P2,1000},{P1,900}]` и `[{P1,1000}]` (фиксация сценария).
  - `db.prisma.pointsGrant.findMany({ where: { roomId } })` — ровно 3 строки, у всех `reason === 'quiz.round'` и `sourceAppId === 'quiz'` (REQ-RWD-002b: начисление без приза).
  - **Сходимость** (design §5): суммы грантов по `identityId` ≡ суммы `awarded` по `actorId` из `quiz.question.revealed` в сыром логе (`readRoomLog`); P1=1900, P2=1000.
  - **Идемпотентность**: повторный `question.closed {questionIndex: 1}` → ack `{ code: 'ROUND_NOT_OPEN' }` (quiz-handlers.ts:101), грантов по-прежнему 3.
  - **PII (REQ-SEC-009)**: ни один payload лога не содержит `'Гость'` (проверка сериализацией каждой строки лога).

## Отклонения от скетча и почему

1. **Тест 2 (quiz@1-пин → MODULE_UNAVAILABLE) не вошёл в коммит — BLOCKED.**
   Написал его дословно по скетчу и прогнал для фиксации поведения. Наблюдаемое:
   ```
   AppManifestUnknownError: No manifest registered for quiz@1
     at AppRegistryService.validateSettings (packages/core/src/app-registry/app-registry.service.ts:44)
     at RoomService.configure (packages/core/src/room/room.service.ts:120)
   ```
   Т.е. **`configure` сам отклоняет пин quiz@1** с кодом `APP_MANIFEST_UNKNOWN` — скетч недостижим: до publish на проводе дело не доходит. Более того, даже при прямом сидировании строки комнаты через Prisma (минуя configure) пин не активировать: `transition` на DRAFT→ACTIVE повторно валидирует настройки против boot-time реестра (REQ-CORE-007, room.service.ts:183–187) и бросит тот же `AppManifestUnknownError`. Состояние «ACTIVE-комната запиннена на версию без манифеста в реестре» в текущем composition root достижимо только после редеплоя (реестр boot-time, строка durable) — в одном тестовом прогоне сервисным путём не воспроизводится. Это не баг продукта: fail-closed на configure/activate — задокументированное поведение (REQ-CORE-007, комментарий в app-registry.errors.ts:24–25 «boot-time registry vs durable room row»).
   По инструкции 9 диспатча импровизированную замену ассерта (raw-UPDATE пина и т.п.) НЕ делал. Решение — за контроллером/владельцем. Варианты:
   - признать покрытие гейта на int-уровне достаточным: `packages/core/src/app-runtime/app-runtime.int-spec.ts` кейс 4 «пин на версию без рантайм-модуля → MODULE_UNAVAILABLE (fail-closed)» (test-app@2: манифест в реестре есть, модуля нет) — тот же код пути, что проверял скетч;
   - либо поправить строку exit-аудита §7 п.8 («quiz-points.e2e (оба кейса)» → один кейс + int-покрытие v1-гейта).
2. **Мелочи:** `orderBy: { createdAt: 'asc' }` из скетча сохранён, хотя для ассертов порядок безразличен (агрегация в Map; `createdAt` = `now()` — у грантов одной транзакции reveal одинаковый). PII-литерал — `'Гость'` в displayName обоих гостей (скетч ожидал именно эту подстроку).

## Команды и выводы

```bash
pnpm build                                          # 5/5 successful (worktree root)
pnpm --filter @mymozhem/server test -- quiz-points.e2e
# прогон 1 (с обоими тестами): 1 passed, 1 failed (AppManifestUnknownError — фиксация BLOCKED)
# прогон 1 (финальный файл):  Tests: 1 passed, 1 total  (PASS 6.2s)
# прогон 2 (flake-check):     Tests: 1 passed, 1 total  (PASS 4.5s)
pnpm --filter @mymozhem/server test                 # полный e2e apps/server
# Test Suites: 7 passed, 7 total; Tests: 66 passed, 66 total (21.9s)
npx eslint apps/server/test/quiz-points.e2e-spec.ts # чисто
```

Полный конвейер (lint/boundary/guardrails/test:int) не гонял — это Step 3 контроллера.

## Коммиты

- `5296ea2` — `test(server): e2e квиз-начислений — сходимость ledger↔табло, идемпотентность, PII` (1 файл, +286).

## Concerns

1. **Критерий выхода §7 п.8 покрыт наполовину на e2e-уровне**: «ledger сходится с табло» — quiz-points.e2e; «v1-гейт» — только int (app-runtime.int-spec кейс 4) + fail-closed на configure/activate (APP_MANIFEST_UNKNOWN, проверено эмпирически в этом таске, но не зафиксировано тестом). Контроллеру — решить при exit-аудите (см. варианты выше). Строку таблицы «quiz-points.e2e (оба кейса)» в brief'е придётся скорректировать.
2. Замеченное попутно (не блокер, не трогал): продуктового кода не касался; багов не обнаружено — тест 1 прошёл с первого прогона.

---

## Fix note — ruling E-13.1 (2026-09-23, после вердикта контроллера)

Контроллер принял evidence по тесту 2 как **дефект плана, не баг продукта**, и вынес ruling E-13.1: заменить недостижимый скетч (publish → MODULE_UNAVAILABLE) на фиксацию фактического fail-closed поведения.

**Что изменено:** в `apps/server/test/quiz-points.e2e-spec.ts` добавлен тест 2 «configure с пином quiz@1 отклоняется APP_MANIFEST_UNKNOWN: v1 не конфигурируется там, где зарегистрирован только quiz@2» — свежая комната, `roomService.configure(... manifestVersion: 1, settings: QUIZ_SETTINGS)` отклоняется с `code === 'APP_MANIFEST_UNKNOWN'` (ассерт структурный, как в int-спеках: `AppManifestUnknownError` не экспортирован из barrel ядра). Комментарий в тесте фиксирует: скетч плана недостижим (configure/activate fail-closed, REQ-CORE-007), MODULE_UNAVAILABLE на publish покрыт app-runtime.int-spec кейсом 4 (ruling E-13.1).

**Команды и выводы:**

```bash
pnpm build                                          # 5/5 successful
pnpm --filter @mymozhem/server test -- quiz-points.e2e
# прогон 1: Tests: 2 passed, 2 total (PASS 7.7s)
# прогон 2 (flake-check): Tests: 2 passed, 2 total (PASS 5.5s)
npx eslint apps/server/test/quiz-points.e2e-spec.ts # чисто
```

**Коммит:** прежний `5296ea2` амендирован (история чистая, один логический юнит) → **`37b13ac`** — `test(server): e2e квиз-начислений — сходимость ledger↔табло, гейт quiz@1-пина` (1 файл, +304).

**Итоговый статус:** DONE — оба кейса критерия §7 п.8 зафиксированы на e2e-уровне в форме ruling E-13.1; «v1-гейт» покрыт связкой quiz-points.e2e тест 2 (fail-closed на configure) + app-runtime.int-spec кейс 4 (MODULE_UNAVAILABLE на publish).
