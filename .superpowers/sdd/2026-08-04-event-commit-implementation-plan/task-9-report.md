# Task 9 report: Финальные гейты + spec coverage сверка

**Branch:** `phase-1-event-commit`
**Дата:** 2026-08-04
**Результат:** DONE — все гейты зелёные, правок не потребовалось, коммит не создавался (Step 3 неприменим: нет gate failures → нет пустого коммита).

---

## Step 1: Full gates

Все семь гейтов прогнаны последовательно, все зелёные:

| Gate | Результат | Цифры |
|---|---|---|
| `pnpm build` | ✅ | 3/3 packages (`@mymozhem/sdk`, `@mymozhem/core`, `@mymozhem/server`), 1.7s |
| `pnpm lint` | ✅ | 3/3 packages, eslint без ошибок |
| `pnpm typecheck` | ✅ | 5/5 tasks (3 typecheck + 2 зависимых build), `tsc --noEmit` чисто |
| `pnpm test` (unit) | ✅ | sdk: 16 suites / 198 tests; core: 10 suites / 117 tests; server: 2 suites / 15 tests — **330 passed, 0 failed** |
| `pnpm test:int` | ✅ | core: 11 suites / **103 tests passed**, 0 failed (testcontainers, PostgreSQL, все 8 миграций применены), 71s |
| `pnpm boundary-check` | ✅ | depcruise: **no dependency violations found** (321 modules, 824 dependencies) |
| `pnpm guardrails` | ✅ | 3/3 guardrails живы: sdk→core import, module-level mutable export, apps→core src-internals — все срабатывают |

Ожидания брифа подтверждены: новые unit-тесты 4+3 (limiter ×4 в `event-emit-limiter.spec.ts`, registry read-path ×3 в `app-registry.service.spec.ts`) входят в core 117; новые ~14 int-тестов — ровно 14 `it()` в `event-commit.int-spec.ts`, входят в core 103.

## Step 2: Spec coverage сверка

| REQ / строка | Тест(ы) | Статус | Evidence |
|---|---|---|---|
| REQ-RT-016 (запечатывание) | `seals the log in a terminal status` | ✅ | `packages/core/src/realtime/event-commit.int-spec.ts:150` |
| REQ-RT-014 (per-actor хард) | limiter unit ×4 | ✅ | `packages/core/src/realtime/event-emit-limiter.spec.ts:4,12,21,29` |
| REQ-RT-014 (int) | `4th attempt…`, `failed attempts burn…` | ✅ | `event-commit.int-spec.ts:283`, `:303` |
| REQ-RT-012 (размер) | config spec | ✅ | `packages/core/src/config/config.schema.spec.ts:98` (`applies §4 defaults for event emission params`) |
| REQ-RT-012 (int) | `rejects oversized payload` | ✅ | `event-commit.int-spec.ts:166` |
| REQ-CTR-008 (реестр+схема) | registry spec ×3 | ✅ | `packages/core/src/app-registry/app-registry.service.spec.ts:77,86,97` (`getEventDefinition…`, `eventValidatorFor…`, `describeEventErrors…`) |
| REQ-CTR-008 (int) | `unknown event type`, `payload failing the registered schema` | ✅ | `event-commit.int-spec.ts:178`, `:188` |
| REQ-CTR-009 (потолок видимости) | `visibility weaker than the declared ceiling`, `visibility STRONGER` | ✅ | `event-commit.int-spec.ts:199`, `:211` |
| REQ-RT-007 (seq, payload-нейтральность) | `serializes concurrent app commits`, `payload-neutrality` | ✅ | `event-commit.int-spec.ts:366`, `:387` |
| REQ-RT-009 (actorId, service-уровень) | `records actorId on lifecycle events` | ✅ | `packages/core/src/realtime/event-log.int-spec.ts:98` |
| REQ-RT-009 (membership-гейт, Task 5) | `actor without membership`, `null actor` | ✅ | `event-commit.int-spec.ts:220`, `:230` |
| REQ-OPS-003 (конфиг fail-closed) | config spec ×2 | ✅ | `config.schema.spec.ts:98` (defaults) + `:107` (`rejects out-of-range event emission params (REQ-RT-012/014, §4 bounds)`) |
| Отложенное lifecycle §10: actorId≠null | тот же тест | ✅ | `event-log.int-spec.ts:98` |
| Отложенное lifecycle §10: payload-нейтральность | `payload-neutrality` | ✅ | `event-commit.int-spec.ts:387` |
| Follow-up: шов-комментарий о порядке блокировок | комментарий в `event-log.service.ts` | ✅ | `packages/core/src/realtime/event-log.service.ts:26-29` (конвенция порядка блокировок: advisory lock, валидация до lock) и `:66-69` (порядок шагов commit-цепочки) — проверено чтением |
| Membership-гейт (решение владельца §0) | `actor without membership`, `null actor` | ✅ | `event-commit.int-spec.ts:220`, `:230` |

**Пробелов нет.** Все 12 строк таблицы coverage закрыты существующими и проходящими тестами (прохождение доказано зелёными прогонами `pnpm test` / `pnpm test:int` выше). Пропущенных задач плана не выявлено; швы §10 дизайна остаются осознанными швами (перечислены в брифе, подлежат фиксации в HANDOFF при завершении среза — не в скоупе этой задачи).

## Step 3: Commit

Не выполнялся — gate failures не было, правок не вносилось. Пустой коммит не создавался согласно инструкции.
