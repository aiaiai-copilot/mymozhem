# Дизайн среза ADR-012 — zero-PII MVP (реализация)

**Дата:** 2026-10-12 (сессия 32)
**Статус:** утверждён владельцем в чате (посекционная презентация принята)
**Вход:** `docs/adr/adr-012-zero-pii-mvp.md` (принят 2026-10-12) + две карты кодовой базы (OAuth-контур/auth; join/свип/лотерея/web/ops), собранные разведкой этой сессии.
**Ветка:** `adr-012-zero-pii` (worktree `.worktrees/adr-012-zero-pii`, от локального `main` @ `d6a43d3`).

Срез реализует ADR-012 целиком: физическое удаление OAuth-контура, bootstrap организатора по setup-токену, псевдонимы участников, `prize_mode`-гейт с необязательным prizeId в `draw.run`, расширение TTL-свипа на joinIp/Exclusion, амендмент v1.5 к нормативному пакету. Юридический гейт для дефолтной конфигурации снят формулировкой ADR (самохост + псевдонимы + prize_mode:off).

---

## §0. Решения владельца (эта сессия)

1. **Псевдоним: «Лиса-42»** — словарь ~50 русских существительных (константа в core) + число 10–99; уникальность в комнате — retry генерации при коллизии с активным ростером.
2. **`organizer_setup_token` обязателен всегда**, ≥32 байта, fail-fast при старте (образец `JWT_SECRET`/REQ-SEC-002, цитированный ADR).
3. **`prize_mode=off`: гейтятся createPrize и draw.run с prizeId**; fulfill/revoke/list работают (урегулирование существующих awards, REQ-RWD-009).
4. **Безпризовой розыгрыш исключает прежних победителей** (ключ `prizeId ?? null`) — норма «не дважды одному» (D-12.2) сохраняется для «кто отвечает».
5. **SDK 2.0.0** — чистое удаление oauth-схем и 7 кодов ошибок (первый мажорный бамп).
6. **Verified-ветка лотереи удаляется физически**, `draw_eligibility` уходит из settings, манифест lottery **v2**.
7. **Google-креды: отозвать клиент в Google Cloud после мерджа** (действие владельца) + убрать из `.env`.

---

## §1. Амендмент v1.5 (задача T1)

Новый файл `docs/spec/amendment-v1.5-zero-pii.md` по образцу v1.3/v1.4:

- пометки «приостановлено (ADR-012)» у REQ-ID-004, REQ-ID-009, REQ-ID-015, REQ-ID-017 и verified-ветки REQ-RWD-014 (с фиксацией физического удаления ветки из кода; `guests_allowed` — единственное действующее значение до возврата аккаунтов);
- уточнение REQ-ID-003: имя гостя необязательно, псевдоним назначает сервер;
- §4 += параметры `organizer_setup_token` (обязательный, ≥32 байта) и `prize_mode` (`off | on`, дефолт `off`);
- маркер у REQ-ID-012 (переформулировка при фазовом проектировании ф.4 — админ = владелец self-hosted инстанса);
- фиксация удаления настройки `draw_eligibility` у лотереи и принятого эффекта пина манифеста (§7);
- маркер у REQ-ID-014: реализация свипа расширена (joinIp, Exclusion), текст нормы не меняется.

## §2. SDK 2.0.0 (задача T2)

- **Удаляется:** `packages/sdk/src/auth/oauth-start-query.ts`, `oauth-callback-query.ts`, `oauth-query.contract.spec.ts`; 7 кодов `OAUTH_*` из `CONTRACT_ERROR_CODES` (`error-codes.ts` + ожидания в `error-codes.contract.spec.ts`); barrel-экспорты в `index.ts`.
- **Добавляется:** коды `PRIZES_DISABLED` и `ORGANIZER_SETUP_INVALID`; схема `organizerBootstrapRequestSchema` (`strictObject({ setupToken: string })`); `joinRequestSchema.displayName` → `.optional()` (аддитивно); ответ join дополняется фактическим `displayName` (аддитивно — клиент сохраняет назначенный псевдоним для авто-rejoin; контрактные фикстуры join-request обновляются).
- Бамп `packages/sdk/package.json` + `contract-version.ts` → `2.0.0` (спека REQ-CTR-004 сверяет равенство).

## §3. Конфиг + миграция (задача T3)

- `packages/core/src/config/config.schema.ts`:
  - удалить `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, `OAUTH_REDIRECT_ALLOWLIST`, `OAUTH_STATE_TTL`, `OAUTH_RATE_LIMIT` и superRefine-блок Google-тройки (строки 57–75, 87–102 на момент дизайна);
  - добавить `ORGANIZER_SETUP_TOKEN: z.string().min(32)` — обязателен, без дефолта (старт без него невозможен, образец `JWT_SECRET`);
  - добавить `ORGANIZER_RATE_LIMIT` (coerce number, default 10);
  - добавить `PRIZE_MODE: z.enum(['off','on']).default('off')`;
  - синхронно `testing/test-config.ts` (TEST_CONFIG) и спеки `config.schema.spec.ts`.
- **Миграция** `drop_identity_provider`:
  - `DROP TABLE identity."IdentityProvider"`;
  - **новый частичный уникальный индекс** «один живой REGISTERED на инстанс»: `CREATE UNIQUE INDEX "Identity_single_registered_key" ON identity."Identity"(kind) WHERE kind = 'REGISTERED' AND "deletedAt" IS NULL`.
  - Основание: существующий `Identity_registered_email_key` построен по `lower(email)` — при `email = NULL` NULL-значения не конфликтуют, и единственность организатора без нового индекса не гарантирована (гонка двух bootstrap'ов создала бы двух REGISTERED). Вскрыто разведкой этой сессии.
  - Автотест наличия индекса — по прецеденту REQ-DEV-006 (SQL-миграция + int-спека, БЕЗ preview `partialIndexes`).
- `schema.prisma`: удалить `model IdentityProvider` и поле `Identity.providers`.

## §4. Удаление OAuth-контура (задача T4)

Инвентарь (карта разведки; пути на момент дизайна):

- `packages/core/src/oauth/**` — 8 файлов целиком (service, module, google-client, provider-client, errors, constants, 2 unit-спеки);
- `packages/core/src/transport/oauth.controller.ts` целиком (включая `mm_oauth_*` куки);
- `transport.module.ts`: импорт/подключение `OAuthModule`, `OAuthController`, провайдеры `OAUTH_START_RATE_LIMITER`/`OAUTH_CALLBACK_RATE_LIMITER`; `auth.tokens.ts`: оба символа (REFRESH-лимитер остаётся);
- `http-exception.filter.ts`: импорт `OAuthError`, 7 строк `STATUS_BY_WIRE_CODE`, ветки instanceof (+ соответствующие строки спека фильтра);
- `apps/server/test/oauth.e2e-spec.ts` целиком;
- `packages/core/src/identity/identity-provider-schema.int-spec.ts` и `identity-provisioning.int-spec.ts` целиком;
- `IdentityService.findOrCreateByProvider` (единственный потребитель — OAuth) и ссылки на `identityProvider` в `identity.service.ts`;
- barrel `packages/core/src/index.ts`: экспорты oauth-\*;
- web: якорь «Войти через Google» в `pages/landing.tsx` (заменяется в T9), комментарии `App.tsx`, `host-gate.tsx`, `host-session.ts`;
- `apps/web/e2e/smoke.spec.ts`: «Шаг 0» (OAuth 302 seam) — заменяется bootstrap-шагом в T9.
- Pino-спеки (`pino-options.spec.ts`) используют google-URL и `mm_oauth_state` как **фикстуры** redaction — фикстуры заменяются нейтральными эквивалентами, поведение и машинные пины тестов сохраняются; комментарии с упоминанием oauth в `pino-logger.module.ts`/`http.types.ts` чистятся.

Boundary-правила (`.dependency-cruiser.cjs`), eslint и guardrails-probes oauth не упоминают — изменений не требуется (проверено разведкой).

## §5. Bootstrap организатора (задача T5)

- **Endpoint:** `POST /auth/organizer` в `transport/auth.controller.ts` (рядом с refresh): zod-гейт тела (`organizerBootstrapRequestSchema`) → сравнение с `ORGANIZER_SETUP_TOKEN` через `crypto.timingSafeEqual` (по хэшированным/выравненным значениям, mismatch любого рода → одинаковый отказ) → `IdentityService.findOrCreateOrganizer()` → `TokenService.issueRegisteredTokens(identityId)` → `setRefreshCookie` + JSON `TokenResponse` (зеркало refresh-флоу, кука `mm_refresh`, path `/auth`, sameSite strict).
- **Identity:** новый метод `IdentityService.findOrCreateOrganizer()` — findFirst `{kind: 'REGISTERED', deletedAt: null}`, иначе INSERT `{kind: REGISTERED, email: null, displayName: 'Организатор'}`; гонка → P2002 от нового индекса → свежее чтение (прецедент `identity.service.ts`: catch P2002 ВНЕ `$transaction`). Инвариант трёх мест из комментария `identity.service.ts:30–32` схлопывается до двух (индекс + guarded insert; третье место — `findOrCreateByProvider` — удалено в T4).
- **Rate-limit:** свой лимитер по образцу `REFRESH_RATE_LIMITER` — новый символ `ORGANIZER_BOOTSTRAP_RATE_LIMITER` в `auth.tokens.ts`, фабрика `new JoinRateLimiter(config.ORGANIZER_RATE_LIMIT)` в `transport.module.ts`, per-IP, срабатывает ДО проверки токена (не даёт оракула «верный токен, но лимит»).
- **Ошибка:** неверный токен → `ORGANIZER_SETUP_INVALID` (401) — код в SDK (T2) и `STATUS_BY_WIRE_CODE`.
- **Тесты:** int — единственность организатора (параллельные bootstrap'ы → одна identity, race-path P2002), идемпотентность повторного вызова (та же identity, новая токен-пара); e2e — «setup-токен → создание комнаты» (полный путь организатора без OAuth); негативы: неверный токен → 401, лимитер → 429.

## §6. Псевдонимы (задача T6)

- **Генератор** `packages/core/src/membership/pseudonym.ts`: словарь-константа ~50 русских существительных + число; randomness — `crypto.randomInt` (не `Math.random` — дух REQ-RWD-011, lint-запрет формально покрывает только `packages/app-*`); сигнатура с инжектированным randomInt для детерминированных unit-тестов.
- **Уникальность в комнате:** до 5 попыток с проверкой по активному ростеру комнаты (memberships комнаты не soft-deleted → identity.displayName) в той же транзакции join; при исчерпании — расширение диапазона до 100–999. Гонка двух параллельных join на один псевдоним теоретически возможна (уникального индекса нет и не нужен) — безвредна (разные identityId), **принятый UX-риск**, фиксируется здесь.
- **Точка подключения:** `MembershipService.join` — `displayName` отсутствует → генерация; задан → прежний путь с `displayNameSchema`-валидацией (свободный ввод сохранён, ADR §«Отклонено»). `Identity.createGuest` не меняется (принимает готовое имя).
- **Тесты:** unit генератора (детерминизм, retry при коллизии, расширение диапазона); int — join без имени → псевдоним в ответе и ростере; уникальность среди активных; заданное имя не тронуто.

## §7. prize_mode + lottery v2 (задача T7)

- **Гейты — в сервисе, не контроллере** (ближе к домену; покрывает оба пути): `RewardsService.createPrize` и `RewardsService.awardPrize` (effect-путь) бросают `PrizesDisabledError` при `PRIZE_MODE=off`. Следствие: `draw.run` с prizeId при off откатывается целиком механизмом эффектов (эффекты исполняются в `outbox.run` до коммитов) — отдельный гейт в app-контракте не нужен. `fulfill`/`revoke`/`listAwards`/`listPrizes` не гейтятся (решение §0.3).
- `PrizesDisabledError` → wire `PRIZES_DISABLED`; статус 403 в `STATUS_BY_WIRE_CODE`.
- **Lottery v2** (`packages/app-lottery`):
  - `drawRunPayload.prizeId` → `z.uuid().optional()`; `drawCompletedPayload.prizeId` → `z.uuid().nullable()`;
  - настройка `draw_eligibility` и verified-ветка фильтра пула удаляются (решение §0.6);
  - winner-exclusion по ключу `prizeId ?? null`: победитель безпризового розыгрыша вне пула последующих безпризовых розыгрышей комнаты (решение §0.4);
  - эффект `award.prize` эмитится только при наличии prizeId; безпризовый draw — echo + `draw.completed` без эффекта;
  - идемпотентный replay переизлучает прежний результат с его (nullable) prizeId;
  - `LOTTERY_MANIFEST_VERSION = 2`.
- **Принятый эффект редеплоя:** ACTIVE-комнаты, запиненные на lottery@1, после выката недостижимы сервисным путём (boot-time реестр, прецедент ruling E-13.1). Для self-hosted MVP с одним живым событием приемлемо; фиксируется здесь и в амендменте v1.5. Quiz@2 не затронут.
- **Тесты:** unit/int гейтов (off → `PRIZES_DISABLED` на createPrize и на effect-пути; on → прежнее поведение); безпризовый draw (победитель зафиксирован, эффекта нет); winner-exclusion по null-ключу; replay идемпотентности с prizeId и без; обновление существующих спек handler/state/manifest.

## §8. Свип += joinIp/Exclusion (задача T8)

- В транзакцию анонимизации `GuestSweepService.sweepExpiredGuests` добавляются, по свипнутым identity: `membership.updateMany({ joinIp: null })` и `exclusion.deleteMany(...)`. Порядок — внутри той же tx, до коммита; re-check C-8.1 не затрагивается.
- Приостановка гардов (открытые awards, REQ-RWD-013) пропускает identity целиком — IP живёт ровно до свипа, не дольше.
- Снятие rejoin-блока после удаления Exclusion — осознанно (ADR §3: IP не живёт дольше события + guest_ttl).
- **Инвариант-тест:** «IP не живёт дольше события + guest_ttl» — после свипа joinIp обнулён, Exclusion удалена; запинается в `guest-sweep.int-spec.ts`. Существующие спеки, симулирующие свип вручную (`membership.service.int-spec.ts:296–302`), синхронизируются.

## §9. Web + ops + docs (задача T9)

- **Web:**
  - лендинг «Я организатор» → страница ввода setup-токена (password-input, `POST /auth/organizer` через `ApiClient`/`endpoints.ts`, auth:false; токен хранится только в state формы и не персистится — после протухания refresh вводится заново); `host-gate` без изменений (refresh-based);
  - join-form: имя необязательно (label/placeholder «необязательно»); фактический `displayName` из ответа join сохраняется в `SessionStore.saveGuest` (авто-rejoin использует его);
  - `winners.tsx`: `prizeId === null` → рендер без упоминания приза; `prizes-panel.tsx`: статичное предупреждение «призовой режим — юридическая ответственность организатора» (видно всегда — клиент режим не знает, серверный гейт честно отвечает `PRIZES_DISABLED`) + кнопка безпризового розыгрыша «Разыграть участника» (`draw.run` с `drawId`, без prizeId);
  - маппинг wire-кодов UX += `PRIZES_DISABLED`, `ORGANIZER_SETUP_INVALID`.
- **Smoke:** `apps/server/scripts/e2e-web-seed.mjs` переписывается на HTTP-вызов `POST /auth/organizer` (уходит ручное конструирование `TokenService` — закрывается старый workaround); «Шаг 0» `smoke.spec.ts` → bootstrap-шаг (вход setup-токеном вместо OAuth 302).
- **Ops:** `docker-compose.yml` — удалить OAuth-блок (строки 28–37), добавить `ORGANIZER_SETUP_TOKEN: ${ORGANIZER_SETUP_TOKEN:?ORGANIZER_SETUP_TOKEN is required (>=32 bytes)}` и `PRIZE_MODE: ${PRIZE_MODE:-off}`; `.env` — убрать Google-креды (отзыв клиента в Google Cloud — действие владельца после мерджа, §0.7).
- **Docs:** smoke-чеклист `docs/sessions/2026-09-23-ui-slice-smoke-checklist.md` — строки §0.1 и §1.1–1.3 переписаны под setup-токен (§0.2 про общую refresh-куку сохраняется); README — абзац self-hosted quickstart (setup-токен, prize_mode).

## §10. Батчи и критерии выхода

Исполнение — по правилу батчей: 3 задачи на сессию, каждый батч новой сессией, в конце среза финревью + HANDOFF.

- **Батч A (спека/контракт/фундамент):** T1 амендмент v1.5 · T2 SDK 2.0 · T3 конфиг+миграция
- **Батч B (ядро):** T4 OAuth-удаление · T5 bootstrap · T6 псевдонимы
- **Батч C (механики/клиент/ops):** T7 prize_mode + lottery v2 · T8 свип · T9 web+ops+docs

**Критерии выхода среза** (сверка exit-аудитом):

1. Grep по дереву не находит oauth-следов в коде и конфиге (`packages/core/src/oauth`, `OAUTH_*`, `GOOGLE_*`, `mm_oauth_*`, oauth-эндпоинты); CI-гейты (build → boundary-check, lint, typecheck, unit/int/e2e) зелёные.
2. Bootstrap: параллельные вызовы создают ровно одну REGISTERED-identity (индекс + int-спек); неверный токен → 401 `ORGANIZER_SETUP_INVALID`; лимитер → 429; e2e «setup-токен → создание комнаты» зелёный.
3. Гость без имени получает серверный псевдоним (виден в ответе join и ростере); свободный ввод имени сохранён; уникальность псевдонимов в комнате запинана тестом.
4. При `prize_mode=off` createPrize и draw.run с prizeId → `PRIZES_DISABLED`; безпризовый draw фиксирует победителя без эффекта и исключает его из последующих безпризовых пулов; fulfill/revoke существующих awards работают.
5. Свип обнуляет joinIp членств и удаляет Exclusion свипнутых identity — инвариант-тест зелёный; живой контур (joinIp до свипа, анти-накрутка, rejoin-блок) не ослаблен.
6. Амендмент v1.5 и обновлённый smoke-чеклист слиты; compose поднимается с новыми переменными без `GOOGLE_*`/`OAUTH_*`.

## §11. Что сознательно НЕ входит

- Переформулировка REQ-ID-012 (админ-контур) — фазовое проектирование ф.4 (нагрузочная часть), после первого живого события.
- Миграция play/screen на use-room-feed, eslint-plugin-react-hooks и прочие follow-up пакеты из HANDOFF — подбираются будущими планами явно, не этим срезом.
- Многоразовая ротация setup-токена, multi-organizer — отложены с аккаунтным контуром (триггеры пересмотра ADR-012).
- Смена позиционирования в README сверх абзаца quickstart — маркетинговый текст не гейтит срез.
