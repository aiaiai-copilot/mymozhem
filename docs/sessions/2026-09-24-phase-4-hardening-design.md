# Дизайн: фаза 4 — харднинг-срез (pre-event observability + закрытие окна свипа)

**Дата:** 2026-09-24
**Статус:** утверждён владельцем по секциям (brainstorm, сессия 24)
**Вход:** разрез фазы 4 решением владельца (сессия 15), HANDOFF; нормативный пакет v1.2 (REQ-SEC-008, REQ-OPS-004, REQ-RT-008), амендмент v1.3/v1.4
**Закрывает:** REQ-OPS-004 (полный текст SHOULD), C-8.1 (окно гонки свипа, решение сессии 16 → перенесено в ф.4); фиксирует закрытие REQ-SEC-008

---

## 0. Решения владельца (эта сессия)

1. **REQ-RT-008 (архивация логов) — отложен.** Переносится вместе с нагрузочной частью ф.4 (после первого живого события). Обоснование: логи завершённых комнат при MVP-масштабе — килобайты; архивация до события не окупается, срез станет меньше.
2. **OPS-004 — полный текст REQ:** и структурные логи с корреляцией requestId/roomId/actorId, и `/metrics` с 4 метриками. Обоснование: первое живое событие измеряет нагрузочный профиль — метрики должны стоять до него.
3. **`/metrics` — открытый**, как `/health`. Числа без PII; MVP-деплой — одна машина в своём контуре. Bearer-токен / loopback-only отклонены как усложнение эксплуатации без выигрыша на этом масштабе.
4. **C-8.1 — подход «re-check + award-гарда»** (см. §4). «Только re-check» (оставляет benign-остаток) и «serializable + retry» (трогает горячий путь dispatch, SSI требует serializable с обеих сторон) отклонены.
5. **SEC-008 — без кода:** требование уже закрыто (`55afe8f`, `transport.e2e-spec.ts:235`); срез фиксирует это в сверке.

## 1. Объём среза

Четыре работы:

1. **OPS-004-логи** — структурные JSON-логи с корреляцией requestId / roomId / actorId (§2).
2. **OPS-004-метрики** — `GET /metrics` (открытый) с 4 метриками REQ-OPS-004 (§3).
3. **C-8.1** — закрытие окна гонки свипа (§4).
4. **SEC-008** — без кода; подтверждение артефактами в exit-аудите среза.

**Стек наблюдаемости:** `nestjs-pino` (JSON-логи, requestId из fastify `genReqId`; pino уже внутри fastify) + `prom-client` (стандарт экспозиции Prometheus text format). Hand-rolled JSON отклонён (свой формат + ручная типизация), OpenTelemetry — оверкилл для одной реплики MVP (YAGNI, REQ-OPS-005).

**Новый модуль `core/observability`** — MetricsService + конфигурация pino. Это модуль под реальные требования среза, не задел под отложенное (правило 3 CLAUDE.md).

## 2. OPS-004 — структурные логи и корреляция

- **HTTP:** `LoggerModule.forRoot` (nestjs-pino) в `AppModule`; requestId — fastify `genReqId` (uuid), автоматически в каждом логе запроса; ответ дополнительно несёт заголовок `x-request-id` (разбор инцидентов с игроками).
- **Корреляция roomId/actorId — без middleware-магии:** pino-логгеры инжектируются в сервисы; контекст привязывается там, где известен: `logger.child({ roomId, actorId })` в точках доменных операций (commit, dispatch, sweep, join, oauth). Автоматическая засорка всех логов — нет; только операционно значимые места.
- **Realtime:** Socket.io минует pino-http. Логи gateway (connect / subscribe / publish / disconnect) — через инжектированный pino с полями `{ socketId, actorId, roomId }`; actorId — только из claims аутентифицированного соединения (REQ-RT-009), не из payload.
- **Формат:** JSON (pino default). Уровень — `LOG_LEVEL` из конфига (дефолт `info`), в единой zod-схеме конфигурации (REQ-OPS-003). pino-pretty в prod-зависимости не тащим.
- **Миграция существующих `new Logger(...)`** (guest-sweep, identity-sweep module, membership, realtime gateway, http-exception filter) на pino-инжекцию — корреляция не должна жить в двух стеках.
- **Границы логирования (чего НЕ логируем):** payload'ы событий целиком (дух REQ-SEC-009 — логи не второе хранилище данных), токены, куки, тела запросов. Pino `redact` на заголовках `authorization`/`cookie` — явно, с тестом.

## 3. OPS-004 — метрики и /metrics

**`MetricsModule`** (global, по прецеденту rewards/anonymization wiring) с `MetricsService` — тонкая обёртка над `prom-client` `Registry`. Модуль не импортирует доменные модули; доменные инжектируют MetricsService.

**4 метрики (REQ-OPS-004):**

| Метрика | Тип | Точка измерения | Labels |
|---|---|---|---|
| `mymozhem_publish_to_deliver_seconds` | Histogram | `EventOutbox.run` фиксирует `committedAt` → gateway `fanOut` замеряет до отправки последнего кадра | `visibility` |
| `mymozhem_replay_duration_seconds` | Histogram | subscribe: чтение лога + сборка snapshot | `level` |
| `mymozhem_event_commit_errors_total` | Counter | catch в commit-пути (outbox/диспетчер); типизированные отказы гейтов НЕ считаем — только сбои фиксации | `code` |
| `mymozhem_active_connections` | Gauge | gateway: inc на subscribe, dec на disconnect/отзыве доступа | `roomId` |

- Buckets подгоняются под профиль комнаты (publish→deliver — миллисекунды; replay — до секунд); дефолты prom-client не берём вслепую.
- Label `roomId` — кардинальность = числу живых комнат; на MVP-масштабе приемлемо, REQ прямо называет «по комнатам».
- **Endpoint:** `GET /metrics` в transport-контуре (`register.metrics()` prom-client), открытый (решение №3), вне авторизации и CORS-гейтов — как `/health`. Content-Type из регистра.

## 4. C-8.1 — закрытие окна гонки свипа

**Проблема** (`guest-sweep.service.ts`): гард `hasOpenAwards` читает вне транзакции свипа → окно «award закоммичен между гард-чеком и коммитом свипа» → гость с открытой наградой анонимизируется вопреки REQ-RWD-013.

**Ключевой факт схемы:** `INSERT` в `Award` (FK на identity) берёт `FOR KEY SHARE` на строку identity; `updateMany` свипа — `FOR NO KEY UPDATE`. Блокировки конфликтуют → пути взаимно сериализуются на строке identity. Этим пользуемся вместо serializable.

**Сторона свипа (`GuestSweepService.sweepExpiredGuests`):** внутри существующей tx после `updateMany` — **повторный гард-чек** по всем `sweepIds`. Интерфейс `AnonymizationGuard.hasOpenAwards` расширяется tx-параметром; `RewardsAnonymizationGuard` читает через tx. Находка → throw → откат всей tx (анонимизация и отзыв сессий отменяются); свип завершается no-op'ом с логом; следующий тик `CLEANUP_INTERVAL` корректно обработает гостя как приостановленного. READ COMMITTED гарантирует: award, закоммитившийся до перепроверки (включая тот, чей INSERT ждал нашей блокировки), виден.

**Сторона award (`RewardsService.awardPrize`):** перед `INSERT ... ON CONFLICT` — гарда `identity.deletedAt IS NULL` по целевой identity (чтение в той же tx). Отказ — новый типизированный код `IDENTITY_ANONYMIZED` (409; в `CONTRACT_ERROR_CODES` SDK — минор-версия SDK), откат без списания фонда. Организатор видит отказ → перерозыгрыш (re-draw — существующий сценарий, запинан e2e ф.3). Закрывает остаточный сценарий «анонимизирован → награждён» (award-INSERT, ждавший блокировки свипа, коммитится после него).

**Обработка ошибок:** rollback свипа при гонке — не алерт (ожидаемый исход), лог `warn` с `{identityId, awardCount}`. Award-гарда — типизированный ContractError, в HTTP-фильтр по прецеденту (`STATUS_BY_WIRE_CODE`).

**Чего не делаем:** serializable не трогаем; горячий путь dispatch меняется одним дешёвым SELECT'ом. «Только tx-aware гард» (буква разреза) недостаточен: при READ COMMITTED award может закоммититься между гард-чеком и `updateMany`, когда блокировок ещё нет — поэтому re-check, а не просто перенос чтения в tx.

## 5. Тестирование (TDD, тесты первыми)

- **C-8.1 гонка — детерминированно, без sleep'ов:** int-spec свипа с гардом-стабом, который пишет `Award` внутри вызова re-check'а (управляемая точка инъекции) → ассерт rollback: identity не анонимизирован, сессии живы. Award-гарда: int-spec `awardPrize` по swept-identity → `IDENTITY_ANONYMIZED`, фонд не тронут.
- **Метрики:** unit MetricsService (registry содержит 4 серии); int — `GET /metrics` 200, text format; gauge активных соединений растёт/падает на subscribe/disconnect (дополнение существующей realtime e2e-ланы, не новая лана); счётчик ошибок фиксации — через спровоцированный сбой commit'а.
- **Логи:** unit на pino-конфигурацию (redact заголовков, level из конфига); e2e — ответ несёт `x-request-id`; JSON-строка лога запроса содержит requestId (перехват stream в тесте).

## 6. Границы и конвейер

- **dependency-cruiser:** `core/observability` не импортирует доменные модули (новое правило + probe в verify-guardrails с `expectFailure`, прецедент rewards-only-through-di-tokens). Импортёры `nestjs-pino`/`prom-client` — только observability и bootstrap (правило с якорем на пакеты).
- **SDK:** единственное изменение — код `IDENTITY_ANONYMIZED` в `CONTRACT_ERROR_CODES` (минор). Контрактные тесты SDK зелёные.
- **Конфиг:** `LOG_LEVEL` в единой zod-схеме (REQ-OPS-003) со спекой.
- **CI-гейты:** boundary-check, контрактные тесты, lint, type-check — зелёные.

## 7. Критерии выхода среза (вход для exit-аудита)

1. `/metrics` отдаёт 4 метрики REQ-OPS-004; gauge активных соединений сходится с реальностью в e2e.
2. Гонка свипа C-8.1 воспроизводится тестом и закрыта rollback'ом; award по swept-identity отклоняется типизированно (`IDENTITY_ANONYMIZED`), фонд не тратится.
3. Логи — JSON с корреляцией requestId (все запросы) и roomId/actorId (операционные точки §2); `authorization`/`cookie` redacted (тест).
4. REQ-SEC-008 подтверждён существующими артефактами без нового кода.
5. Конвейер зелёный: boundary-check, контрактные тесты SDK, lint, type-check.

## 8. Вне объёма (явно)

- REQ-RT-008 (архивация логов) — отложено (решение №1).
- Нагрузочная часть ф.4 (RT-014/015, ID-019, RT-011б, ID-012, ID-018, нагрузочный тест, лимиты режимов) — после первого живого события (разрез сессии 15).
- REQ-OPS-006 (бэкап-регламент) — после юриста/реальных PII (разрез сессии 15).
- Миграция остальных consumers на структурные логи сверх операционных точек §2 — по потребности.
