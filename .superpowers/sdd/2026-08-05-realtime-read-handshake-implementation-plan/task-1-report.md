# Task 1 report: конфиг RECONNECT_RATE_LIMIT_PER_MIN

**Status:** DONE
**Commit:** 79574493ebdb94a898a2791c919deb38796950c3
**Branch:** feat/realtime-read-handshake

## Что сделано по шагам

### Step 1 — failing test
Добавил в конец `describe('loadConfig')` в `packages/core/src/config/config.schema.spec.ts` два теста verbatim из брифа:
- `applies §4 default for reconnect ceiling (REQ-RT-015)` — дефолт 10
- `coerces RECONNECT_RATE_LIMIT_PER_MIN from string and rejects 0` — коэрсия '5'→5, отказ 0

### Step 2 — проверка падения
Команда: `pnpm --filter @mymozhem/core test config.schema`
Результат: FAIL, exit 1. Нюанс (см. «Отклонения»): ts-jest делает type-check, поэтому сьют упал на компиляции с TS2551 (`Property 'RECONNECT_RATE_LIMIT_PER_MIN' does not exist...`) по обоим новым тестам (строки 119 и 126), а не с «2 failed tests». Сьют матчнулся (1 suite), падение вызвано именно отсутствующим свойством — легитимный red.

### Step 3 — реализация
- `packages/core/src/config/config.schema.ts` — после `EVENT_EMIT_RATE_LIMIT_PER_MIN` (~line 26) добавил поле с комментарием verbatim из брифа:
  `RECONNECT_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(10),`
- `packages/core/src/testing/test-config.ts` — после `MAX_EVENT_PAYLOAD_BYTES` добавил `RECONNECT_RATE_LIMIT_PER_MIN: 10,`

### Step 4 — проверка прохождения
Команда: `pnpm --filter @mymozhem/core test config.schema`
Результат: PASS — `Tests: 20 passed, 20 total`, `Test Suites: 1 passed`. Было 18 тестов, стало 20 (16+ по брифу — выполнено). Оба новых теста в выводе как passed.

### Step 5 — коммит
Сообщение ровно как в брифе + трейлер `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (требование оркестратора).
`3 files changed, 24 insertions(+)` — только три файла из брифа.

## Отклонения от брифа
1. **Форма red-фейла (Step 2):** бриф ожидал «2 failed tests», фактически — TS2551 на этапе компиляции ts-jest, т.к. `AppConfig` выводится из zod-схемы и отсутствующее поле — ошибка типа. Это тот же red-сигнал (тест не может пройти без поля), просто на стадии компиляции, не рантайма. Приемлемо для TDD; «0 tests, exit 0» ловушки нет (exit 1).
2. **Трейлер в коммите:** бриф даёт однострочное сообщение; добавлен обязательный `Co-Authored-By` трейлер по правилам репозитория/оркестратора.

## Произведённый интерфейс
`AppConfig.RECONNECT_RATE_LIMIT_PER_MIN: number` — доступен для Task 6 (фабрика лимитера) и Task 8 (env-override в e2e). `TEST_CONFIG` обновлён, int-specs не сломаны.

Миграции не тронуты (в задаче их нет).
