# Task 4 report: prom-client + MetricsModule (4 метрики REQ-OPS-004)

**Status:** DONE
**Commit:** `efdc606` — `feat(core): observability MetricsModule — 4 метрики REQ-OPS-004 (prom-client)`

## Что реализовано

Листовой модуль `core/observability` по брифу дословно:

- `packages/core/package.json` — dep `prom-client@^15.1.3` (Step 0, `pnpm --filter @mymozhem/core add prom-client@^15.1.3`; один lockfile, `pnpm-lock.yaml` в том же коммите).
- `packages/core/src/observability/metrics.service.ts` — `MetricsService`: собственный `Registry` (не default — изоляция тестов), 4 метрики REQ-OPS-004 / дизайн §3:
  - Histogram `mymozhem_publish_to_deliver_seconds{visibility}` (бакеты дизайна, клэмп `Math.max(0, seconds)` против skew часов БД/приложения);
  - Histogram `mymozhem_replay_duration_seconds{level}`;
  - Counter `mymozhem_event_commit_errors_total{code}`;
  - Gauge `mymozhem_active_connections{roomId}` со своим `Map<string, number>` счётчиком: `connectionRemoved` не уводит в минус, серия удаляется при нуле (stale-series гигиена, кардинальность = живым комнатам).
  - Плюс `readonly contentType` и `render(): Promise<string>`. Сервис беззависимостный — конструируется вручную в unit-спеках потребителей (Tasks 5/6).
- `packages/core/src/observability/metrics.module.ts` — `MetricsModule` (`providers`/`exports: [MetricsService]`), листовой (ничего доменного не импортирует — задел под boundary observability-is-leaf, Task 6).
- `packages/core/src/index.ts` — barrel-экспорты модуля и сервиса рядом с прочими module-экспортами.

## TDD Evidence

### RED

Команда: `pnpm --filter @mymozhem/core test -- metrics.service.spec`

```
FAIL src/observability/metrics.service.spec.ts
  ● Test suite failed to run
    src/observability/metrics.service.spec.ts:1:32 - error TS2307: Cannot find module './metrics.service' or its corresponding type declarations.
Test Suites: 1 failed, 1 total
Tests:       0 total
```

Ожидаемо: спека написана первой, `metrics.service.ts` ещё не существует — падение на импорте, не на логике.

### GREEN

Команда: `pnpm --filter @mymozhem/core test -- metrics.service.spec`

```
PASS src/observability/metrics.service.spec.ts
  MetricsService (REQ-OPS-004)
    ✓ экспонирует 4 метрики в Prometheus text format (1 ms)
    ✓ gauge: парные add/remove; серия комнаты исчезает при нуле (stale-series гигиена)
    ✓ publish→deliver зажимается в 0 при skew часов (recordedAt БД впереди Date.now())
Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
```

### Полные гейты (перед коммитом)

- `pnpm --filter @mymozhem/core test` → **19 suites, 231 tests passed**.
- `pnpm --filter @mymozhem/core typecheck` → чисто.
- `pnpm --filter @mymozhem/core lint` → чисто.

## Files changed

- `packages/core/package.json` (M) — +`prom-client: ^15.1.3`
- `pnpm-lock.yaml` (M) — резолв prom-client
- `packages/core/src/observability/metrics.service.ts` (A)
- `packages/core/src/observability/metrics.service.spec.ts` (A)
- `packages/core/src/observability/metrics.module.ts` (A)
- `packages/core/src/index.ts` (M) — +2 barrel-строки

## Self-review

Дифф прочитан целиком (`git show HEAD`):

- **Полнота:** все 5 файлов брифа; интерфейс `MetricsService` совпадает с контрактом «Produces» для Tasks 5/6 метод-в-метод (сигнатуры, имена метрик, label'ы, `contentType`, `render`). Код — verbatim из брифа.
- **YAGNI:** ничего сверх брифа — ни HTTP-эндпоинта `/metrics` (не в этой задаче), ни default-registry, ни лишних метрик. Модуль листовой, зависимостей на доменные модули нет.
- **Test hygiene:** каждый тест конструирует свой `MetricsService` со своим `Registry` — shared state между спеками отсутствует; тесты детерминированы (без таймеров, сети, БД).
- **REQ-CORE-004:** состояние — поля экземпляра (`registry`, `connectionCounts`), глобального мутабельного состояния процесса нет.
- **Стиль:** комментарии на русском, ссылки на REQ-OPS-004 / дизайн §3 — как в брифе и остальном core.

## Issues / concerns

- `pnpm add` выдал `[WARN] deprecated prom-client@15.1.3` — сама версия помечена deprecated в реестре. Бриф явно пинает `^15.1.3`, поэтому оставлено как указано; если владелец захочет 16.x — это отдельное решение (semver-major, вне брифа).
