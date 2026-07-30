# Дизайн среза: транспортный auth/HTTP — первый выход наружу

**Дата:** 2026-07-30
**Статус:** дизайн, до плана реализации
**Фаза:** 1 (MVP), кратчайший путь к первому живому событию

---

## §0. Решения владельца (зафиксированы в brainstorm-сессии)

1. **OAuth в срез НЕ входит.** Google OAuth (REQ-ID-015) — отдельным срезом позже. Комнаты к первому событию создаются служебно: REGISTERED-организатор заводится seed'ом, комната — скриптом через core-сервисы.
2. **Инвентарь эндпоинтов: только `POST /rooms/join` + `POST /auth/refresh`.** `POST /rooms` по HTTP придёт вместе с OAuth-срезом (там же — аутентификация REGISTERED-организатора).
3. **Parked-minors — все три в скоупе:** real-IP extraction (доверие к X-Forwarded-For из конфига), eviction протухших IP-записей в `JoinRateLimiter`, маппинг malformed uuid → типизированная ошибка.
4. **Seed — скрипт через core-сервисы** (не SQL напрямую): штатные валидации, lifecycle-эмиты и частичный индекс работают как в живом пути.
5. **Размещение транспорта — вариант A: API-модуль в `packages/core`.** `apps/server` остаётся чистым composition root (конвенция `HealthModule`). Граница ADR-002 («app-модули ↔ ядро через SDK») не затрагивается: транспорт — часть ядра, а не app-модуль.
6. **Микро-решения по кодам:** единый `RATE_LIMITED` для join и refresh (не per-endpoint коды); единый `SESSION_INVALID` для всех отказов refresh (reuse/expired/unknown неразличимы снаружи — тот же принцип, что REQ-ID-013).

---

## 1. Скоуп и не-скоуп

**В скоупе:**

- Первый HTTP-выход наружу: guest-join с выдачей токен-пары и refresh с ротацией.
- Токен-контур с нуля: access JWT + httpOnly refresh (REQ-ID-007/008/016), таблица сессий, детекция кражи.
- Типизированные ошибки наружу (REQ-SEC-006) — исполнение forward-обязательства из handoff: первый потребитель, отдающий доменную ошибку по HTTP, идёт через типизированный код без стектрейса.
- Контроли первого выхода наружу: JWT_SECRET fail-closed (REQ-SEC-002), rate-limit refresh (REQ-SEC-007), helmet + CORS-allowlist (REQ-SEC-008), неразличимость веток входа на проводе (REQ-ID-013).
- Три parked-minor'а (см. §0.3).
- Seed-скрипт создания комнаты служебным организатором.

**Осознанно НЕ в скоупе:**

- `POST /rooms` и любая REGISTERED-аутентификация (OAuth-срез).
- Read-поверхность и realtime (отдельные срезы; realtime-handshake позже переиспользует формат claims и `TokenService.verify`).
- `invite_only`-специфика приглашений (политика есть в core, приглашения — не этот срез).
- Revocation-list для access-токенов: stateless JWT доживает свои ≤15 мин; принятый компромисс короткого TTL (см. §4).
- Глобальный backoff перебора кода (REQ-ID-019 — фаза 4 по амендменту v1.3).
- Очистка просроченных сессий регламентным job'ом (REQ-ID-010 — SHOULD; отдельным решением, таблица спроектирована с учётом: `expiresAt` + `revokedAt` достаточны для будущего sweep'а).

## 2. Закрываемые требования (якорь для плана и spec-ревью)

| REQ | Чем закрывается |
|---|---|
| REQ-ID-007 | Refresh хэширован (SHA-256), ротация при каждом refresh, reuse → revoke семейства |
| REQ-ID-008 | Refresh только в httpOnly-cookie; токены в URL запрещены (нет такого кода пути вовсе) |
| REQ-ID-016 | Единый механизм GUEST/REGISTERED; guest claims с `roomId`; refresh_ttl ≤ guest_ttl; инвалидация при терминальной комнате / TTL / soft-deleted членстве |
| REQ-ID-013 | Транспорт отдаёт одинаковые status+body для «неверный код» и «закрытая политика» (core уже коллапсирует ветки; e2e-тест неразличимости) |
| REQ-ID-006 (частично) | Лимитер доведён: eviction, real-IP из конфигурируемого trustProxy |
| REQ-SEC-001 | Seed — CLI-скрипт, не HTTP-путь; в production-артефакте демо-auth отсутствует |
| REQ-SEC-002 | `JWT_SECRET` обязателен, ≥32 байта, старт с пустым/дефолтным невозможен (валидация config-схемой) |
| REQ-SEC-006 | Глобальный фильтр: wire-формат `{code}`, без message/stack наружу при любой ошибке |
| REQ-SEC-007 | Собственный rate-limit refresh-эндпоинта, строже/отдельнее join |
| REQ-SEC-008 | `@fastify/helmet`; CORS allowlist из конфига, wildcard запрещён в production (инвариант схемы) |
| REQ-OPS-003 | Новые параметры в единой zod-схеме конфига с кросс-инвариантами |

REQ-RT-009 срез не реализует (это realtime), но формат claims (`sub`, `sid`, `kind`, `roomId`) проектируется как контракт, который realtime-handshake возьмёт без изменений.

## 3. Компоненты

Всё новое — в `packages/core/src/`; `apps/server` получает одну строку импорта в `AppModule` и регистрацию плагинов в `main.ts`.

```
packages/core/src/
├── transport/
│   ├── transport.module.ts        # TransportModule: controllers + глобальный фильтр
│   ├── join.controller.ts         # POST /rooms/join
│   ├── auth.controller.ts         # POST /auth/refresh
│   └── http-exception.filter.ts   # code → status + {code}; catch-all
├── auth/
│   ├── auth.module.ts             # TokenService (+ свои конфиг-инъекции)
│   ├── token.service.ts           # issue/verify/rotate, session persistence
│   └── auth.errors.ts             # AuthError с типизированными кодами (внутренние)
└── identity/ (миграция: таблица identity."Session")

apps/server/src/main.ts           # + @fastify/cookie, @fastify/helmet, @fastify/cors, trustProxy
scripts/create-room.ts            # seed-скрипт (CLI, не HTTP)
packages/sdk/src/                 # + join/token DTO-схемы, расширение реестра кодов (1.0.0 → 1.1.0)
```

**Поток join:** `JoinController` → zod-валидация тела (DTO из SDK) → `MembershipService.join({code, displayName, ip: req.ip})` → `TokenService.issueGuestTokens(identityId, roomId)` → 201 `{accessToken, tokenType: 'Bearer', expiresIn}` + Set-Cookie с refresh.

**Поток refresh:** `AuthController` → rate-limit per-IP → чтение refresh-куки → `TokenService.rotate(refreshToken)` (включая проверки REQ-ID-016) → 200 с новым access в теле + перезапись refresh-куки.

**Контроллеры HTTP-статусов не знают.** Все ошибки (включая успешные ветки с типизированным отказом) уходят в глобальный фильтр; единственная точка маппинга code→status — таблица в фильтре.

**Кука refresh:** `httpOnly`, `Secure` (в production), `SameSite=Strict`, `Path=/auth` (не уходит никуда, кроме refresh-эндпоинта), `Max-Age = REFRESH_TOKEN_TTL`.

## 4. Токен-модель и схема БД

**Access JWT (HS256, `JWT_SECRET`):** claims `{sub: identityId, sid, kind, roomId?}`.
- GUEST (единственный выдаваемый в срезе): `kind: 'GUEST'`, `roomId` обязателен — room-scope зашит в токен (REQ-ID-016).
- REGISTERED: формат зарезервирован (`kind: 'REGISTERED'`, без `roomId`), не выдаётся до OAuth-среза; формат не изменится — verify уже сейчас ветвится по `kind`.
- TTL: `ACCESS_TOKEN_TTL` (default 15 мин, §4 пакета). `expiresIn` в ответе вычисляется из той же конфиг-точки (REQ-ID-010 по духу).

**Refresh:** криптослучайный opaque-токен (≥32 байта, hex/base64url), хранится только SHA-256-хэшем. Сам токен — только в куке у клиента.

**Таблица `identity."Session"` (новая миграция; замороженные не трогаем):**

| колонка | тип | назначение |
|---|---|---|
| `id` | uuid PK | = `sid` в claims |
| `identityId` | uuid FK → `identity."Identity"` | владелец |
| `refreshTokenHash` | text, UNIQUE | SHA-256 текущего refresh |
| `familyId` | uuid | семейство ротаций (детекция кражи) |
| `replacedById` | uuid, nullable | преемник после ротации |
| `revokedAt` | timestamptz, nullable | отзыв (точечный или семейный) |
| `expiresAt` | timestamptz | `createdAt + min(REFRESH_TOKEN_TTL, GUEST_TTL)` для гостя; инвариант REFRESH ≤ GUEST_TTL — в config-схеме (REQ-OPS-003) |
| `createdAt` | timestamptz | |

**Ротация (`rotate`)** — одна транзакция:
1. Найти сессию по `refreshTokenHash`.
2. Conditional UPDATE `SET replacedById = :newId WHERE id = :id AND replacedById IS NULL AND revokedAt IS NULL AND expiresAt > now()` — гонка двух параллельных refresh не выдаёт две валидные пары: второй UPDATE заденет 0 строк.
3. Исходы:
   - условие выполнено → INSERT новой сессии (тот же `familyId`, новый hash) → новая пара;
   - сессия найдена, но `replacedById` не null → **reuse-detection (REQ-ID-007):** UPDATE всех сессий `familyId` SET `revokedAt = now()` → 401 `SESSION_INVALID`;
   - не найдена / просрочена / revoked → 401 `SESSION_INVALID` (тот же код — снаружи неразличимы).

**Проверки REQ-ID-016 при refresh гостевой сессии** (после нахождения сессии, до выдачи): identity существует, не `deletedAt`, не анонимизирована по TTL (`createdAt + GUEST_TTL > now()`); членство в `roomId` из claims не soft-deleted; комната не в терминальном статусе (COMPLETED/CANCELLED). Любой отказ → 401 `SESSION_INVALID`.

**Access-revocation:** не реализуется. Обоснование: TTL 15 мин, одна реплика, первое событие; таблица сессий — источник истины только для refresh. Завершение комнаты гасит refresh немедленно, access доживает ≤15 мин — принятый риск, зафиксирован здесь, а не в коде молча.

## 5. Маппинг ошибок (REQ-SEC-006)

Wire-формат любой ошибки: `{code}` и ничего больше (`contractErrorPayloadSchema` из SDK — уже заданный формат). Полная ошибка — в серверный лог.

| Источник | HTTP | code |
|---|---|---|
| `RoomJoinDeniedError` (core уже коллапсирует: неверный код / удалённая или терминальная комната / закрытая политика) | 403 | `ROOM_JOIN_DENIED` |
| `JoinRateLimitedError` | 429 | `RATE_LIMITED` |
| `RoomParticipantLimitReachedError` | 409 | `ROOM_PARTICIPANT_LIMIT_REACHED` |
| `ZodError` (тело join, displayName — сейчас нетипизированно вылетает из `MembershipService.join`; маппинг явно откладывался на этот срез) | 400 | `REQUEST_INVALID` |
| `AuthError` (refresh невалиден/просрочен/reused/инвалидация по ID-016) | 401 | `SESSION_INVALID` |
| Refresh rate-limit (429 от rate-limit'ера auth-контроллера) | 429 | `RATE_LIMITED` |
| Prisma-сырьё: `PrismaClientKnownRequestError` P2010 с SQLSTATE 22P02 (uuid-syntax — parked minor) и прочие P-коды | 400 | `REQUEST_INVALID` |
| Всё неопознанное | 500 | `INTERNAL_ERROR` |

Новые коды `REQUEST_INVALID`, `SESSION_INVALID`, `RATE_LIMITED`, `INTERNAL_ERROR` и перенос `ROOM_JOIN_DENIED`, `JOIN_RATE_LIMITED`→`RATE_LIMITED`, `ROOM_PARTICIPANT_LIMIT_REACHED` — расширение реестра кодов в SDK (аддитивно). Внимание при планировании: core-код `JOIN_RATE_LIMITED` на проводе становится `RATE_LIMITED` — маппинг в таблице фильтра, core-ошибку не переименовываем (core-коды внутренние, контракт наружу — SDK).

## 6. Контроли безопасности транспорта

- **Real-IP (parked minor):** конфиг `TRUST_PROXY` (bool, default false) → `new FastifyAdapter({ trustProxy })`. Fastify резолвит `req.ip` по X-Forwarded-For только при включённом trustProxy. Доверие к заголовку — свойство деплоя (конфиг), не кода. Лимитеры получают `req.ip` как дано.
- **Eviction лимитера (parked minor):** `JoinRateLimiter` — ленивый sweep: при `tryAcquire`, если с последнего sweep прошло > `windowMs`, пройти по Map и удалить протухшие записи. Амортизировано O(n) раз в окно; Map перестаёт расти по одной записи на one-shot IP за жизнь процесса.
- **Refresh rate-limit (REQ-SEC-007):** тот же класс лимитера, отдельный инстанс с `REFRESH_RATE_LIMIT` (default 10/мин, §4 `login_rate_limit`).
- **helmet (REQ-SEC-008):** `@fastify/helmet`, дефолтный набор заголовков.
- **CORS (REQ-SEC-008):** `@fastify/cors`, `origin` = allowlist из `CORS_ORIGINS`. Инвариант config-схемы: `NODE_ENV=production` + wildcard `*` в списке → отказ старта.
- **uuid-маппинг (parked minor):** строка «Prisma-сырьё → REQUEST_INVALID» в таблице фильтра (§5).
- **REQ-SEC-001:** никаких демо/тестовых auth-путей в HTTP. Seed-организатор существует только в БД и не имеет способа залогиниться — токены ему не выдаются ни одним эндпоинтом.

## 7. Конфиг-параметры (REQ-OPS-003, единая zod-схема, fail-closed)

| Параметр | Default | Валидация |
|---|---|---|
| `JWT_SECRET` | — | обязателен, ≥32 байта (REQ-SEC-002) |
| `ACCESS_TOKEN_TTL` | 15 мин | 1 мин … 1 ч (§4) |
| `GUEST_TTL` | 24 ч | 1 ч … 30 сут (§4) |
| `REFRESH_TOKEN_TTL` | 24 ч | ≤ `GUEST_TTL` (кросс-инвариант, REQ-ID-016) |
| `REFRESH_RATE_LIMIT` | 10/мин | ≥ 1/мин (§4 `login_rate_limit`) |
| `TRUST_PROXY` | false | bool |
| `CORS_ORIGINS` | [] | production + `*` → отказ старта (REQ-SEC-008) |

Следствие для существующих тестов: `JWT_SECRET` становится обязательным → health e2e (уже несущий placeholder `DATABASE_URL`) и другие точки boot'а AppModule получают тестовый секрет ≥32 байт. Это известная правка, включить в план.

## 8. Seed-скрипт

`scripts/create-room.ts` (запуск `pnpm create-room`), standalone Node-скрипт **без поднятия HTTP**, конструирует сервисы вручную по паттерну int-спек (`PrismaService` → `IdentityService`/`MembershipService`/`EventLogService`/`AppRegistryService`/`RoomService`):

1. Upsert служебного REGISTERED-организатора по email (аргумент/env) — прямой insert через Prisma, как `seedIdentity` в тестах; частичный уникальный индекс охраняет гонку.
2. `RoomService.create(organizerId, joinPolicy)` — живой путь: генерация кода, организаторская membership, lifecycle-эмит.
3. Печать кода комнаты и roomId.

Требование runtime: `DATABASE_URL` (+ валидный `JWT_SECRET` из-за единой схемы конфига — скрипт грузит тот же `loadConfig`).

## 9. Тестирование (TDD; контрактные первыми)

- **SDK contract:** fixtures + `.contract.spec.ts` для `joinRequestSchema`, `tokenResponseSchema`, расширенного реестра кодов; parity-тест версии (1.1.0).
- **Unit:** `TokenService` (claims-математика, TTL, reuse-detection, conditional-UPDATE гонка); sweep лимитера (Map с протухшими записями → `tryAcquire` → записей нет); фильтр (вся таблица §5; в теле ответа нет message/stack); config-схема (REFRESH ≤ GUEST_TTL; JWT_SECRET длина; production + wildcard CORS → отказ).
- **Integration (testcontainers):** `TokenService` против реальной БД — ротация с `replacedById`, reuse → revoke всего `familyId`, просрочка, инвалидация при терминальной комнате и анонимизированной identity; автотест наличия таблицы `identity."Session"` (по конвенции миграций репо).
- **HTTP e2e (`app.inject`, DB на testcontainer):** полный поток join → refresh → reuse-detect; неразличимость «неверный код» vs «закрытая политика» (одинаковые status+body, REQ-ID-013); 429 на join и refresh; атрибуты куки (httpOnly/Secure/SameSite/Path); наличие helmet-заголовков; CORS: разрешённый origin отражается, чужой — нет; **ни один ответ не содержит stack/message** (контракт REQ-SEC-006 на проводе); uuid-сырьё → `REQUEST_INVALID`.
- Для e2e в `apps/server` потребуется DB-backed инфраструктура — переиспользование `startTestDb` из `packages/core/src/testing` (экспортировать через barrel core — осознанное расширение пакетной границы, альтернатива «вторая инфраструктура в apps/server» отклонена в §0.5).

## 10. Швы (что этот срез оставляет следующим)

- **OAuth-срез:** `POST /rooms` + Google-флоу + REGISTERED-токены. Получает готовое: формат claims с веткой по `kind`, `TokenService.verify/issue`, таблицу сессий (REGISTERED-refresh без `roomId`-scope, TTL без guest-ограничения), фильтр и контроли. Изменение формата токена не требуется — только новая ветка выдачи.
- **Realtime-срез:** handshake по access JWT; actorId — только из claims (`sub`), не из payload (REQ-RT-009). Проекции appSettings (ADR-008) — следом.
- **Kind-флип (после первого события):** переиздание гостевой пары при привязке аккаунта (REQ-ID-004/017) — `familyId` механика уже на месте.
- **REQ-ID-010 (SHOULD):** регламентный sweep просроченных сессий — таблица готова (`expiresAt`, `revokedAt`), job не строится.
- **REQ-ID-019 (ф.4):** глобальный backoff — счётчиком на эндпоинте входа, без следов в схеме/контракте (амендмент v1.3); интерфейс лимитера его не блокирует.

## 11. Риски и принятые компромиссы

- **Access без revocation до 15 мин после завершения комнаты/исключения** — принято (§4); усиление = revocation-check по `sid` в guard'е, добавляется без смены формата токена.
- **`SESSION_INVALID` сливает reuse и expired** — осознанно (неразличимость отказов, как ID-013); серверный лог несёт различие для расследования.
- **Единый `RATE_LIMITED`** вместо per-endpoint кодов — клиенту достаточно 429 + Retry-логики; реестр кодов не пухнет.
- **HS256 (симметричный секрет)** — одна реплика, один сервис; RS256/ротация ключей — не MVP.
- **`Secure`-кука в dev** — выключается по `NODE_ENV`; e2e проверяет production-атрибуты через конфиг теста.
