# Дизайн: OAuth-срез — Google login + POST /rooms + REGISTERED-токены

**Дата:** 2026-09-02
**Статус:** утверждён владельцем по секциям (§0–§3 в диалоге; §4+ — делегировано «на усмотрение», см. §0)
**Вход:** HANDOFF.md «Следующее действие» (решение владельца 2026-09-02); superpowers:brainstorming, путь architectural
**Источник истины:** `docs/spec/normative-package-v1.2.md` + `docs/spec/amendment-v1.3-phase-remapping.md`

---

## §0. Решения владельца (brainstorm 2026-09-02)

1. **Объём — база:** Google login (provisioning REGISTERED + выдача токенов) → `POST /rooms` (guard по access JWT, только REGISTERED) → фикс `sessionExpiry`. Без logout, без kind-флипа (REQ-ID-004/017 отложены амендментом v1.3 «после первого события»), без UI.
2. **Provider-данные — отдельная таблица** `identity."IdentityProvider"`, unique(provider, subject). НЕ поля на Identity.
3. **Email-политика — fail-closed, без автолинка:** логин только по `(provider, sub)`; email пишется один раз при создании и только при `email_verified=true`; конфликт с существующим REGISTERED-email → типизированный отказ; автоматического связывания аккаунтов по email НЕТ; повторные логины email не трогают.
4. **State — double-submit httpOnly cookie + PKCE (S256)**, НЕ серверное хранилище (REQ-ID-009 допускает обе формы).
5. **Google-креды — опциональная секция конфига**; без неё приложение бутится, эндпоинты `/auth/google*` отдают типизированный отказ (fail-closed). НЕ обязательные при boot.
6. **Подход A — handrolled OAuth-модуль с портом провайдера** (`OAuthProviderClient` + `GoogleOAuthClient`). Отклонены: B (nestjs/passport — первая passport-зависимость, магия Guard'ов, шов подмены хуже) и C (всё в transport без порта — Google неподменяем в тестах, шов под второй провайдер не появляется).
7. **§4 дизайна и далее** — делегированы агенту («всё, что дальше по OAuth — на твоё усмотрение»).

## §1. Объём и закрываемые требования

- **REQ-ID-015 (MUST)** — регистрация REGISTERED через Google; provider-данные в отдельной таблице, под PII (REQ-SEC-004).
- **REQ-ID-009 (MUST)** — `state` с одноразовым nonce (double-submit httpOnly cookie), redirect-цель по allowlist.
- **REQ-SEC-007 (MUST, часть)** — собственные rate-limits на `/auth/google` и `/auth/google/callback` (значение `login_rate_limit`, §4 пакета).
- **REQ-ID-005 (MUST, HTTP-путь)** — организатор только REGISTERED: `POST /rooms` отклоняет GUEST до домена.
- **REQ-ID-016/007/008 (MUST, REGISTERED-ветка)** — единый токен-механизм: access JWT + httpOnly refresh, хэшированное хранение, ротация; REGISTERED без roomId-scope и без guest-cap.
- **REQ-OPS-003 (MUST, расширение)** — новые параметры в единой zod-схеме конфига, инвариант all-or-none для Google-секции.
- **Follow-up из HANDOFF:** `TokenService.sessionExpiry()` применяет guest-cap безусловно — REGISTERED-ротация не должна его наследовать (закрывается §5, включая куку).

**Вне объёма:** kind-флип (REQ-ID-004/017), logout, второй провайдер, веб-клиент, REQ-ID-010 (sweep сессий), анонимизация REGISTERED, idempotency/rate-limit создания комнат.

## §2. Архитектура и компоненты

**Новый подмодуль `core/src/oauth/`:**
- `oauth-provider.client.ts` — порт: `interface OAuthProviderClient { exchangeCode(code: string, pkceVerifier: string): Promise<ProviderProfile> }`; `ProviderProfile = { subject, email, emailVerified, displayName? }`. DI-токен `OAUTH_PROVIDER_CLIENT` (Symbol, прецедент `REFRESH_RATE_LIMITER`).
- `google-oauth.client.ts` — единственный файл с сетевым кодом Google: POST на token-endpoint (code + verifier + client_secret), чтение userinfo. Привязан к `OAUTH_PROVIDER_CLIENT` всегда; конфиг читает лениво — отсутствие кредов отсекает `OAuthService` раньше.
- `oauth.service.ts` — оркестрация: `start(redirect?)` → `{ authorizeUrl, cookies }`; `complete({code, state, cookies})` → `{ identity, tokens, redirectTarget }`. Без состояния процесса (REQ-CORE-004) — nonce/PKCE/redirect живут в куках.
- `oauth.errors.ts` — `OAuthError extends Error` с `code` (паттерн `AuthError`).

**Касания существующих модулей:**
- `identity`: `IdentityService.findOrCreateByProvider(...)` + Prisma `IdentityProvider` + новая миграция.
- `auth`: `TokenService.issueRegisteredTokens(identityId)`; `sessionExpiry(kind)`; `IssuedTokens.kind`.
- `transport`: `oauth.controller.ts` + `rooms.controller.ts`; общий `authenticate(req)` выносится из `ExcludeController` в `transport/authenticate.ts` (второй потребитель паттерна); `setRefreshCookie` получает `kind`.
- `transport/http-exception.filter.ts`: ветка `OAuthError` (per-code маппинг) и ветка `RoomError` (частичная таблица, fallback INTERNAL_ERROR) — `RoomError` сейчас вообще не покрыт фильтром, `POST /rooms` делает его достижимым по HTTP впервые.

**SDK:** `createRoomRequestSchema`/`createRoomResponseSchema` (+ `roomStatusSchema`), `oauthStartQuerySchema`, новые wire-коды в `CONTRACT_ERROR_CODES`; версия контракта 1.3.0 → **1.4.0** (аддитивно, minor) с parity-тестом.

**Конфиг:** §8.

## §3. OAuth-флоу

**`GET /auth/google?redirect=<url>`**
1. Rate-limit per IP — свой инстанс лимитера (REQ-SEC-007).
2. `redirect` валидируется по `OAUTH_REDIRECT_ALLOWLIST` (точное совпадение URL); невалиден → `OAUTH_REDIRECT_INVALID`. Отсутствует → первый элемент allowlist (дефолт).
3. Генерация: `nonce` (32 байта base64url), PKCE `verifier` + `challenge` (S256).
4. Три httpOnly-куки, TTL `OAUTH_STATE_TTL`, `Path=/auth`, **`SameSite=Lax`** (не Strict: браузер обязан прислать их на возврате с Google — top-level GET-навигация; осознанное отличие от refresh-куки), `Secure` по `NODE_ENV`:
   - `mm_oauth_state` = nonce (double-submit),
   - `mm_oauth_pkce` = verifier,
   - `mm_oauth_redirect` = валидированная цель (не протаскиваем её через state без подписи).
5. 302 на Google authorize: `client_id`, `redirect_uri` (конфиг), `scope=openid email profile`, `state=nonce`, `code_challenge`, `code_challenge_method=S256`.

**`GET /auth/google/callback?code&state`**
1. Rate-limit per IP — отдельный инстанс (REQ-SEC-007 называет OAuth callback явно).
2. `error` в query (отказ пользователя) → `OAUTH_ACCESS_DENIED`.
3. Сверка `state` с `mm_oauth_state`: нет куки / не совпал → `OAUTH_STATE_INVALID`. Куки `mm_oauth_*` гасятся при любом исходе (одноразовость).
4. `exchangeCode(code, verifier)` → profile; сбой → `OAUTH_EXCHANGE_FAILED` (детали — server-лог).
5. `emailVerified !== true` → `OAUTH_EMAIL_UNVERIFIED` (решение §0.3).
6. `findOrCreateByProvider(...)` → identity; конфликт → `OAUTH_EMAIL_CONFLICT`.
7. `issueRegisteredTokens(identity.id)` → refresh-кука (`kind='REGISTERED'`), oauth-куки очищены.
8. **302 на `mm_oauth_redirect`.** Access-токен в URL не попадает (REQ-ID-008): клиент после лендинга вызывает существующий `POST /auth/refresh` — нового способа доставки не появляется.

Ошибки callback'а — typed JSON `{code}` (веб-клиента нет; когда появится, retry — его забота).

## §4. Модель данных и provisioning

**Prisma (новая миграция; замороженные не трогаем):**
```prisma
model IdentityProvider {
  id         String   @id @default(uuid()) @db.Uuid
  identityId String   @db.Uuid
  provider   String   // 'google'; enum не вводим — второй провайдер = данные
  subject    String
  email      String?  // snapshot на момент привязки (PII, REQ-SEC-004)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  identity   Identity @relation(fields: [identityId], references: [id], onDelete: Restrict)
  @@unique([provider, subject])
  @@index([identityId])
  @@schema("identity")
}
```
`onDelete: Restrict` — как у прочих identity-связей: удаления нет, есть анонимизация (REQ-ID-014). Чистка provider-строки при анонимизации REGISTERED — шов (§10), сейчас ни один поток не анонимизирует REGISTERED.

**`IdentityService.findOrCreateByProvider({provider, subject, email, displayName?})`:**
1. Строка по `(provider, subject)` найдена → возврат identity; `deletedAt != null` → fail-closed typed-ошибка (сейчас недостижимо, гейт дешёвый). Email не трогаем.
2. Не найдена → email-конфликт: существует `REGISTERED AND deletedAt IS NULL AND lower(email) = lower(profile.email)` → `OAUTH_EMAIL_CONFLICT`. Никакого автолинка (решение §0.3 — вектор захвата).
3. Иначе одной транзакцией: create `Identity { kind: REGISTERED, email, displayName }` + create `IdentityProvider`.
4. Гонка двух первых логинов одного Google-аккаунта: проигравший ловит unique-violation `(provider, subject)` → повторный поиск и логин (матчинг P2002 по прецеденту `isRoomCodeCollision`).

**displayName:** Google `name` прогоняется через `displayNameSchema`; не прошёл → `null` (логин не ломается из-за косметики; поле nullable).

**Инвариант «change both or neither» расширяется до трёх мест:** предикат `kind='REGISTERED' AND deletedAt IS NULL` — partial index `"Identity_registered_email_key"`, guarded INSERT `RoomService.create`, email-конфликт-проверка здесь. Фиксируется комментариями во всех трёх и в HANDOFF при мердже.

## §5. Токены: REGISTERED-выдача и фикс guest-cap

- **`sessionExpiry(kind: 'GUEST' | 'REGISTERED')`:** GUEST → `min(REFRESH_TOKEN_TTL, GUEST_TTL)`; REGISTERED → `REFRESH_TOKEN_TTL`. Применяется в `issueGuestTokens` ('GUEST'), `issueRegisteredTokens` и `rotate` (kind из identity) — закрывает follow-up HANDOFF полностью, включая ротацию.
- **`issueRegisteredTokens(identityId)`:** create Session (expiresAt без guest-cap), access claims `{sub, sid, kind:'REGISTERED'}` без `roomId`.
- **`IssuedTokens` получает `kind`** — контроллеры передают его в куку-хелпер.
- **`setRefreshCookie(reply, token, config, kind)`:** `maxAge` = GUEST → `min(REFRESH, GUEST_TTL)`, REGISTERED → `REFRESH_TOKEN_TTL`. Тот же инвариант, что `sessionExpiry`, — одна норма в двух местах (сессия и кука), менять вместе.
- **Конфиг-инвариант пересматривается (§8):** текущий superRefine `REFRESH_TOKEN_TTL ≤ GUEST_TTL` — та же конфляция, что баг в `sessionExpiry`: он глобально запрещает REGISTERED-refresh жить дольше guest_ttl, хотя REQ-ID-016/OPS-003 ограничивают только **гостевой** refresh. Гостевой cap остаётся структурно гарантированным в точках использования (`sessionExpiry('GUEST')` + cookie maxAge).

## §6. POST /rooms

- `POST /rooms`, Bearer auth через общий `authenticate(req)` (вынос из `ExcludeController`).
- `claims.kind !== 'REGISTERED'` → `RoomOrganizerNotRegisteredError` ДО домена (REQ-ID-005; код уже существует как core-internal; фильтр получает маппинг, §7). Это первый HTTP-путь `RoomError`.
- Body: `createRoomRequestSchema = strictObject({ joinPolicy: roomJoinPolicySchema.default('guests') })`; пустое тело → дефолт (`body ?? {}`, прецедент Exclude).
- `RoomService.create(claims.sub, joinPolicy)` — существующий живой путь (генерация кода, организаторская membership, lifecycle-эмит).
- **201** `createRoomResponseSchema = strictObject({ roomId: z.uuid(), code, joinPolicy: roomJoinPolicySchema, status: roomStatusSchema })`. `roomStatusSchema = z.enum(['DRAFT','ACTIVE','COMPLETED','CANCELLED'])` — новая в SDK (wire-форма принадлежит контракту; core-тип `RoomStatus` остаётся, сервис кастует на границе как сейчас).
- **Без идемпотентности и dedicated rate-limit** — REQ-SEC-007 создание комнат не называет; дабл-клик организатора порождает лишнюю DRAFT-комнату, безвредно на MVP. Шов §10.

## §7. Ошибки и wire-коды

Новые коды в `CONTRACT_ERROR_CODES` (аддитивно):

| Wire-код | HTTP | Когда |
|---|---|---|
| `OAUTH_NOT_CONFIGURED` | 503 | Google-секция конфига отсутствует |
| `OAUTH_REDIRECT_INVALID` | 400 | redirect вне allowlist |
| `OAUTH_STATE_INVALID` | 401 | state/кука отсутствует или не совпала |
| `OAUTH_ACCESS_DENIED` | 403 | `error` в query — пользователь отказал на стороне Google |
| `OAUTH_EXCHANGE_FAILED` | 502 | сбой обмена кода/userinfo |
| `OAUTH_EMAIL_UNVERIFIED` | 403 | `email_verified !== true` |
| `OAUTH_EMAIL_CONFLICT` | 409 | email занят другим REGISTERED |
| `ROOM_ORGANIZER_NOT_REGISTERED` | 403 | GUEST (или не-REGISTERED) на `POST /rooms` |

Фильтр: ветка `OAuthError` — per-code маппинг (НЕ схлопываем, как SESSION_INVALID: оракула перебора здесь нет, различимость кодов — для отладки; server-лог несёт message по прецеденту AuthError-warn). Ветка `RoomError` — таблица `{ROOM_ORGANIZER_NOT_REGISTERED: 403}`, прочие коды → `INTERNAL_ERROR` (недостижимы по HTTP в этом срезе; расширение таблицы — вместе со следующими room-эндпоинтами). Наружу ровно `{code}` (REQ-SEC-006), strictObject-контракт не меняется.

## §8. Конфигурация (REQ-OPS-003, единая zod-схема)

Новые параметры:
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — опциональные, **all-or-none** (superRefine); вместе с ними обязательны `OAUTH_REDIRECT_URI` (валидный URL) и непустой `OAUTH_REDIRECT_ALLOWLIST`.
- `OAUTH_REDIRECT_URI` — callback-URL, зарегистрированный у Google.
- `OAUTH_REDIRECT_ALLOWLIST` — comma-list URL (трансформ как `CORS_ORIGINS`); точное совпадение, первый элемент — дефолтная цель.
- `OAUTH_STATE_TTL` — секунды, дефолт 600, диапазон 60…1800 (кандидат в §4 пакета при следующей правке пакета).
- `OAUTH_RATE_LIMIT` — 10/мин на IP (§4 `login_rate_limit`); два инстанса лимитера (start/callback), не делят состояние с join/refresh.
- **`REFRESH_TOKEN_TTL` — пересмотр:** диапазон приводится к §4 пакета (1…90 сут, дефолт 30 сут = 2 592 000), superRefine `REFRESH ≤ GUEST_TTL` **снимается** (обоснование §5: инвариант — про гостевой refresh, он гарантирован структурно в точках использования). Существующие конфиг-спеки, ассертящие старый инвариант/дефолт, правятся — известная правка, как `JWT_SECRET` в транспортном срезе.

## §9. Тестирование (TDD; контрактные первыми)

- **SDK contract:** fixtures (valid/invalid) для `createRoomRequestSchema`/`createRoomResponseSchema`/`oauthStartQuerySchema`; расширенный реестр кодов; parity-тест версии 1.4.0 (SDK package.json = CONTRACT_VERSION).
- **Unit:** `OAuthService` — генерация nonce/PKCE (S256-математика), набор и очистка кук, валидация allowlist (точное совпадение, дефолт, отказ); `sessionExpiry(kind)` обе ветки; `setRefreshCookie` maxAge по kind; displayName-fallback (невалидное Google-имя → null); конфиг-схема — all-or-none Google, allowlist обязателен при кредах, новый диапазон REFRESH_TOKEN_TTL, снятие старого superRefine; `GoogleOAuthClient` — формирование запроса и разбор ответа (fetch подменён).
- **Integration (testcontainers):** provisioning — создание, повторный логин (та же identity, email не перезаписан), email-конфликт (seed REGISTERED с тем же email → `OAUTH_EMAIL_CONFLICT`), гонка двух первых логинов одного sub → одна identity; автотест наличия таблицы `identity."IdentityProvider"` + unique(provider,subject) (конвенция миграций); `TokenService` — REGISTERED issue/rotate с TTL > GUEST_TTL (гостевой cap не наследуется), rotate сохраняет отсутствие roomId.
- **HTTP e2e (`app.inject`, DB на testcontainer, `FakeOAuthProviderClient` через override `OAUTH_PROVIDER_CLIENT`):** полный флоу на проводе start → callback → 302 на allowlisted redirect + refresh-кука → `POST /auth/refresh` → access (kind REGISTERED, без roomId) → `POST /rooms` → 201 + код; негативные: state mismatch, нет state-куки, redirect вне allowlist, `error=access_denied`, exchange-fail (фейк бросает), unverified email, email-конфликт, модуль без Google-секции → `OAUTH_NOT_CONFIGURED`; GUEST-токен на `POST /rooms` → 403 `ROOM_ORGANIZER_NOT_REGISTERED`; без токена → 401; атрибуты oauth-кук (httpOnly, SameSite=Lax, Path=/auth, Secure при production-конфиге); refresh-кука REGISTERED — maxAge ≈ REFRESH_TOKEN_TTL, без guest-cap; ни один ответ не несёт message/stack (REQ-SEC-006 на проводе).

## §10. Швы (что срез оставляет следующим)

- **Kind-флип (REQ-ID-004/017, «после первого события»):** `familyId`-механика и provider-таблица готовы; привязка = добавление строки `IdentityProvider` + flip kind + переиздание.
- **Второй провайдер:** порт `OAuthProviderClient` + данные (`provider` — строка), без миграции схемы.
- **Logout:** revoke семейства + сброс куки — таблица сессий готова (`revokedAt`).
- **Анонимизация REGISTERED / чистка IdentityProvider:** потока нет; при появлении — provider-строка чистится вместе с PII identity.
- **Создание комнат:** idempotency-key и per-identity rate-limit — при реальном злоупотреблении.
- **REQ-ID-010 (SHOULD):** sweep просроченных сессий — по-прежнему открыт.
- **Веб-клиент:** дефолтная redirect-цель и CORS/credentials — со срезом клиента.
- **Ручной смоук с реальными Google-кредами** — перед первым живым событием (e2e гоняет фейк).

## §11. Риски и принятые компромиссы

- **Дефолт `REFRESH_TOKEN_TTL` вырастает 1 сут → 30 сут** (приведение к §4): окно кражи REGISTERED-refresh длиннее; митигация — ротация + reuse-detection уже на месте (REQ-ID-007), причём для REGISTERED впервые по-настоящему работающие (раньше cap делал 30-суточный дефолт недостижимым).
- **`SameSite=Lax` на oauth-куках** — необходимость редирект-возврата; CSRF-поверхность закрывается самим double-submit nonce.
- **OAuth wire-коды различимы снаружи** (не схлопнуты как SESSION_INVALID) — оракула перебора нет; если появится злоупотребление, схлопывание — конфигурация фильтра, не контракта.
- **`RoomError` покрыт фильтром частично** — недостижимые по HTTP коды падают в INTERNAL_ERROR 500; расширение таблицы — с новыми room-эндпоинтами.
- **`POST /rooms` без идемпотентности** — лишняя DRAFT-комната при ретрае, безвредно.
- **e2e — против фейка провайдера:** форма запроса к Google покрыта unit'ами `GoogleOAuthClient`, но живой обмен не проверен до ручного смоука (шов §10).
