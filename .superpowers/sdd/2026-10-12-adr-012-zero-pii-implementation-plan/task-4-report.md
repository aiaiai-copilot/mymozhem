# Task 4 report: Удаление OAuth-контура + миграция drop_identity_provider

**Status:** DONE_WITH_CONCERNS (все гейты зелёные, кроме санкционированного красного T2.1/T6 в `join.controller.ts`)
**Commit:** `e2c4ffc` — `feat(core)!: удаление OAuth-контура (ADR-012) — модуль/контроллер/лимитеры/фильтр/e2e; миграция drop IdentityProvider + индекс единственности организатора` (36 файлов, +121/−1562)

## Что реализовано (по брифу)

1. **Миграция** `packages/core/prisma/migrations/20261012202423_drop_identity_provider/migration.sql` — SQL verbatim из брифа: `DROP TABLE identity."IdentityProvider"` + `CREATE UNIQUE INDEX "Identity_single_registered_key" ON identity."Identity"(kind) WHERE kind='REGISTERED' AND "deletedAt" IS NULL`. Применяется через `migrate deploy` в testcontainer (проверено прогоном int-лайна: "All migrations have been successfully applied").
2. **schema.prisma**: удалены `model IdentityProvider` и поле `Identity.providers`; клиент перегенерирован (`prisma:generate`, v7.8.0).
3. **organizer-schema.int-spec.ts** — новая спека по образцу удалённой: таблица отсутствует в `information_schema`, индекс существует в `pg_indexes` (UNIQUE/REGISTERED/deletedAt в indexdef). PASS.
4. **Удаления**: `src/oauth/` (8 файлов), `transport/oauth.controller.ts`, `apps/server/test/oauth.e2e-spec.ts`, `identity-provisioning.int-spec.ts`, `identity-provider-schema.int-spec.ts`, `identity.errors.ts` (потребителей вне oauth не было — grep подтвердил до удаления; из барреля экспортировалась не она, а только identity.service/module — баррель чист без правок под неё).
5. **Правки**: `identity.service.ts` (минус `findOrCreateByProvider`, инвариант-комментарий брифа над классом), `transport.module.ts` (минус OAuthModule/OAuthController/2 фабрики лимитеров), `auth.tokens.ts` (минус 2 символа), `http-exception.filter.ts`+спек (минус OAuthError-ветки, 7 строк мапы, warn-тест), `index.ts` (минус 5 oauth-экспортов), `pino-options.spec.ts` (фикстуры → нейтральные URL/куки, поведение тестов не изменено — оба PASS), комментарии `pino-logger.module.ts`/`http.types.ts`.

## Гейты (шаги 4–5)

| Гейт | Итог |
|---|---|
| `pnpm --filter @mymozhem/core build` | красное РОВНО одно: `join.controller.ts(28,73)` TS2322 — санкционированное ruling T2.1 (владелец T6), oauth-инвентарь весь ушёл |
| `pnpm --filter @mymozhem/core test` | PASS 18/18 suites, 215/215 |
| `pnpm --filter @mymozhem/core test:int` | PASS 22/22 suites, 208/208 (включая organizer-schema) |
| `pnpm --filter @mymozhem/server test` | PASS 8/8 suites, 57 passed + 1 skipped (см. ниже) |
| `pnpm build` / `pnpm typecheck` | красное только `@mymozhem/core` на том же `join.controller.ts(28,73)` (T2.1/T6) |
| `pnpm boundary-check` | PASS (715 modules, 0 violations) |
| `pnpm guardrails` | PASS (3/3 alive) |
| `pnpm lint` | PASS 6/6 |
| `pnpm test` (монорепо) | apps/web зелёный (10 файлов, 69 тестов) — санкционированное web-красное не материализовалось; падает только turbo-зависимость `@mymozhem/core#build` (тот же T6-файл) |

**grep-гейт брифа** (`grep -rn 'oauth\|OAUTH\|GOOGLE_' packages/core/src packages/sdk/src apps/server/src apps/server/test --include='*.ts'`): **пусто полностью**.
Более широкий grep (`OAuth|Google|google`) — 5 исторических комментариев, санкционированных ruling'ом прошлого батча: `authenticate.ts:5`, `token.service.ts:37`, `realtime.gateway.ts:128`, `seed-identity.ts:5`, `sdk/errors/error-codes.ts:16` (последний — ADR-012-aware текст из T1). Комментарий в `token.service.int-spec.ts:153` заодно обновлён при фикстурной правке. `event-outbox.ts:27` (IdentityError в комментарии) — оставлен по предподтверждению.

## Найденное вне брифа (blast radius индекса единственности)

Бриф не предвидел, что `Identity_single_registered_key` (максимум один живой REGISTERED на БД) ломает существующие фикстуры, сеющие 2+ REGISTERED. Первый прогон `test:int`: 7 suites красные (41 тест). Починено минимально, с комментариями ADR-012 на месте каждой правки:

1. `identity-schema.int-spec.ts` — тест «allows many rows with NULL email» переписан в «rejects a second live REGISTERED row even with NULL email (ADR-012)» (поведение теперь пинает новый индекс; email-индекс сохранён брифом и продолжает пинаться остальными тестами спеки).
2. `membership.service.int-spec.ts` — P1 посеян GUEST (тесты kind-агностичны: raw membership + lookup); **удалён тест «REGISTERED-цель сохраняет сессии (дизайн §0.2)»** — сценарий непредставим (второй живой REGISTERED = организатор, а он неисключаем). На месте теста оставлен комментарий; ветка `kind !== 'GUEST'` в `MembershipService.exclude` сохранена в коде (мёртва в MVP, до возврата аккаунтов).
3. `guest-sweep.int-spec.ts`, `rewards.int-spec.ts` — `identity."Identity"` добавлена в afterEach-TRUNCATE (сиды REGISTERED на вызов теста накапливались).
4. `rewards-schema.int-spec.ts` — добавлен afterEach-TRUNCATE identity+room (посевов организатора на вызов — два).
5. `token.service.int-spec.ts` — REGISTERED-ротация использует уже посеянного ORG вместо второго REGISTERED.
6. `event-log.int-spec.ts` — ACTOR посеян GUEST (kind для actorId не значим).
7. `transport.e2e-spec.ts` — ORG2 удалён; ORG переведён на v4-совместимый uuid (`00000000-0000-4000-8000-000000000001`), тест «цель — ORGANIZER → 409» использует ORG (ранее ORG2 существовал именно ради v4-nibble в path-param).
8. `lottery.e2e-spec.ts` — тест 4 («eligibility verified», REQ-RWD-014 verified-ветка) переведён в `it.skip` с комментарием: ветка приостановлена амендментом v1.5 и снимается задачей манифеста lottery v2; сценарий с REGISTERED-участником непредставим под новым индексом. Не удалён осознанно — граница владения у задачи лотереи.

## Ещё одно красное вне брифа (чинено)

`pnpm --filter @mymozhem/server test` падал целиком (8/8 suites) на `loadConfig`: T3 сделал `ORGANIZER_SETUP_TOKEN` обязательным, а e2e boot'ят ConfigModule из `process.env`. Фикс: `apps/server/test/jest-env-setup.ts` (`process.env.ORGANIZER_SETUP_TOKEN ??= 'server-e2e-organizer-setup-token!!'`, 34 символа) + `setupFiles` в `apps/server/jest.config.js`. Дотягивается и до bootstrap-smoke (потомок получает `...process.env`).

## Self-review диффа

- `identity.service.ts`: импорт `Prisma` оставлен осознанно (TransactionClient в createGuest); инвариант-комментарий брифа размещён над классом (метод-носитель удалён).
- `http-exception.filter.ts`: тип `WireCode` сузился вместе с мапой — compile-time exhaustive-проверка сохранена; поведение для AuthError не изменено.
- `transport.e2e`: все ссылки на ORG идут через константу (grep по литералу — чисто); смена uuid безопасна.
- Оставлено осознанно (флаги, не дефекты): `ReplyLike.clearCookie`/`redirect` теперь без потребителей (бриф санкционировал только комментарии http.types.ts; удаление членов — кандидат для T5/T6-ревью); мёртвая ветка `kind !== 'GUEST'` в exclude (см. выше); старый email-индекс `Identity_registered_email_key` не дропнут (миграция брифа verbatim).
- bootstrap.e2e требует свежего `dist/main.js`: из-за T6-красного `pnpm build` падает на core (tsc эмитит несмотря на ошибку — dist собран прямым `tsc -p` для core и server перед прогоном). В CI-порядке гейтов bootstrap останется красным до T6 — это следствие ruling T2.1, не новое состояние.

## Concerns

1. Удалён один тест (membership exclude REGISTERED-цель) и заскипан один e2e (lottery verified) — оба непредставимы под ADR-012-инвариантом; решения задокументированы комментариями на месте. Если контроллер предпочитает skip вместо удаления (или наоборот) — тривиально поменять.
2. Монорепо `pnpm build`/`typecheck`/`test` остаются красными ровно на `join.controller.ts(28,73)` до T6 (ruling T2.1) — не моё красное, не тронуто.
3. apps/web: красного нет (vitest 69/69 зелёные); OAuth-ссылки лендинга/smoke.spec — T9, не тронуты.
