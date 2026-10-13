# Task 7 report — RealtimeGateway + ConfigurableIoAdapter + wiring

Commit: `b6cd3b5` on `feat/realtime-read-handshake`
Status: DONE (одно вынужденное отклонение за пределами перечня файлов брифа — см. ниже)

## Step 1 — зависимости

- `pnpm --filter @mymozhem/core add socket.io@^4.8.1 @nestjs/websockets@^11.0.0 @nestjs/platform-socket.io@^11.0.0` → +23 пакета; resolved socket.io@4.8.3.
- `pnpm install` в корне (один lockfile) → OK.
- Проверка `node -e "require('socket.io/package.json')" ` из core → OK.
- SDK dist актуален (REALTIME_MESSAGES/subscribeRequestSchema/resolveTypeOwner экспортируются) — ребилд не понадобился.

## Step 2 — failing unit test

Создан `packages/core/src/realtime/realtime.gateway.spec.ts`: бриф verbatim (13 тестов по тексту брифа; фактически 14 `it` — в брифе опечатка в ожидаемом счётчике) плюс ОДИН добавленный тест по санкционированному пункту 1 (см. «Отклонения»). Итого 15 тестов.

## Step 3 — red

`pnpm --filter @mymozhem/core test realtime.gateway` → FAIL как ожидалось: `TS2307: Cannot find module './realtime.gateway'`. Сьют заматчился (1 suite), >0 matched на red — подтверждено.

## Step 4 — gateway

Создан `packages/core/src/realtime/realtime.gateway.ts` по брифу verbatim с двумя санкционированными изменениями (см. «Отклонения»). Параметр `config`/`@Inject(APP_CONFIG)` оставлен — lint не ругнулся (примечание брифа о possibly-unused не активировалось: parameter properties не флагаются текущим eslint-конфигом).

## Step 5 — IoAdapter

Создан `packages/core/src/realtime/io-adapter.ts` verbatim. Сужение типов override (`options?: Record<string, unknown>`, возврат `unknown`) компилятор принял — выравнивание сигнатуры не понадобилось.

## Step 6 — wiring

- `realtime.module.ts` переписан целиком по брифу (imports Config/AppRegistry/Prisma/Auth/Membership; EventEmitLimiter, RECONNECT_RATE_LIMITER-фабрика на `JoinRateLimiter(config.RECONNECT_RATE_LIMIT_PER_MIN)`, RealtimeBus, EventOutbox, EventLogService, ProjectionService, SubscriptionRegistry, RealtimeGateway).
- `index.ts` — 6 новых export-строк после `event-outbox` (projection.service, subscription-registry, realtime.tokens, error-mapping, io-adapter, realtime.gateway).
- `apps/server/src/main.ts` — импорт `ConfigurableIoAdapter` из `@mymozhem/core` + `app.useWebSocketAdapter(new ConfigurableIoAdapter(config))` до `app.listen`.
- RealtimeModule уже импортирован в `apps/server/src/app.module.ts` и `room.module.ts` — дополнительной сборки графа не потребовалось.

## Step 7 — green + гейты

- `pnpm --filter @mymozhem/core test realtime.gateway` → **15/15 PASS** (13 бриф + 1 фактически посчитанный брифом неверно + 1 санкционированный).
- `pnpm build` → 3/3 successful.
- `pnpm --filter @mymozhem/core test` (полный юнит-прогон) → **14 suites, 160/160 PASS**.
- `pnpm lint` → 3/3 successful. `pnpm typecheck` → 5/5 successful.
- `pnpm boundary-check` → сначала FAIL (см. отклонение 3), после правки → green (364 modules). `pnpm guardrails` → все зонды живы. Негативный зонд (временный `__boundary-probe.ts` с `import 'socket.io'` в core/src вне realtime) подтвердил, что правило по-прежнему срабатывает; зонд удалён, повторный прогон green.

## Step 8 — commit

`b6cd3b5` — сообщение ровно как в брифе + трейлер `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. В коммит дополнительно включён `.dependency-cruiser.cjs` (отклонение 3) — без него ветка красила бы CI.

## Отклонения

1. **Санкционированное (леджер Task 5 → Task 7, решение владельца) — изоляция fanOut.** `fanOut` в gateway отличается от verbatim брифа: тело цикла обёрнуто в try/catch; падающая проекция/эмит логируется через `this.logger.error` (с типом, roomId, seq события) и пропускается, исключение никогда не перебрасывается — иначе синхронная пропагация через `RealtimeBus.publish` отклонила бы `outbox.run` ПОСЛЕ успешного коммита. Добавлен тест `fanOut isolates per-event delivery…`: spy на `ProjectionService.prototype.projectEvent` бросает на первом из трёх событий; утверждается, что остальные два доставлены (`room:` и `room:…:organizer`), `logger.error` вызван ровно один раз, исключение наружу не вышло.

2. **Санкционированное (леджер Task 6) — комментарий контракта у `registry.add`.** В `handleSubscribe` перед `this.registry.add(...)` добавлен комментарий: тот же socketId перезаписывает только ту же (identityId, roomId) пару — re-add той же подписки идемпотентен, cross-room отклонён выше (REQUEST_INVALID), поэтому не-идемпотентность `SubscriptionRegistry.add` при смене членства недостижима на этом пути.

3. **НЕ из брифа — правка `.dependency-cruiser.cjs` (вынужденная, CI-gate).** Правило `socketio-only-in-realtime` имело `from.pathNot: '^packages/core/src/realtime'`, но CI (`ci.yml`: `pnpm run build` → `pnpm run boundary-check`) круизит дерево ПОСЛЕ сборки, и depcruise сканирует `packages/core/dist/**`: скомпилированный `realtime.gateway.d.ts` легально ссылается на типы socket.io и ловился правилом (1 error). Правка минимальная и локальная для правила: `pathNot: ['^packages/core/src/realtime', '[/\\\\]dist[/\\\\]']` — dist-эхо исключено только из этого правила, покрытие всех src (core вне realtime, apps, прочие пакеты) сохранено. Проверено: чистое дерево green, зонд-нарушитель в src по-прежнему красный, guardrails-зонды живы. Альтернатива (глобальный `exclude` dist) отвергнута как более широкая по blast radius. **Файл вне перечня брифа — зафиксировано здесь для ревью.**

## Замечания к следующим задачам

- Ожидание брифа «PASS (13 тестов)» — опечатка: в verbatim-спеке 14 `it`; с санкционированным тестом — 15.
- `revokeRoomAccess` вызывающего по-прежнему не имеет (шов design §9) — Task 8 e2e это не блокирует.
- `.dependency-cruiser.cjs` теперь отличается от версии на main — при мерже ветки конфликтов быть не должно (файл не трогали с момента ветвления), но Task 9 стоит это учитывать.
