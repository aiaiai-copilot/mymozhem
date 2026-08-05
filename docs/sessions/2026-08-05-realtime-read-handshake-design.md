# Дизайн: realtime read/handshake — полный duplex-транспорт

**Дата:** 2026-08-05
**Статус:** утверждён владельцем по секциям (скоуп, fan-out, wire-протокол, таблица маппинга, handshake/subscribe, publish, outbox, проекции, тесты)
**Предшественники:** transport-http-auth (готов `TokenService.verifyAccessToken` + claims), event-commit (готов `commitAppEvent`, типизированные core-ошибки), appSettings write path (пин, `x-visibility`)

---

## §0. Решения владельца, зашитые в дизайн (не переоткрывать при исполнении)

1. **Скоуп — полный duplex:** handshake + subscribe/replay + live-доставка + publish app-событий через сокет в `commitAppEvent` + полная таблица маппинга core→contract кодов. Publish не выносится в отдельный срез.
2. **REQ-SEC-003 — hook + реестр сейчас:** gateway держит реестр подписок и даёт сервисный метод разрыва подписок identity в комнате; сам flow исключения (membership-метод + endpoint) — следующий membership-срез.
3. **Post-commit fan-out — подход A:** tx-scoped outbox на AsyncLocalStorage, fail-closed при отсутствии контекста. Caller-side publish (B) и LISTEN/NOTIFY (C) отклонены.
4. **`EVENT_EMIT_RATE_LIMITED` → `EVENT_RATE_LIMITED`** (контрактный код, зарезервированный в SDK), НЕ `RATE_LIMITED`: доменный лимит REQ-RT-014 ≠ транспортный `RATE_LIMITED`. Header-комментарий `realtime.errors.ts` (обещавший маппинг в `RATE_LIMITED`) правится — неоднозначность разрешена.
5. **`ACTOR_NOT_MEMBER` — новый аддитивный код в `CONTRACT_ERROR_CODES`** (counterpart'а в перечне SDK нет); тот же код использует отказ `subscribe` не-члену.
6. **Умолчание `visibility` в publish — декларированный потолок типа** (самый защищённый из разрешённых, fail-safe).
7. **Per-event re-check членства в живой доставке НЕ делаем:** в MVP членство неотзываемо во время сессии; норма связывается hook'ом разрыва (п.2), который срез исключения обязан вызвать.

## §1. Скоуп и закрываемые нормы

**Закрываемые REQ-\*:** REQ-RT-003 (replay проекции), REQ-RT-006 (транспорт за контрактом), REQ-RT-009 (wire-валидация + actorId из auth-контекста), REQ-RT-011(a) (глобальный seq не экспонируется — структурно, через `projectedEventSchema`), REQ-RT-015 в объёме amendment v1.3 (базовый per-identity потолок reconnect/replay; бэкофф — ф.4), REQ-CORE-005/008 (проекции по уровню запрашивающего, включая appSettings), REQ-SEC-003 (гейт членства на чтение + hook разрыва), REQ-SEC-006 (наружу только `{code}`), REQ-OPS-005 (in-process шина, одна реплика), REQ-CTR-005 (контрактные фикстуры новых конвертов), REQ-OPS-003 (новый конфиг-параметр в единой zod-схеме).

**Критерии выхода ф.1, закрываемые срезом:** тест late-join через replay; тест видимости по каналам realtime/replay (`module-private` недоступен участнику); тест потолка reconnect/replay (в объёме v1.3).

**Не входит (явно):** REST read-path комнаты (web-client срез); flow исключения организатором (membership-срез, вызовет hook); сплошная per-level нумерация и курсор replay (ф.4, REQ-RT-011б); режимы бэкоффа (ф.4); второй транспорт.

## §2. Компоненты

Всё в `packages/core/src/realtime/` — транспорт за Realtime-модулем (REQ-RT-006); прямое использование Socket.io вне модуля запрещено и ловится boundary-check.

- **`RealtimeGateway`** — Socket.io (`@nestjs/platform-socket.io` поверх существующего Fastify-адаптера, тот же HTTP-сервер): handshake-auth, хендлеры `subscribe`/`publish`, разрыв подписок.
- **`ProjectionService`** — проекции событий и appSettings по уровню запрашивающего (на `appSettingsVisibilityMap` из SDK). Единственное место построения видимости наружу; ручная фильтрация полей в gateway запрещена (REQ-CORE-005).
- **`RealtimeBus`** — in-process шина «событие закоммичено» (одна реплика, REQ-OPS-005). Воссоздаваемость не нужна: события durable в логе, шина — только live-доставка.
- **`EventOutbox`** — ALS-runner над `prisma.$transaction`: staging событий в контексте транзакции, flush в шину после коммита (§5).
- **`SubscriptionRegistry`** — реестр `(identityId, roomId, socketId, level)` + публичный hook `revokeRoomAccess(identityId, roomId)`.
- **`error-mapping.ts`** — таблица core→contract кодов (§3), единственная точка перевода; compile-time exhaustive по `REALTIME_ERROR_CODES`.
- **SDK (minor 1.1.0 → 1.2.0, аддитивно, REQ-CTR-004):** wire-схемы `subscribe`/`publish`/snapshot, код `ACTOR_NOT_MEMBER`, фикстуры (REQ-CTR-005).
- **Конфиг:** `RECONNECT_RATE_LIMIT_PER_MIN` (§4 пакета: 10/мин на identity, ≥ 1) — добавляется в `config.schema.ts` по конвенции «параметры приходят с фазой».

`RoomService.transition` переключается с `prisma.$transaction` на `EventOutbox.run` — lifecycle-события (REQ-RT-010) начинают доезжать до подписчиков по тому же каналу. Единственное изменение существующего prod-кода; атомарность «переход + лог» не трогается.

## §3. Wire-протокол и таблица маппинга

### Конверты (zod-схемы в SDK)

| Направление | Сообщение | Содержимое |
|---|---|---|
| client→server | `subscribe` (ack) | `{roomId}` → ack: `{ok:true, snapshot}` либо `{code}` |
| client→server | `publish` (ack) | `{type, payload, visibility?}` → ack: `{ok:true}` либо `{code}` |
| server→client | `event` | `ProjectedEvent` = `{type, payload, actorId}` |

- `snapshot` = `{ events: ProjectedEvent[], appSettings: Record<string, unknown> }` — полная видимая проекция, без курсора (MVP; SDK-дизайн §4.4). Отдельного поля статуса комнаты нет: статус клиент узнаёт из lifecycle-событий в том же потоке (REQ-RT-010).
- seq/visibility/cursor отсутствуют в наружной форме структурно (REQ-RT-011a): `projectedEventSchema` — strictObject, лишний ключ — громкий отказ.
- `visibility` в `publish` опциональна; умолчание — потолок типа (§0.6). Занижение потолка отклоняет существующая проверка REQ-CTR-009.
- Ack Socket.io — штатный request/response. Наружу ровно `{code}` (REQ-SEC-006); message — в серверный лог.
- Все входящие конверты валидируются zod-схемами SDK (REQ-RT-009); ошибка валидации → `REQUEST_INVALID`.

### Таблица маппинга core→contract

Core-имена (design event-commit §6, утверждены) НЕ переименовываются; перевод — только на границе, только здесь.

| Core-код | Contract-код | Примечание |
|---|---|---|
| `ROOM_NOT_ACTIVE` | `ROOM_LOG_SEALED` | Свёртка DRAFT/терминальная/нет комнаты сохраняется; точность — в server-side message |
| `EVENT_TYPE_UNKNOWN` | `EVENT_UNKNOWN_TYPE` | Переименование только на границе |
| `EVENT_VISIBILITY_EXCEEDED` | `EVENT_VISIBILITY_WEAKER_THAN_DECLARED` | — |
| `EVENT_EMIT_RATE_LIMITED` | `EVENT_RATE_LIMITED` | §0.4: доменный лимит REQ-RT-014; `RATE_LIMITED` остаётся транспортным (HTTP, handshake-потолок) |
| `EVENT_PAYLOAD_INVALID` | `EVENT_PAYLOAD_INVALID` | Паритет |
| `EVENT_PAYLOAD_TOO_LARGE` | `EVENT_PAYLOAD_TOO_LARGE` | Паритет |
| `ACTOR_NOT_MEMBER` | `ACTOR_NOT_MEMBER` | §0.5: новый аддитивный код SDK; также — отказ `subscribe` не-члену (REQ-SEC-003) |

Handshake-отказы: auth → `SESSION_INVALID` (connect_error), reconnect-потолок → `RATE_LIMITED`. Оба кода уже в контракте.

## §4. Handshake, подписка, reconnect-потолок

**Handshake.** Токен в `socket.handshake.auth.token`. Middleware: `TokenService.verifyAccessToken` → claims `{sub, sid, kind, roomId?}`; любой отказ → `connect_error {code:'SESSION_INVALID'}` (причины наружу не различаются, как в refresh). Claims — единственный источник actorId на всё живое время соединения (REQ-RT-009).

**Subscribe `{roomId}`:**
1. **Scope-гейт:** GUEST — только `claims.roomId` (REQ-ID-016); REGISTERED — решает membership-гейт (токены REGISTERED не выдаются до OAuth-среза, ветка общая).
2. **Membership-гейт (REQ-SEC-003):** живой `Membership` по `(roomId, sub)`, комната не удалена. Отказ → `ACTOR_NOT_MEMBER`. Уровень по роли: ORGANIZER → `organizer`; PARTICIPANT/SPECTATOR/MODERATOR → `public` (MODERATOR в MVP без прав сверх PARTICIPANT — amendment v1.3).
3. Сокет вступает в socket.io-комнаты `room:{id}` и (при ORGANIZER) `room:{id}:organizer`; реестр фиксирует `(identityId, roomId, socketId, level)`.
4. Ack со snapshot'ом: `ProjectionService` читает лог комнаты + `appSettings` (пиннутый манифест), отдаёт проекцию уровня подписчика.
5. Re-subscribe тем же сокетом в ту же комнату — идемпотентен (повторный snapshot). Подписка одним сокетом на вторую комнату — `REQUEST_INVALID` (мульти-подписка не строится до спроса).

**Непрерывность REQ-SEC-003.** Проверка не единовременна: publish на каждое сообщение проходит membership-гейт commit-цепочки (шаг 7 `commitAppEvent`); чтение — только через subscribe/replay с гейтом. Hook разрыва: `SubscriptionRegistry.revokeRoomAccess(identityId, roomId)` — сокеты identity выводятся из socket.io-комнат и отключаются (`disconnect(true)`); вызывающего пока нет, метод покрыт тестом и задокументирован как шов среза исключения. Per-event re-check членства в живой доставке не делаем (§0.7).

**Reconnect-потолок (REQ-RT-015, объём v1.3).** Per-identity лимитер (паттерн `JoinRateLimiter`, отдельный инстанс) на успешный handshake, ключ `sub`, потолок `RECONNECT_RATE_LIMIT_PER_MIN`. Точка учёта — handshake, не subscribe: каждый reconnect тянет replay, это самая ранняя точка после аутентификации; неаутентифицированные попытки не считаются (identity ещё нет). Превышение → `connect_error {code:'RATE_LIMITED'}`. Бэкофф и конфигурируемый режим — ф.4.

**Disconnect.** Сокет вычищается из реестра; комнатная логика на disconnect не реагирует (presence не строим — не заявлен).

## §5. Publish-путь и EventOutbox

**Publish:**
1. Конверт валидируется zod-схемой SDK. `type` — `appId.name`; тип чужого приложения отсутствует в пиннутом манифесте комнаты, поэтому отсекается существующим шагом 4 commit-цепочки (реестр) как `EVENT_UNKNOWN_TYPE` — отдельной проверки appId не вводим.
2. Сокет обязан быть подписан на комнату; roomId берётся из подписки, не из payload.
3. `actorId = claims.sub`; `visibility` — из конверта либо потолок типа.
4. `EventOutbox.run(tx => eventLog.commitAppEvent(tx, roomId, name, payload, visibility, actorId))` — commit-цепочка без изменений (статус-гейт REQ-RT-016 с post-lock recheck, rate-limit REQ-RT-014, размер REQ-RT-012, реестр+схема REQ-CTR-008, потолок REQ-CTR-009, membership).
5. Ошибка цепочки → таблица маппинга → ack `{code}`; успех → ack `{ok:true}`. Ack не возвращает ни seq, ни тело события: публикующий видит своё событие через общий fan-out, как все подписчики.

**EventOutbox:**
- `run(fn)` — обёртка над `prisma.$transaction`: открывает ALS-контекст (пустой буфер), выполняет `fn(tx)`; после успешного коммита — `RealtimeBus.publish(roomId, events)`; при откате буфер умирает с контекстом — откаченное событие недоставимо структурно.
- `commitCoreEvent`/`commitAppEvent` после `appendLocked` кладут событие в ALS-буфер. Нет контекста → fail-closed (типизированная внутренняя ошибка): коммит вне runner'а невозможен, «забыл доставить» исключено структурно. Существующие int-спеки с ручными транзакциями переключаются на runner (механическая правка).
- Вложенность runner'ов запрещена (отказ): вложенных интерактивных транзакций в Prisma нет; буфер один, на внешнем контексте.

**Fan-out:** gateway подписан на шину при bootstrap. По `visibility` события: `public` → `room:{id}`; `organizer` → `room:{id}:organizer`; `module-private` → не доставляется никому (уровень для ядра/модуля; наружу не проецируется ни по одному каналу — REQ-CORE-005). Наружу уходит только `ProjectedEvent`, построенный `ProjectionService`.

## §6. Проекции

- `projectEvents(events, level)`: уровень `organizer` видит `public`+`organizer`; `public` — только `public`; `module-private` не отдаётся никогда. Выход — строго `ProjectedEvent`.
- `projectAppSettings(room, level)`: из `room.appSettings` + пиннутого `(appId, manifestVersion)` — JSON Schema манифеста → `appSettingsVisibilityMap` (SDK) → свойства в пределах уровня; неаннотированные — `module-private` (fail-safe REQ-CORE-008). Нет пина (DRAFT без конфигурации) → `{}`. appSettings заморожены при ACTIVE (REQ-RT-004) — живого канала нет, только snapshot при subscribe.

## §7. Тестирование (TDD; контрактные первыми)

- **SDK-контракт:** фикстуры валидных/невалидных `subscribe`/`publish`/snapshot (REQ-CTR-005); лишний ключ → отказ strictObject.
- **Unit (core):** проекции по уровням (события + appSettings; неаннотированное свойство скрыто); таблица маппинга полна по `REALTIME_ERROR_CODES` (compile-time exhaustive).
- **Int (testcontainers):** late-join replay (критерий ф.1); видимость — `module-private` событие и свойство appSettings недоступны participant'у ни в replay, ни live (критерий ф.1); на проводе нет seq/visibility/cursor (REQ-RT-011a); publish → commit → live-доставка на правильные уровни; publish в запечатанную комнату → `ROOM_LOG_SEALED`; actorId из токена, не из payload (REQ-RT-009); reconnect-потолок: превышение → `RATE_LIMITED`; outbox: откат → ноль доставки, коммит → ровно одна доставка; `revokeRoomAccess` разрывает подписки (hook-тест); гость не может subscribe в чужую комнату (scope REQ-ID-016).
- **e2e (apps/server):** реальный join → токен → socket connect → subscribe → snapshot; publish → event получен вторым клиентом. Перед прогоном — `pnpm build` (e2e резолвит `@mymozhem/core` из dist).

## §8. Риски и ограничения, вносимые срезом (в HANDOFF после мерджа)

- Live-доставка in-memory: рестарт процесса = разрыв всех сокетов; клиент обязан переподключиться и взять replay (контракт покрывает).
- `EventOutbox.run` — обязательная обёртка любой транзакции с коммитом событий: конвенция для будущих срезов (принуждается fail-closed).
- CORS сокета повторяет HTTP-политику (`CORS_ORIGINS`); wildcard в production запрещён тем же superRefine (REQ-SEC-008).

## §9. Швы после среза

- Срез исключения (membership): `MembershipService.exclude` + endpoint организатора → обязан вызвать `SubscriptionRegistry.revokeRoomAccess` (закроет критерий ф.1 «немедленный отзыв подписки» целиком).
- Web-client срез: REST read-path комнаты; cookie/CORS-оговорки транспортного среза остаются в силе.
- OAuth-срез: REGISTERED-ветка subscribe (без roomId-scope) заработает с выдачей REGISTERED-токенов.
- Ф.4: per-level нумерация/курсор (REQ-RT-011б), бэкофф reconnect (REQ-RT-015), `soft_room_event_cap` (REQ-RT-014).
