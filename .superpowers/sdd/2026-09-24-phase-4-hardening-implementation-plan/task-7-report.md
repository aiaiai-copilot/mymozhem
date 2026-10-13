# Task 7 report — LOG_LEVEL + PinoLoggerModule

**Commit:** `690ba56fd94bedb05822e9ec04cd05b2c8dda7d5` — `feat(core): LOG_LEVEL config + PinoLoggerModule (nestjs-pino, requestId, redact) — REQ-OPS-004`

**Закрывает:** REQ-OPS-004 (логи — инфраструктура), REQ-OPS-003 (LOG_LEVEL в единой схеме).

## Что сделано

1. **Step 0 — зависимости** (только через `pnpm add`, один lockfile):
   `pnpm --filter @mymozhem/core add nestjs-pino@^4.4.0 pino@^9.6.0 pino-http@^10.4.0`
   → установлено: nestjs-pino `^4.6.1`, pino `^9.14.0`, pino-http `^10.5.0` (+5 пакетов в lockfile).

2. **Step 1 — конфиг**:
   - `packages/core/src/config/config.schema.ts`: `LOG_LEVEL: z.enum(['fatal','error','warn','info','debug','trace','silent']).default('info')` вставлено сразу после `OAUTH_RATE_LIMIT` (было строка 75), комментарий REQ-OPS-004 — verbatim из брифа.
   - `packages/core/src/testing/test-config.ts`: `LOG_LEVEL: 'warn'` с комментарием из брифа.
   - Прогон существующей спеки: `pnpm --filter @mymozhem/core test -- config.schema.spec` → **26/26 PASS** (дефолт обратно-совместим, как и предсказывал бриф).

3. **Step 2 — RED**: создан `packages/core/src/observability/pino-options.spec.ts` (verbatim из брифа).
   Прогон до реализации:
   ```
   FAIL src/observability/pino-options.spec.ts
     ● Test suite failed to run
       error TS2307: Cannot find module './pino-logger.module' ...
   Test Suites: 1 failed, 1 total
   ```
   RED подтверждён — модуля нет.

4. **Step 3 — GREEN**: создан `packages/core/src/observability/pino-logger.module.ts`:
   - `PINO_STREAM` (const Symbol — REQ-CORE-004 не нарушается: нет мутабельного module-level состояния);
   - `buildPinoHttpOptions(config)` — чистая фабрика (level из конфига, genReqId → randomUUID + `x-request-id` в ответ, redact `req.headers.authorization`/`req.headers.cookie` с censor `'[redacted]'`);
   - `PinoLoggerModule = LoggerModule.forRootAsync({ imports: [ConfigModule], inject: [APP_CONFIG, { token: PINO_STREAM, optional: true }], useFactory })` — dynamic module const, определён один раз;
   - **C-pre.1 (обязательное добавление контроллера):** в конце файла `export { PinoLogger } from 'nestjs-pino';` с однострочным комментарием — потребители импортируют PinoLogger отсюда, не из nestjs-pino напрямую (boundary observability-libs-contained). Task 8 опирается на этот реэкспорт.

5. **Step 4 — GREEN-прогоны**:
   ```
   $ pnpm --filter @mymozhem/core test -- pino-options.spec
   PASS src/observability/pino-options.spec.ts
     buildPinoHttpOptions (REQ-OPS-004)
       ✓ уровень — из конфига
       ✓ redact маскирует authorization и cookie (Review Focus 5)
       ✓ genReqId генерирует uuid и отражает его в заголовок x-request-id
   Tests: 3 passed, 3 total
   ```
   (фильтр `pino-options.spec` матчит ровно 1 сьют / 3 теста — >0, ок)
   ```
   $ pnpm --filter @mymozhem/core typecheck   → clean (tsc --noEmit, 0 ошибок)
   $ pnpm --filter @mymozhem/core lint        → clean (eslint src, 0 ошибок)
   $ pnpm --filter @mymozhem/core test        → 20 сьютов, 238/238 PASS (регрессий нет)
   $ pnpm boundary-check                      → no dependency violations found (729 modules)
   ```

6. **Step 5 — commit**: staged ровно перечисленные брифом файлы + `pnpm-lock.yaml`; сообщение verbatim из брифа + строка Co-Authored-By.

## Deviations

1. **Тип параметра `stream` в `useFactory`** (предусмотренная брифом точка адаптации — изменена только сигнатура фабрики, не дизайн):
   бриф предполагал `(config: AppConfig, stream?: unknown)`. С установленными версиями (nestjs-pino 4.6.1 / pino-http 10.5.0 / pino 9.14.0) это не проходит typecheck: спред `{ ...opts, stream }` ветки с `unknown` даёт `stream: {} | null`, не assignable в `pino.DestinationStream | undefined` (`Params.pinoHttp`). Точечная замена: `stream?: DestinationStream` (type-import из `pino`). Поведение и контракт не изменились.
   - Проверено по исходникам `@nestjs/core` 11 (injector.js, `getFactoryProviderDependencies` + `resolveParam`): missing optional factory-зависимость резолвится в **`undefined`** (`return undefined` при `isOptional`), поэтому гард `stream === undefined` корректен в рантайме.
   - Форма `inject: [{ token: PINO_STREAM, optional: true }]` поддерживается установленной версией nestjs-pino (`inject` пробрасывается в провайдер как есть) — отклонений не потребовалось.
   - Опция `stream` в `pinoHttp` опциях существует в pino-http 10.5.0 (`Options.stream?: pino.DestinationStream`) — подтверждено по типам пакета.

2. **Версии** резолвнулись новее запрошенных минимумов (`^4.6.1`, `^9.14.0`, `^10.5.0`) — в пределах диапазонов брифа, lockfile единый.

## Self-review notes

- Спека шага 2 assert'ит `opts.redact.paths` — фабрика возвращает именно эту форму (`redact: { paths, censor }`); все 3 теста зелёные.
- Dynamic module — единственный `const PinoLoggerModule`, импортируется только по ссылке; nestjs-pino LoggerModule @Global — PinoLogger резолвится в любом модуле дерева (комментарий в коде).
- `PINO_STREAM` — `const Symbol`, мутабельного module-level состояния нет (REQ-CORE-004).
- Re-export `PinoLogger` не нарушает boundary: rule observability-libs-contained разрешает импорт nestjs-pino/pino/pino-http только внутри observability-каталога; `pnpm boundary-check` зелёный (729 modules, 0 violations).
- ObservabilityModule/Task 8 потребители сознательно НЕ трогались — не мой объём (composition root — задача 9).
- Интеграционные тесты (`test:int`, testcontainers) не запускались — вне объёма задачи; юнит-сьют полный (238/238).

## Status

DONE
