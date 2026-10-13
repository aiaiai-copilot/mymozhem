# Task 3 report — конфиг ADR-012

**Статус:** DONE · **Commit:** `5743300ef07665910f3baf47e605a3861fe15391`

## Что сделано

### `packages/core/src/config/config.schema.ts`
- Удалена OAuth/Google-секция ключей: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, `OAUTH_REDIRECT_ALLOWLIST`, `OAUTH_STATE_TTL`, `OAUTH_RATE_LIMIT` (бывшие строки 57–75, включая комментарий «REQ-ID-015/009: Google OAuth — опциональная секция»).
- Удалены оба Google-if в `superRefine` (all-or-none и allowlist-non-empty). CORS-ветка superRefine (REQ-SEC-008) не тронута.
- Добавлены сразу после `JWT_SECRET` (verbatim из брифа Step 3):
  - `ORGANIZER_SETUP_TOKEN: z.string().min(32)` — обязателен, без дефолта (образец REQ-SEC-002);
  - `ORGANIZER_RATE_LIMIT: z.coerce.number().int().min(1).default(10)` (REQ-SEC-007);
  - `PRIZE_MODE: z.enum(['off', 'on']).default('off')` (ADR-012 §4).

### `packages/core/src/testing/test-config.ts`
- Удалены `OAUTH_STATE_TTL`, `OAUTH_RATE_LIMIT`, `OAUTH_REDIRECT_ALLOWLIST` (и комментарий про Google-секцию).
- Добавлены `ORGANIZER_SETUP_TOKEN: 'test-only-organizer-setup-token!!'` (проверено: 33 символа ≥ 32, проходит `min(32)`), `ORGANIZER_RATE_LIMIT: 10`, `PRIZE_MODE: 'off'`.

### `packages/core/src/config/config.schema.spec.ts`
- Удалены 4 кейса Google-секции (absent-optional, all-or-none, allowlist-required, allowlist parsing).
- Добавлен `describe('ADR-012 параметры')` с 4 кейсами из брифа (required fail-fast, reject <32, defaults PRIZE_MODE=off / ORGANIZER_RATE_LIMIT=10, accepts PRIZE_MODE=on).
- Расширен существующий модульный хелпер `base` (строка 3) ключом `ORGANIZER_SETUP_TOKEN: 't'.repeat(32)` — параллельный хелпер не вводился (вариант «чище», предусмотренный брифом).
- Синхронно дополнены `ORGANIZER_SETUP_TOKEN` в кейс «rejects a missing JWT_SECRET» и в три inline-`envBase` (event emission ×2, reconnect ×2), которые используют `configSchema.parse` напрямую — иначе после обязательности ключа они падали бы не по своему ассерту.

## Red / Green evidence

**Red (после обновления спеки, до реализации):**
```
FAIL src/config/config.schema.spec.ts
  ● Test suite failed to run
    TS2339: Property 'PRIZE_MODE' does not exist on type ... (строки 101, 107)
    TS2339: Property 'ORGANIZER_RATE_LIMIT' does not exist on type ... (строка 102)
Test Suites: 1 failed, 1 total
```
Ожидаемый красный из брифа («ORGANIZER_SETUP_TOKEN неизвестен схеме») проявился на уровне компиляции спеки: новые свойства отсутствуют в `AppConfig`.

**Green (после реализации):**
```
Test Suites: 1 passed, 1 total
Tests:       26 passed, 26 total
```
Все 4 кейса `ADR-012 параметры` зелёные; остальные 22 кейса (включая CORS superRefine и §4-дефолты) без изменений поведения.

## Step 5 — grep-инвентарь каскада

`grep -rn 'OAUTH_\|GOOGLE_' packages/core/src apps/server/src apps/server/test` — все попадания в инвентаре T4:

- `packages/core/src/oauth/**` (oauth.constants, oauth.module, oauth.service(.spec), google-oauth.client(.spec), oauth.errors, oauth-provider.client) — в инвентаре;
- `packages/core/src/transport/oauth.controller.ts`, `transport.module.ts` (фабрики OAUTH-лимитеров), `http-exception.filter.ts` + `.spec` — в инвентаре;
- `packages/core/src/index.ts` (export OAUTH_PROVIDER_CLIENT) — в инвентаре (oauth exports);
- `packages/core/src/transport/auth.tokens.ts` — только объявления символов `OAUTH_START_RATE_LIMITER`/`OAUTH_CALLBACK_RATE_LIMITER`, потребляемые инвентарными файлами (transport.module, oauth.controller); сам файл не ссылается на удалённые конфиг-ключи и не является красным — компилируется. Считаю покрытым инвентарем через transport.module/oauth.controller.
- `apps/server/test/oauth.e2e-spec.ts` — в инвентаре.

Попаданий вне инвентаря T4 нет. Эскалация не требуется.

## Typecheck — список красных файлов (ожидаемо красный до T4)

`pnpm typecheck` (только @mymozhem/core упал; зависимые задачи turbo не дошли):

- `src/oauth/google-oauth.client.ts` (3 ошибки TS2339: GOOGLE_CLIENT_ID/SECRET, OAUTH_REDIRECT_URI)
- `src/oauth/oauth.service.ts` (4 ошибки TS2339: GOOGLE_*/OAUTH_REDIRECT_*)
- `src/transport/oauth.controller.ts` (TS2305: sdk больше не экспортирует oauth*QuerySchema — красное ещё с T1; TS2339: OAUTH_STATE_TTL)
- `src/transport/transport.module.ts` (2× TS2339: OAUTH_RATE_LIMIT)
- `src/transport/join.controller.ts` (TS2322 displayName — принятое красное T2, ruling T2.1)

Все красные файлы — известный инвентарь T4 + принятое T2. Нового красного вне инвентаря не появилось.

## Отклонения от брифа

1. Кейс «requires ORGANIZER_SETUP_TOKEN» строит env явно (`{ DATABASE_URL, JWT_SECRET }`) вместо деструктурирования с `_drop` — локальная идиома спеки (так же написан соседний кейс про JWT_SECRET) и без unused-var. Поведение теста идентично брифу.
2. `ORGANIZER_SETUP_TOKEN` добавлен в три inline-`envBase` спеки (event emission, reconnect) — следствие обязательности ключа; бриф это не оговаривал, но без этого зелёный прогон невозможен.

## Concerns

- `apps/server` typecheck в этом прогоне не выполнялся (turbo остановился на core). Его красное состояние (oauth.e2e-spec, main.ts если ссылается) подтверждено grep'ом и входит в инвентарь T4 — но полный красный список apps/server будет виден только после T4.
