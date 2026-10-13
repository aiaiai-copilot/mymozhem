# Task 9 report: Composition root + e2e-приёмка наблюдаемости

**Commit:** `82ea28b` — `feat(server): wire observability — /metrics, pino system logger, e2e acceptance (REQ-OPS-004)`
**Status:** DONE — все гейты зелёные.

Закрывает REQ-OPS-004 (e2e-приёмка), REQ-OPS-003 (boot). Review Focus 5 покрыт ассертами секретов в pino-stream тесте.

## Что сделано

1. `apps/server/package.json` — dep `nestjs-pino` (pnpm add → разрешилось в `^4.6.1`, та же версия, что у core — дедупликация).
2. `packages/core/src/observability/observability.module.ts` — в `imports` добавлены `RequestIdModule` и `PinoLoggerModule` (первыми; порядок значим, см. отклонение 2).
3. `apps/server/src/app.module.ts` — `ObservabilityModule` сразу после `HealthModule`.
4. `apps/server/src/main.ts` — `import { Logger } from 'nestjs-pino'` + `app.useLogger(app.get(Logger))` сразу после `NestFactory.create` (комментарий verbatim из brief).
5. `packages/core/src/observability/observability.int-spec.ts` — PINO_STREAM-буфер + pino-stream сценарий (requestId в строке лога == x-request-id ответа; SECRET-TOKEN/SECRET-COOKIE отсутствуют).
6. `apps/server/test/transport.e2e-spec.ts` — тест `ответ несёт x-request-id (REQ-OPS-004)` в describe `default limits`.
7. `apps/server/test/realtime.e2e-spec.ts` — тест `/metrics отражает realtime-жизнь комнаты: gauge, replay, publish→deliver (REQ-OPS-004)`.
8. `packages/core/src/observability/pino-logger.module.ts` — новый `RequestIdModule`/`requestIdMiddleware` (отклонение 2 — исправление реального интеграционного бага).
9. `packages/core/src/transport/http-exception.filter.ts` — requestId теперь `req.raw?.id ?? req.id` (отклонение 4).
10. Оба e2e-файла — `fakeLogger` в ручные конструкции `MembershipService` (отклонение 5 — ремонт долга Task 8).

## RED/GREEN evidence

### RED 1 — pino-stream (int), до wiring PinoLoggerModule
`pnpm --filter @mymozhem/core test:int -- observability.int-spec`:
```
✕ строка лога запроса — JSON с requestId; authorization/cookie замаскированы (Review Focus 5)
  expect(line).toBeDefined() — Received: undefined
Tests: 1 failed, 2 passed
```

### Промежуточная диагностика (после wiring PinoLoggerModule тест всё ещё падал)
- Прогон с выводом stdout: `npx jest -c jest.integration.config.js observability.int-spec | grep -c '"req"'` → 4 строки уходили в stdout, не в буфер → PINO_STREAM из корневых `providers` TestingModule не виден фабрике динамического @Global LoggerModule → отклонение 1.
- После @Global-модуля: `parsed.req.id` был `"req-3"`, заголовок `x-request-id` — undefined. Пробник (onRequest hook на голом fastify-инстансе) показал: `PROBE onRequest raw req.id = req-1` — raw id присвоен ДО любого middleware. Источник найден: `@nestjs/platform-fastify/adapters/middie/fastify-middie.js:208` — `raw.id = req.id` перед запуском middleware-цепочки; pino-http делает `req.id = req.id || genReqId(...)` → `genReqId` мёртв под Nest-Fastify → отклонение 2.

### RED 2 — unit requestIdMiddleware
`npx jest pino-options` → TS2339 `Property 'customProps' does not exist` (первая итерация с customProps), затем GREEN на `requestIdMiddleware` (4 passed).

### GREEN 1 — int
После `RequestIdModule` первым в imports: `pnpm --filter @mymozhem/core test:int -- observability.int-spec` → 3 passed (включая pino-stream: req.id в строке лога — uuid, равен заголовку; секреты замаскированы `[redacted]`).

### RED 3 — transport e2e x-request-id (AppModule ещё без ObservabilityModule)
`pnpm --filter @mymozhem/server test -- transport.e2e`:
```
✕ ответ несёт x-request-id (REQ-OPS-004) — Received has value: undefined
Tests: 1 failed, 20 passed
```

### RED 4 — realtime e2e /metrics (AppModule ещё без ObservabilityModule)
`pnpm --filter @mymozhem/server test -- realtime.e2e -t "metrics отражает"` (примечание: `-t` у jest в этом проекте не фильтровал — прогналась вся суита):
```
✕ /metrics отражает realtime-жизнь комнаты — Received string: "{\"code\":\"REQUEST_INVALID\"}" (404 на /metrics)
Tests: 1 failed, 10 passed
```

### GREEN 2/3 — после wiring AppModule + main.ts + `pnpm build`
- `pnpm --filter @mymozhem/server test -- transport.e2e` → **21 passed**.
- `pnpm --filter @mymozhem/server test -- realtime.e2e` → **11 passed** (включая metrics-тест).

### RED/GREEN 4 — HttpExceptionFilter requestId
- RED: `npx jest http-exception.filter` после перевода мока host на форму Nest-Fastify (`{ id: 'req-platform', raw: { id: 'req-1' } }`) → 3 failed (логировался `req-platform`).
- GREEN после `req.raw?.id ?? req.id` → 38 passed.

## Как гонялся ассерт publish→deliver

Хелперы файла: `activeRoomWithGuest()` (HTTP join → accessToken), `connect(port, token)`, `emitAck`, `waitEvent`. Поток: subscribe-ack (gauge add + replay observe оба ДО ack) → `/metrics`: gauge-серия `mymozhem_active_connections{roomId="..."} 1` + приращение `mymozhem_replay_duration_seconds_count{level="public"}` на +1 → `waitEvent(EVENT)` подписка ДО publish → publish `test-app.note.posted` (clientInitiated, public) → ack ok → await события на сокете (observe в `fanOut` идёт синхронно сразу после emit — доставка на клиенте является маркером, что замер уже сделан) → приращение `mymozhem_publish_to_deliver_seconds_count{visibility="public"}` на +1 → `socket.close()` → ручной poll-цикл по `/metrics` (шаг 50 мс, дедлайн 2 с, jest — не expect.poll) до исчезновения gauge-серии комнаты (серия убирается на нуле — `activeConnections.remove`).

Гистограммные счётчики накопительные, а app один на файл (другие тесты публикуют и подписываются) — поэтому ассерты по ПРИРАЩЕНИЮ рядов, а не по абсолютному `1` из brief; gauge per-room с абсолютным ` 1` (комната свежая).

## Полные гейты (Step 6) — все зелёные

`pnpm build` ✓ · `pnpm run boundary-check` ✓ · `pnpm run guardrails` ✓ · `pnpm run lint` ✓ · `pnpm run typecheck` ✓ · `pnpm run test` ✓ (sdk 328, app-quiz 86, app-lottery 34, core 241 unit) · `pnpm --filter @mymozhem/core test:int` ✓ (23 suites, 215 tests) · `pnpm --filter @mymozhem/server test` ✓ (8 suites, 73 tests).

## Отклонения от brief

1. **PINO_STREAM — через @Global() тестовый модуль, не через `providers` корневого TestingModule.** Фабрика динамического @Global LoggerModule резолвит inject только из своего модуля/импортов/глобалов; корневые провайдеры TestingModule ей не видны (эмпирически: лог уходил в stdout, буфер пуст).
2. **Новый `RequestIdModule` (pre-middleware) вместо механизма genReqId.** Приёмочный тест вскрыл реальный интеграционный баг Task 7: Nest's fastify-middie присваивает `raw.id = req.id` ('req-N') ДО middleware, поэтому `genReqId` pino-http под Nest-Fastify никогда не вызывается — ни uuid, ни заголовка. Промежуточная попытка через `customProps` не сработала: pino сериализует bindings в момент `child()` (на входе middleware), мутация req.id позже уже не попадает в строку лога. Решение: pre-middleware присваивает uuid в req.id и отражает в `x-request-id` до pino-http. Порядок middleware: Nest сортирует по distance модуля, @Global первыми и между собой — в порядке регистрации; поэтому `RequestIdModule` — @Global и первый в `imports` ObservabilityModule (проверено по исходникам @nestjs/core scanner + middleware-module и эмпирически int/e2e прогонами). `genReqId` в опциях сохранён как запасной путь для платформ без предустановленного req.id (юнит-тест Task 7 не тронут).
3. **LOG_LEVEL в int-спеке поднят до `info`** (`{ ...TEST_CONFIG, LOG_LEVEL: 'info' }`): строка лога запроса пишется на уровне info, а TEST_CONFIG.LOG_LEVEL='warn' её подавлял бы; с PINO_STREAM-буфером шум в консоль не уходит.
4. **`HttpExceptionFilter`: requestId — `req.raw?.id ?? req.id`.** В e2e-логах вскрылась рассинхронизация (Task 8): фильтр читал wrapper `req.id` ('req-N'), а строка запроса — uuid. Спека фильтра переведена на форму Nest-Fastify (wrapper.id + raw.id), ассерт — uuid из raw.
5. **Ремонт долга Task 8 в e2e-файлах:** ручные конструкции `MembershipService` в transport/realtime e2e не получили 5-й аргумент `logger` — после rebuild core оба файла не компилировались ts-jest. Добавлен `fakeLogger` (уже экспортируется barrel'ем, тот же приём, что в int-спеках Task 8).
6. **Realtime metrics-тест: приращения вместо абсолютных `_count ... 1`** (см. выше) и ручной poll-цикл вместо `expect.poll` (brief сам оговаривает jest-форму).

## Self-review

- Review Focus 5: pino-stream тест ассертит отсутствие SECRET-TOKEN/SECRET-COOKIE в строке; redact покрывает authorization+cookie; тела не логируются нормой (pino-http autoLogging). ✓
- REQ-CORE-004: мутабельный module-level state — только `logLines` в спеке (тестовое состояние); прод-код без глобалов; guardrails гейт зелёный. ✓
- Один lockfile: зависимость добавлена только через `pnpm add`. ✓
- Boundary: `nestjs-pino` импортируется в main.ts (разрешённый импортёр) — boundary-check зелёный. ✓
- Тесты не ловят ложные совпадения: метки метрик (`roomId`/`level`/`visibility`/`code`) сверены с metrics.service.ts; `_count`-суффикс гистограмм учтён. ✓

## Concerns

1. **Порядок middleware опирается на недокументированную семантику Nest** (globals-first + stable sort по порядку регистрации). Детерминировано для фиксированного дерева и перекрыто двумя тестами (int pino-stream + e2e x-request-id), которые упадут при смене порядка — но при апгрейде Nest стоит перепроверить.
2. **Шум e2e-логов:** app в e2e бутится через `loadConfig(process.env)` с дефолтом LOG_LEVEL=info — каждая HTTP-операция пишет JSON-строку в stdout джеста. На зелёность не влияет; если станет мешать — кандидат на LOG_LEVEL=warn в e2e env (отдельным решением, не делал — brief запрещал менять boot e2e).
3. Долг Task 8 (п.5 отклонений) стоит учесть при ревизии процесса: сигнатурные изменения конструкторов core требуют прогона server e2e после rebuild в гейтах принимающей задачи.

---

# Fix round 1 — Critical 1: split nestjs-pino instances ломал bootstrap

**Commit:** `2df82ae` — `fix(server): single nestjs-pino/pino instance — main.ts bootstrap resolves Logger (REQ-OPS-004)`
**Status:** FIXED — все гейты зелёные, включая новый boot-smoke реального entrypoint.

## Root cause (restated)

`apps/server/package.json` получил `nestjs-pino@^4.6.1` без peer `pino`. pnpm разрешил apps/server ДРУГОЙ инстанс nestjs-pino (слинкованный с pino@10.3.1), тогда как core — с pino@9.14.0: два realpath, две разные класс-идентичности `Logger`. Nest ключит провайдеры по ссылке на класс; LoggerModule в дереве — из core-инстанса, поэтому `app.get(Logger)` в main.ts (server-инстанс) падал на bootstrap: `UnknownElementException: Nest could not find Logger element`. e2e `useLogger` не вызывают — гейты были зелёными при мёртвом entrypoint. Моя фраза в отчёте выше «та же версия, что у core — дедупликация» была фактически неверна: lockfile нёс два snapshot (проверено ревью и подтверждено realpath ниже).

## What changed

1. `pnpm --filter @mymozhem/server add pino@^9.14.0` — выравнивание peer с core (`pino@^9.14.0` там же): единый snapshot nestjs-pino на оба пакета.
2. `apps/server/test/bootstrap.e2e-spec.ts` (новый) — boot-smoke РЕАЛЬНОГО entrypoint: `node dist/main.js` процессом-потомком (testcontainer Postgres, свободный порт, JWT_SECRET из TEST_CONFIG), poll `/health/live` до 200 + ассерт uuid `x-request-id`. Путь `app.get(Logger)`/`useLogger` исполняется внутри настоящего bootstrap; импорта nestjs-pino в спеке нет — boundary `observability-libs-contained` (разрешён только main.ts/core) не нарушается.

## Evidence: one instance (realpath + lockfile)

До фикса:
```
apps/server/node_modules/nestjs-pino -> .pnpm/...pino-http@10.5.0_pino@10.3.1.../nestjs-pino
packages/core/node_modules/nestjs-pino -> .pnpm/...pino-http@10.5.0_pino@9.14.0.../nestjs-pino
```
После фикса — ОДИН realpath на оба пакета:
```
.../nestjs-pino@4.6.1_..._pino-http@10.5.0_pino@9.14.0_.../node_modules/nestjs-pino  (оба)
```
Lockfile: ровно один snapshot `nestjs-pino@4.6.1(...)(pino-http@10.5.0)(pino@9.14.0)(rxjs@7.8.2)` (строка 6590) + запись пакета (2816); `pino@10.3.1` — 0 вхождений; `pnpm install --frozen-lockfile` → чисто (INSTALL_CLEAN).

## Boot-path check: RED → GREEN

RED (до pino-фикса): `pnpm --filter @mymozhem/server test -- bootstrap.e2e`:
```
ERROR [ExceptionHandler] UnknownElementException: Nest could not find Logger element
  at NestApplication.get (...) at bootstrap (dist/main.js:24:23)
✕ entrypoint exited early (code 1) — bootstrap broken.
Tests: 1 failed
```
GREEN (после): `pnpm --filter @mymozhem/server test -- bootstrap.e2e`:
```
✓ dist/main.js поднимается: /health/live 200 + x-request-id uuid (app.get(Logger) резолвится, REQ-OPS-004) (773 ms)
Tests: 1 passed
```

## Gates (полный набор, после фикса)

`pnpm install --frozen-lockfile` ✓ · `pnpm build` ✓ · `boundary-check` ✓ · `guardrails` ✓ · `lint` ✓ · `typecheck` ✓ · unit `pnpm run test` ✓ (sdk 328, app-quiz 86, app-lottery 34, core 241) · core `test:int` ✓ (23 suites/215) · server `test` ✓ (9 suites/74 — включая bootstrap smoke).

## Note

Воркфлоу-урок: добавление runtime-dep в apps/server требует smoke уровня «собранный entrypoint», а не только DI-дерева TestingModule — peer-split по class identity виден только при реальном bootstrap. Boot-smoke теперь в постоянном наборе гейтов и закрывает этот класс дефектов.

---

# Fix wave (batch-C final review) — C-1 + I-1: утечки секретов в логи запросов

**Commit:** `a64a425` — `fix(core): redact set-cookie response header and strip query from request logs (REQ-OPS-004, REQ-SEC-009)`
**Status:** FIXED — все гейты зелёные.

## Findings → fixes (оба в `buildPinoHttpOptions`, pino-logger.module.ts)

- **C-1 (Critical):** std-сериализатор res печатает response headers → `set-cookie` (refresh-токен, OAuth state/PKCE) попадал бы в каждую строку «request completed» на join/refresh/OAuth-эндпоинтах. Fix: `'res.headers["set-cookie"]'` добавлен в `redact.paths` (рядом с authorization/cookie запроса).
- **I-1 (Important):** std-сериализатор req несёт `url` с querystring и поле `query` → OAuth callback `?code=…&state=…` сливался бы в лог. Fix: кастомный `serializers.req` — обёртка над `stdSerializers.req` (реэкспорт из `pino`, прямой dep core; новых зависимостей нет), удаляет поле `query` и срезает querystring из url; id/method/headers/remoteAddress/params сохранены, redact заголовков работает поверх сериализованного объекта.

## RED/GREEN evidence

RED: `cd packages/core && npx jest pino-options` после записи пинов до реализации:
- сначала TS2339 `Property 'serializers' does not exist` (suites не компилируется — оба пина красные);
- после реализации — один промежуточный фейл моего же теста (`line` пустая): `logger.info` подавлялся уровнем `warn` из TEST_CONFIG → тест переведён на `{ ...TEST_CONFIG, LOG_LEVEL: 'info' }` (тестовый баг, не реализации).

GREEN: `npx jest pino-options` → 5 passed, включая сквозной пин: реальный `pino({ serializers, redact }, sinkStream)` с фейковыми req/res — строка НЕ содержит SECRET-CODE/SECRET-STATE/SECRET-TOKEN/SECRET-COOKIE/SECRET-REFRESH, содержит `[redacted]`, `parsed.req.url === '/auth/google/callback'`, поля `query` нет.

## Boundary-check для нового импорта

`import { stdSerializers } from 'pino'` внутри `packages/core/src/observability` — правило `observability-libs-contained` исключает весь observability из `from` (плюс `pino` — объявленный dep core, не транзитив). Эмпирически: `pnpm run boundary-check` → зелёный.

## Gates

- `pnpm --filter @mymozhem/core test:int -- observability.int-spec` ✓ (pino-stream сценарий не затронут: req.id в строке == заголовку, секреты замаскированы)
- `pnpm --filter @mymozhem/core test` ✓ (20 suites/241)
- `pnpm run typecheck` ✓ · `pnpm run lint` ✓ · `pnpm run boundary-check` ✓
- `pnpm build` ✓ · `pnpm --filter @mymozhem/server test` ✓ (9 suites/74 — assertion surface e2e не менялся, подтверждено прогоном)
