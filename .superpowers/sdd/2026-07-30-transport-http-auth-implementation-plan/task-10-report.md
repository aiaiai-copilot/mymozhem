# Task 10 report: HTTP e2e — полный поток на testcontainer-БД

**Commit:** `a6bb3adec1d9b6ca01550b16b040e5e645a4cf7a` (branch `phase-1-transport-http-auth`)
**Status:** DONE_WITH_CONCERNS (один concern — см. §4.3, не блокер)

## 1. Что сделано

- `packages/core/src/index.ts` — barrel расширен тремя testing-экспортами (`testing/postgres.testcontainer`, `testing/seed-identity`, `testing/test-config`) с комментарием об осознанности (design §9).
- `apps/server/package.json` — добавлены devDeps `testcontainers@^12.0.4`, `@testcontainers/postgresql@^12.0.4` (версии выровнены с packages/core, один lockfile — `pnpm-lock.yaml` в коммите); добавлен dep `@mymozhem/sdk@workspace:*` (см. §4.1); test-скрипт получил `NODE_OPTIONS=--experimental-vm-modules` (см. §4.2).
- `apps/server/test/transport.e2e-spec.ts` — новый e2e-спек: один `startTestDb()` на файл (beforeAll, `jest.setTimeout(120_000)`), app пересобирается per describe с env-override'ами, посев комнат через вручную сконструированные core-сервисы (зеркало `membership.service.int-spec.ts` / `token.service.int-spec.ts`), TRUNCATE `identity."Session", membership."Membership", room."Room" CASCADE` между тестами (ORG-identity посеяна один раз на файл и не трогается). Boot-помощник `createApp()` зеркалит `main.ts`: `@fastify/cookie` + `@fastify/helmet` + `@fastify/cors` (origin из `loadConfig(process.env)`), env-override'ы выставляются до `compile()` и восстанавливаются в `finally` после `app.init()` — конфиг и лимитеры запечатывают значения при boot.

## 2. 12 кейсов → REQ-ID

| # | Кейс | REQ | Статус |
|---|------|-----|--------|
| 1 | join happy: 201 (осознанный пин, Nest default для POST), тело парсится `tokenResponseSchema` (SDK), set-cookie содержит `mm_refresh=`/`HttpOnly`/`SameSite=Strict`/`Path=/auth` и НЕ содержит `Secure` (non-production), access verify → `{kind:'GUEST', roomId}` | REQ-ID-003/008/016, REQ-SEC-006 | ✓ |
| 2 | неверный код → 403, тело `toEqual({code:'ROOM_JOIN_DENIED'})` — ровно `{code}`, без message/stack | REQ-SEC-006 | ✓ |
| 3 | закрытая политика `registered` → `statusCode` и `body` идентичны неверному коду (сравнение сырых тел — байт-в-байт) | REQ-ID-013 | ✓ |
| 4 | невалидное тело (`{code}` без displayName) → 400 `{code:'REQUEST_INVALID'}` | REQ-SEC-006 | ✓ |
| 5 | boot с `JOIN_RATE_LIMIT_IP=2` → третий join → 429 `{code:'RATE_LIMITED'}` | REQ-ID-006 | ✓ |
| 6 | boot с `ROOM_PARTICIPANT_LIMIT=1` → второй гость → 409 `{code:'ROOM_PARTICIPANT_LIMIT_REACHED'}` | REQ-ID-006 | ✓ |
| 7 | refresh happy: 200 (осознанный пин `@HttpCode(200)`), новая кука ≠ старой; повтор СТАРОГО → 401; НОВЫЙ после reuse → тоже 401 (ревок семейства сквозь провод) | REQ-ID-007/008 | ✓ |
| 8 | refresh без куки → 401 `{code:'SESSION_INVALID'}` | REQ-ID-008 | ✓ |
| 9 | boot с `REFRESH_RATE_LIMIT=1` → второй refresh → 429 `{code:'RATE_LIMITED'}` | REQ-SEC-007 | ✓ |
| 10 | helmet: ответ join содержит `x-dns-prefetch-control: off` | REQ-SEC-008 | ✓ |
| 11 | CORS: origin `https://evil.example` при пустом allowlist → нет `access-control-allow-origin` (запрос при этом проходит — CORS не блокирует, не выдаёт заголовки); boot с `CORS_ORIGINS=https://ok.example` + этот origin → заголовок есть | REQ-SEC-008 | ✓ |
| 12 | терминальная комната: join → `RoomService.cancel` → refresh → 401 | REQ-ID-016 | ✓ |

Кука между запросами передаётся вручную (`res.cookies` → заголовок `cookie`), как предписано брифом.

## 3. Команды и вывод

`pnpm build` — 3/3 successful. `pnpm --filter @mymozhem/server test`:

```
PASS test/transport.e2e-spec.ts (12.351 s)
PASS test/health.e2e-spec.ts
Test Suites: 2 passed, 2 total
Tests:       15 passed, 15 total
```

Verbose-прогон спека: все 12 `it` — ✓ (по одному на обязательный кейс).
Дополнительно: `pnpm --filter @mymozhem/server typecheck` ✓, `lint` (server + core) ✓, `pnpm boundary-check` ✓ (312 modules, 0 violations).

## 4. Девиации от брифа

1. **`@mymozhem/sdk` добавлен в dependencies apps/server** (бриф упоминал только devDeps). Причина: спек импортирует `tokenResponseSchema` из SDK напрямую; pnpm не резолвит транзитивные зависимости (sdk был только у core). Сервер говорит контрактом SDK — прямая зависимость семантически корректна, не только тестова.
2. **`"test": "NODE_OPTIONS=--experimental-vm-modules jest"`** в apps/server. Причина: `@fastify/cookie@11` грузит ESM-only `cookie@^2` через динамический `import()` из CJS — под CJS-рантаймом jest это падает с «A dynamic import callback was invoked without --experimental-vm-modules» ещё на регистрации плагина. Флаг в env при ручном прогоне не вариант (воспроизводимость для CI/следующих сессий); jest-конфигом NODE_OPTIONS не выставить. Без флага health-спек продолжает проходить, с флагом — оба спека зелёные.
3. **Кейс 12: комната переведена в терминальный статус через `RoomService.cancel` (DRAFT→CANCELLED), не COMPLETED.** Причина: DRAFT→COMPLETED отсутствует в `ROOM_TRANSITIONS` (DRAFT → ACTIVE/CANCELLED; COMPLETED достижим только из ACTIVE, а activate требует configure + манифест). `TokenService.rotate` проверяет оба терминальных статуса, `token.service.int-spec.ts` использует тот же приём с тем же обоснованием — поведение по REQ-ID-016 покрыто. В спеке это задокументировано комментарием.
4. **Тип ответа inject** взят как `Awaited<ReturnType<NestFastifyApplication['inject']>>` вместо импорта `LightMyRequestResponse` из `fastify` — fastify не прямая зависимость apps/server, pnpm его не резолвит.

## 5. Self-review

- Статусы 201/200 запинены осознанно и прокомментированы (Nest default для POST vs `@HttpCode(200)`).
- Тела ошибок проверяются `toEqual` (ровно `{code}`, лишние ключи ловятся), неразличимость — сравнением сырых `body` строк.
- Кейс 3 честный: `joinPolicy` ставится прямым prisma-update (как в membership int-spec) — тестируется провод, не сервисный уровень.
- Rate-limit-кейсы изолированы per-describe пересборкой app (лимитеры in-memory, свежий app = свежий лимитер); в дефолтном app суммарно ≤7 join-попыток и ≤5 refresh с одного IP — под лимитами 20/10, флак от пересечения окон исключён в пределах прогона.
- `identity."Identity"` в TRUNCATE не входит сознательно: ORG посеян один раз; список TRUNCATE зеркалит token int-spec.
- Env (`DATABASE_URL`, `JWT_SECRET`) сохранён/восстановлен на уровне файла; per-describe override'ы — в `finally` помощника.
- Concern (не блокер): `--experimental-vm-modules` — экспериментальный флаг; при апгрейде jest 30 / переезде @fastify/cookie на `require(ESM)` (TODO в их коде, Node 24 это умеет) стоит пересмотреть. Зафиксировано здесь для Task 12/HANDOFF.
