# Дизайн — Event-commit: запись app-событий в лог ядра

**Дата:** 2026-08-03
**Статус:** утверждён владельцем по секциям (§1–7)
**Предшественники:** `2026-07-22-realtime-log-lifecycle-emit-design.md` (шов §10), `2026-07-23-appsettings-write-path-design.md` (пин манифеста), `2026-07-30-transport-http-auth-design.md` (конвенции ошибок/лимитеров)

---

## 0. Решения владельца (не переоткрывать при исполнении)

- **Уровень среза:** только core-service API (`EventLogService.commitAppEvent`). Wire-exposure — с realtime-транспортом; HTTP-эндпоинт и test-app пакет-заглушка НЕ создаются.
- **Membership-гейт:** ядро проверяет, что `actorId ≠ null` — член комнаты (строка `Membership(roomId, actorId)` существует). Без spectator-ban: права эмита по ролям — app-семантика фазы 2.
- **Проводка actorId в lifecycle — в скоупе:** `RoomService.transition` принимает опциональный actorId и прокидывает в `commitCoreEvent`.
- **Подход A:** commit-цепочка живёт в `EventLogService` (инвариант «единственный путь записи» остаётся локально проверяемым); лимитер — отдельный класс.

## 1. Объём и карта требований

| Элемент | REQ |
|---|---|
| Status-гейт: эмит только в ACTIVE; терминальные = запечатано | REQ-RT-016 |
| Per-actor хард rate-limit эмиссии (без soft cap/режимов — ф.4 по амендменту v1.3) | REQ-RT-014 |
| Размер payload ≤ `max_event_payload` | REQ-RT-012 |
| Валидация payload схемой владельца типа до фиксации | REQ-CTR-008 |
| Отказ при фактической видимости слабее декларированной | REQ-CTR-009 |
| Payload-нейтральность гонки за seq (конкурентный тест + тест отсутствия смещения) | REQ-RT-007 |
| actorId из параметра (auth-контекст подставит транспорт позже) | REQ-RT-009 |
| Конфиг-параметры с дефолтами §4 пакета | REQ-OPS-003 |

**Вне скоупа (швы, §10):** wire-exposure и маппинг кодов; `soft_room_event_cap`, алерт, `room_event_cap_mode` (ф.4); права эмита по ролям сверх membership; leave/kick; DB-уровневый запрет UPDATE/DELETE лога (SRE-задел).

**Следствие, не развилка:** эмит только в ACTIVE выводится из принятого — пин `(appId, manifestVersion)` существует только с активации (REQ-RT-004), без пина нечем валидировать payload. DRAFT отклоняется тем же кодом, что терминальные.

## 2. Commit-цепочка `commitAppEvent`

Сигнатура: `commitAppEvent(tx, roomId, eventType, payload, visibility, actorId?): Promise<LogEvent>`.

Порядок проверок (все — ДО advisory lock; шаги 3–4 существующего примитива не меняются):

1. **Комната:** re-read `(status, appId, manifestVersion)`; не ACTIVE → `ROOM_NOT_ACTIVE` (терминальные — тот же код: запечатывание REQ-RT-016, инвариант ядра). Шаг до лимитера: попытки в запечатанную комнату не жгли лимит.
2. **Rate-limit** per `(roomId, actorId)`, только при `actorId ≠ null` (null-actor — серверные эмиссии, см. шаг 7): считаются попытки, не только успехи (per-actor DoS себя безразличен соседям) → `EVENT_EMIT_RATE_LIMITED`.
3. **Размер:** байтовая длина сериализованного payload ≤ `MAX_EVENT_PAYLOAD_BYTES` → `EVENT_PAYLOAD_TOO_LARGE`.
4. **Реестр:** тип есть в пиннутом манифесте → иначе `EVENT_TYPE_UNKNOWN`.
5. **Схема:** ajv-валидация payload; кэш валидаторов per `appId@version:type` — в `AppRegistryService` рядом с appSettings-кэшем (новый метод, ajv остаётся инкапсулирован) → `EVENT_PAYLOAD_INVALID`.
6. **Видимость:** фактическая ≤ декларированной для типа (строже можно) → `EVENT_VISIBILITY_EXCEEDED`. Порядок уровней (`public` < `organizer` < `module-private`) — helper в SDK `visibility/` (нужен и read-path позже).
7. **Membership:** `actorId ≠ null` → существует `Membership(roomId, actorId)` → иначе `ACTOR_NOT_MEMBER`. `actorId = null` допустим (будущие серверные эмиссии приложения — таймеры раундов): membership-гейт и per-actor лимит не применяются.
8. **Lock + INSERT:** без изменений (существующий приватный append, общий с `commitCoreEvent`). `schemaVersion` = пиннутый `manifestVersion`; `visibility` = фактическая; `actorId` = параметр.

Обоснование порядка 2→7: дешёвые отказы раньше; вся валидация до критической секции — контрактуально (REQ-RT-007), размер payload не влияет на исход гонки.

## 3. Лимитер эмиссии

`realtime/event-emit-limiter.ts` — по паттерну `join-rate-limiter`: in-memory `Map<key, timestamps[]>`, скользящее окно, ключ `${roomId}:${actorId}`, ленивый sweep при обращении + периодический eviction (паттерн закреплён transport-срезом). In-memory оправдан одной репликой (REQ-OPS-005). Интерфейс: `consume(key): boolean` — атомарная проверка+инкремент.

## 4. Конфиг-параметры

В `config.schema.ts` (валидация на буте, fail-closed; стиль имён — как существующие):

| Параметр | Дефолт | Диапазон | REQ |
|---|---|---|---|
| `EVENT_EMIT_RATE_LIMIT_PER_MIN` | 30 | ≥ 1 | REQ-RT-014 |
| `MAX_EVENT_PAYLOAD_BYTES` | 16384 | 1024…262144 | REQ-RT-012 |

## 5. Проводка actorId в lifecycle

`RoomService.transition(roomId, target, actorId?)` — опциональный параметр (callers без auth-контекста, напр. seed-скрипт, не ломаются); прокидывается в `commitCoreEvent` всеми ветками (activate/cancel/complete). Membership-проверка на transition НЕ добавляется — семантика transition закрыта своим срезом; здесь только протаскивание. Тест: transition с actorId → lifecycle-событие в логе с `actorId ≠ null`.

## 6. Ошибки

Новый `realtime/realtime.errors.ts` — типизированные классы с core-кодами (стиль `auth.errors.ts`):

| Класс | Код |
|---|---|
| `RoomNotActiveError` | `ROOM_NOT_ACTIVE` |
| `EventEmitRateLimitedError` | `EVENT_EMIT_RATE_LIMITED` |
| `EventPayloadTooLargeError` | `EVENT_PAYLOAD_TOO_LARGE` |
| `EventTypeUnknownError` | `EVENT_TYPE_UNKNOWN` |
| `EventPayloadInvalidError` | `EVENT_PAYLOAD_INVALID` (код существует в SDK) |
| `EventVisibilityExceededError` | `EVENT_VISIBILITY_EXCEEDED` |
| `ActorNotMemberError` | `ACTOR_NOT_MEMBER` |

Wire-маппинг в `{code}` — не в этом срезе (нет exposure). При realtime-транспорте `EVENT_EMIT_RATE_LIMITED` маппится в единый `RATE_LIMITED` по принятой конвенции.

## 7. Стратегия тестов (TDD — тесты первыми)

- **Unit:** лимитер (окно, изоляция ключей, sweep); helper порядка видимости в SDK.
- **Int (testcontainers; фикстурный `test-app@1` через SDK `defineApp`, в тестах core — не пакет):** happy path (строка в логе: seq, type, visibility, schemaVersion = manifestVersion); каждый из 7 отказов цепочки; лимитер int (31-я попытка отклонена; второй actor не затронут; null-actor вне per-actor лимита).
- **Конкурентные (критерии выхода ф.1):** N параллельных commit → seq ровно 1..N без дыр/дублей; **payload-нейтральность** — гонка крупного/мелкого payload: обе записи валидны, seq соответствует порядку захвата lock, не порядку старта и не размеру (закрывает отложенный тест lifecycle-среза).
- **Lifecycle actor:** transition с actorId → событие с actorId≠null (закрывает второй отложенный тест).
- **Подбирается из follow-up:** шов-комментарий о конвенции порядка блокировок в `event-log.service.ts` (advisory lock — leaf-most; ждал среза, трогающего файл).

## 8. Отклонённые альтернативы

- **B. Отдельный `AppEventCommitService`, делегирующий append в EventLogService** — инвариант «все проверки до записи» распадается на два файла; «голый» append вызываем в обход цепочки (граница на честном слове). Отклонён владельцем в пользу A.
- **C. Pipeline/decorator middleware** — оверинжиниринг под одну известную цепочку (YAGNI).
- **HTTP-эндпоинт / test-app пакет** — wire-exposure и app-модули придут с realtime/фазой 2; пустых директорий под будущее не создаём (CLAUDE.md §2.3).
- **Membership-гейт на null-actor** — серверные эмиссии приложения (таймеры) не имеют актора; гейт обязателен только для client-originated, что принудит транспорт.
- **Считать лимитом только успешные commit** — позволяет флуду невалидными payload обходить ограничение работы; считаются попытки.

## 9. Критерии выхода среза

Все гейты зелёные (build/lint/typecheck/unit/int/boundary-check/guardrails); конкурентный тест seq и payload-нейтральности проходят (критерий выхода фазы 1 по REQ-RT-007); тест отказа фиксации при заниженной видимости (REQ-CTR-009) и тест запечатывания (REQ-RT-016) — из критериев выхода фазы 1 — закрыты; оба отложенных теста lifecycle-среза подобраны; миграций не добавлено (модель `LogEvent` достаточна).

## 10. Швы (отложенное, зафиксированное словами)

| Шов | Куда |
|---|---|
| Wire-exposure commit (Socket.io `publish`), подстановка actorId из auth-контекста | realtime transport план |
| Маппинг `EVENT_EMIT_RATE_LIMITED` → `RATE_LIMITED`, остальные коды → wire `{code}` | realtime transport план |
| Read-path: проекции по уровням, replay, курсор (helper порядка видимости уже в SDK) | realtime read план |
| `soft_room_event_cap`, алерт, `room_event_cap_mode`; экспоненциальный backoff reconnect | фаза 4 (амендмент v1.3) |
| Права эмита по ролям (SPECTATOR и др.) | app-семантика, фаза 2 |
| DB-запрет UPDATE/DELETE лога (rule/trigger) | SRE-задел |
