# Task 2 report — SDK contract 2.0.0 (ADR-012)

**Status: BLOCKED** — по стоп-условию Step 5 (красное вне инвентаря T4). Работа по брифу полностью выполнена, SDK зелёный, коммит НЕ сделан (остановка по инструкции до решения владельца/оркестратора). Дерево изменений лежит незакоммиченным в worktree.

## Что сделано (по брифу, verbatim)

- **Deleted** (через `git rm`): `packages/sdk/src/auth/oauth-start-query.ts`, `oauth-callback-query.ts`, `oauth-query.contract.spec.ts`.
- **`errors/error-codes.ts`**: удалён блок «OAuth-срез (REQ-ID-015/009…)» + 7 кодов `OAUTH_*`; добавлены после блока `ROOM_ORGANIZER_NOT_REGISTERED`/`ACTOR_NOT_MEMBER`:
  ```ts
  // ADR-012 (срез zero-PII): bootstrap организатора и призовой режим.
  'ORGANIZER_SETUP_INVALID',
  'PRIZES_DISABLED',
  ```
- **`auth/join-request.ts`**: `displayName: displayNameSchema.optional()` (комментарий ADR-012 §3 из брифа).
- **Created `auth/organizer-bootstrap-request.ts`**: `z.strictObject({ setupToken: z.string().min(1) })`, тип `OrganizerBootstrapRequest` — verbatim из брифа.
- **Created `auth/join-response.ts`**: `tokenResponseSchema.extend({ displayName: z.string().min(1) })`, тип `JoinResponse` — verbatim. Проверено: `tokenResponseSchema` — `z.strictObject`, `extend` сохраняет strictness (тест «rejects missing displayName» + fixture strictObject-кейсы проходят).
- **`index.ts`**: удалены экспорты oauth-строк (бывшие 32–33), добавлены `organizer-bootstrap-request` и `join-response` рядом с join-request/token-response.
- **`contract-version.ts:8`** → `'2.0.0'`; **`package.json`** → `"version": "2.0.0"` (парность запинана contract-version.contract.spec — зелёный).
- **Specs/fixtures**: фикстура `{ code: 'ABCDEFGH' }` перенесена invalid→valid; добавлены новые spec-файлы из брифа verbatim; error-codes.contract.spec обновлён (минус 7 OAUTH_*, плюс 2 новых, + it.each «accepts ADR-012 code»); join-request.contract.spec += явный тест «accepts join without displayName».

### Отклонение от брифа (вынужденное, одно)

- **`contract-version.contract.spec.ts`** не упомянут в брифе, но содержит захардкоженные ожидания эпохи 1.x (`accepts ^1.0.0 / rejects ^2.0.0` и т.п.). Бамп до 2.0.0 (предписан брифом) ломает 6 его тестов. Обновлён в 2.x-эпоху: compatible = `^2.0.0`, `>=2.0.0 <3.0.0`, `2.x`; incompatible = `^1.0.0`, `>=3.0.0`, `1.x`; в assert-тесте `^2.0.0` не бросает, `^1.0.0` бросает `CONTRACT_VERSION_INCOMPATIBLE`. Логика предикатов не тронута, только ожидания под новый мажор. Тесты bounded/unbounded-range (строки 46–62 исходного) не зависят от CONTRACT_VERSION и не менялись.

## Red-run evidence (Step 2)

`pnpm --filter @mymozhem/sdk test` → **4 suites failed, 5 tests failed, 326 passed**:

- `join-request.contract.spec.ts` — 2 падения: `accepts {"code":"ABCDEFGH"}` (Expected: true / Received: false) и новый тест «accepts join without displayName» (safeParse.success false — displayName ещё required).
- `join-response.contract.spec.ts` — TS2307: Cannot find module './join-response'.
- `organizer-bootstrap-request.contract.spec.ts` — TS2307: Cannot find module './organizer-bootstrap-request'.
- `error-codes.contract.spec.ts` — «exports exactly the codes…»: diff Expected −2 (`ORGANIZER_SETUP_INVALID`, `PRIZES_DISABLED`) / Received +7 (`OAUTH_NOT_CONFIGURED` … `OAUTH_EMAIL_CONFLICT`).

Ровно ожидаемый красный набор из брифа.

## Green-run evidence (Step 4)

```
Test Suites: 30 passed, 30 total
Tests:       327 passed, 327 total
```
`pnpm --filter @mymozhem/sdk build` → `tsc -p tsconfig.json` чисто (BUILD_OK).

## Step 5 — каскад потребителей (главная часть)

Предварительно: typecheck в worktree зашумлялся отсутствующей генерацией Prisma Client (десятки ошибок `Module '"@prisma/client"' has no exported member …`). Прогнал `pnpm --filter @mymozhem/core prisma:generate` (артефакт toolchain, не изменение кода) — шум ушёл, остался детерминированный сигнал.

### Greps

- `grep -rn 'oauthStartQuery\|oauthCallbackQuery\|OAUTH_' apps/web/src` → **нет code-импортов**; единственное совпадение — `apps/web/src/pages/landing.tsx:27`, прозаический комментарий про `OAUTH_REDIRECT_ALLOWLIST`. Как и ожидалось.
- Импортёры удалённых SDK-символов в core: только `packages/core/src/transport/oauth.controller.ts` (реальные импорты схем). Остальные grep-совпадения (`oauth.errors.ts`, `http-exception.filter.ts/.spec.ts`, `config.schema.ts`, `auth.tokens.ts`, `oauth.module.ts`, …) — core-локальные константы/комментарии, от SDK не импортируют удалённое; typecheck их не краснит.

### Точный красный инвентарь (`pnpm typecheck`, после prisma:generate)

Failed task: `@mymozhem/core#typecheck` — единственный. sdk / app-quiz / app-lottery / web — зелёные.

1. `packages/core/src/transport/oauth.controller.ts(2,10)` — TS2305: no exported member `oauthCallbackQuerySchema`.
2. `packages/core/src/transport/oauth.controller.ts(2,36)` — TS2305: no exported member `oauthStartQuerySchema`.
   → **Инвентарь T4** (известное, не чинить).
3. `packages/core/src/transport/join.controller.ts(28,73)` — TS2322: `Type 'string | undefined' is not assignable to type 'string'`.
   → **ВНЕ инвентаря T4 из брифа — причина остановки.**

Каскадные артефакты (не code-level): `apps/server#typecheck` падает с `Cannot find module '@mymozhem/core'` (4 файла) — core `dist` не собран, потому что красный core; в собственных исходниках server удалённые/изменённые символы не используются.

### Анализ пункта 3 (evidence для решения)

- Причина: `join.controller.ts:28` передаёт `displayName` из распарсенного `joinRequestSchema` (теперь `string | undefined`) в `MembershipService.join`, чья сигнатура (`membership.service.ts:197`) требует `displayName: string`.
- Это не неизвестное красное: план (`docs/sessions/2026-10-12-adr-012-zero-pii-implementation-plan.md`) в **Task 6** явно объявляет: «Modify: `packages/core/src/transport/join.controller.ts` (ответ — JoinResponse)», «Modify: `membership.service.ts` (join: необязательное имя + генерация в tx)» и «**Consumes: T2** (`joinRequestSchema.displayName` optional, `joinResponseSchema`)». Т.е. красное — спроектированное промежуточное состояние между T2 и T6, полностью аналогичное oauth-красному, которое чистит T4.
- Устранить его в рамках T2 невозможно: предписанный брифом `displayName.optional()` неизбежно краснит join.controller до T6; фиксить core мне запрещено (commit ONLY packages/sdk).
- Тем не менее бриф (Step 5: «Если красное есть вне известного инвентаря T4 — остановиться, эскалация») и лаунчер («STOP and report BLOCKED») предписывают остановку — выполнено, коммит не сделан.

## Состояние worktree (незакоммичено, всё под packages/sdk)

Modified: `package.json`, `src/contract-version.ts`, `src/contract-version.contract.spec.ts`, `src/index.ts`, `src/errors/error-codes.ts`, `src/errors/error-codes.contract.spec.ts`, `src/auth/join-request.ts`, `src/auth/join-request.fixtures.ts`, `src/auth/join-request.contract.spec.ts`.
Deleted (staged): `src/auth/oauth-start-query.ts`, `src/auth/oauth-callback-query.ts`, `src/auth/oauth-query.contract.spec.ts`.
New: `src/auth/organizer-bootstrap-request.ts` (+spec), `src/auth/join-response.ts` (+spec).

## Рекомендация оркестратору

Красное вне инвентаря — это plan-declared поверхность T6, одна строка, один файл; риск непредвиденного blast radius отсутствует. Если владелец подтверждает «ожидаемое промежуточное состояние батча A–B», коммит готов немедленно:

```
git add packages/sdk
git commit -m "feat(sdk)!: контракт 2.0.0 — ADR-012: displayName необязателен, join-ответ с displayName, bootstrap-схема, коды PRIZES_DISABLED/ORGANIZER_SETUP_INVALID; удалены oauth-схемы и OAUTH_* коды"
```

Также стоит поправить текст Step 5 в брифе T2/плане: инвентарь ожидаемого красного дополнить `join.controller.ts` (чистится в T6, не T4).

---

## Постановление контроллера (2026-10-12, после эскалации)

Красное `join.controller.ts(28,73)` **ПРИНЯТО** как спроектированное промежуточное состояние: Task 6 утверждённого плана владеет фиксом-потребителем («Modify: join.controller.ts / membership.service.ts», «Consumes: T2 displayName optional») — полностью параллельно oauth-красному, которое чистит T4, и неизбежно при предписанном `displayName.optional()`. Известный красный инвентарь батча A теперь: **T4 oauth-инвентарь + T6 join.controller/membership displayName**. Отклонение в `contract-version.contract.spec.ts` также принято (вынуждено предписанным бампом 2.0.0).

**Финальный статус: DONE. Коммит: `351d14a71816503a2e89d20e900a846286ccf83a`** (message из брифа Step 6 + Co-Authored-By; только packages/sdk, 16 файлов, +69/−91; дерево чистое).

---

## Финревью батча A — фикс-волна (2026-10-12)

**Finding (Important):** бамп SDK 2.0.0 оставил каскад эпохи контракта вне санкционированного красного инвентаря — фикстуры с `contractRange: '^1.0.0'` падали на satisfaction-check при регистрации манифестов.

### Что изменено (коммит `9565e9740dc93e6271172d6d6263db439c692bc1`, 10 файлов, +13/−11)

1. `packages/sdk/src/manifest/manifest.fixtures.ts:7,42` — `contractRange: '^1.0.0'` → `` `^${CONTRACT_VERSION}` `` (вывод из CONTRACT_VERSION, эпохо-устойчиво; добавлен импорт).
2. `packages/core/src/app-registry/app-registry.service.spec.ts:80` — `'^1.0.0'` → `'^2.0.0'`.
3. `packages/core/src/app-registry/app-registry.spec.ts:39` — флип исключающего диапазона: тест «rejects a range excluding the running version as CONTRACT_VERSION_INCOMPATIBLE» использовал `'^2.0.0'` (писался в эпоху 1.x, теперь satisfied) → `'^1.0.0'` (снова исключает). Намерение теста проверено перед флипом.
4. Механический бамп `'^1.0.0'` → `'^2.0.0'` в фикстурах: `app-runtime.int-spec.ts:41`, `realtime/event-commit.int-spec.ts:35`, `realtime/event-outbox.int-spec.ts:29`, `realtime/db-down.int-spec.ts:25`, `apps/server/test/realtime.e2e-spec.ts:45`. Только era-строки, остальное в этих файлах не тронуто (там санкционированное oauth/join красное).
5. Пойман дополнительный hit вне списка координатора: `packages/core/src/realtime/projection.service.spec.ts:23` — тот же фикстурный литерал, бампнут (`catch every hit`).
6. Ride-along: `packages/sdk/src/errors/error-codes.ts:16` — stale-комментарий «OAuth-срез (REQ-ID-015)» над `ROOM_ORGANIZER_NOT_REGISTERED` заменён на «Организатор комнаты — только REGISTERED (REQ-ID-005; ADR-012: контур больше не OAuth)».

### Grep-доказательство (ноль фикстурных литералов эпохи 1.x)

`grep -rn "'\^1\.0\.0'" packages apps --include='*.ts'` — остались только намеренные:
- `app-registry.spec.ts:39` — флипнутый EXCLUDING-кейс (по дизайну);
- `contract-version.contract.spec.ts:30,46,67` — намеренные incompatible-range ожидания эпохи 2.x;
- `manifest.contract.spec.ts:20` — schema-валидность well-formed диапазона (эпохо-независимо).

### Тестовые прогоны

- `pnpm --filter @mymozhem/sdk test` → **30/30 suites, 327/327 tests green**.
- `pnpm --filter @mymozhem/core test -- app-registry` → первый прогон упал (15 failed) по stale `dist` SDK — core резолвит `@mymozhem/sdk` через `dist/index.js` (нет moduleNameMapper), а dist был собран до фикс-волны. После `pnpm --filter @mymozhem/sdk build`: **3/3 suites, 38/38 tests green** (app-registry.spec, app-registry.service.spec, app-registry.module.spec).
- Прочие core suites не гонялись — там санкционированное oauth/join красное (инвентарь T4 + T6).
