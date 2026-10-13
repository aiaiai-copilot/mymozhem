### Task 4: Удаление OAuth-контура + миграция drop_identity_provider

**REQ:** REQ-ID-015/009 (приостановлены — контур удаляется физически), REQ-DEV-006 (индекс SQL-миграцией + автотест), REQ-SEC-006 (фильтр без OAUTH-веток), REQ-ID-001 (единственность REGISTERED).

**Интерпретация плана I-1:** миграция переехала из T3 сюда: `schema.prisma` → клиент Prisma → `identity.service.findOrCreateByProvider` → `oauth.service` — одна цепочка компиляции; разрывать её между задачами = красные коммиты.

**Files:**
- Delete: `packages/core/src/oauth/` (8 файлов целиком), `packages/core/src/transport/oauth.controller.ts`, `apps/server/test/oauth.e2e-spec.ts`, `packages/core/src/identity/identity-provisioning.int-spec.ts`, `packages/core/src/identity/identity-provider-schema.int-spec.ts`
- Create: `packages/core/prisma/migrations/<timestamp>_drop_identity_provider/migration.sql`
- Create: `packages/core/src/identity/organizer-schema.int-spec.ts` (замена удалённой schema-спеки)
- Modify: `packages/core/prisma/schema.prisma` (удалить `model IdentityProvider` L113–126 и поле `Identity.providers` L84)
- Modify: `packages/core/src/identity/identity.service.ts` (удалить `findOrCreateByProvider` L33–89, обновить комментарий инварианта L30–32)
- Modify: `packages/core/src/transport/transport.module.ts` (убрать OAuthModule/OAuthController/2 фабрики), `packages/core/src/transport/auth.tokens.ts` (убрать 2 символа)
- Modify: `packages/core/src/transport/http-exception.filter.ts` + спек (убрать OAuthError-ветки и 7 строк мапы)
- Modify: `packages/core/src/index.ts` (убрать oauth-экспорты)
- Modify: `packages/core/src/observability/pino-options.spec.ts` (фикстуры: google-URL → нейтральный URL с query-секретом, `mm_oauth_state` → нейтральное имя куки; поведение тестов не меняется), комментарии `pino-logger.module.ts`, `http.types.ts`

**Interfaces:**
- Consumes: T3 (из AppConfig уже удалены OAUTH_* — эта задача снимает их потребителей).
- Produces: `identity."Identity"` с индексом `Identity_single_registered_key` (потребитель — T5); чистое дерево без oauth (критерий выхода 1).

- [ ] **Step 1: Миграция.** Создать `packages/core/prisma/migrations/<timestamp>_drop_identity_provider/migration.sql`:

```sql
-- ADR-012 §2: OAuth-контур удалён, provider-данные больше не существуют.
DROP TABLE identity."IdentityProvider";

-- ADR-012 §2: ровно один живой REGISTERED на инстанс. Прежний частичный индекс
-- "Identity_registered_email_key" построен по lower(email) и при email = NULL
-- единственность НЕ гарантирует (NULL не конфликтует) — bootstrap полагается
-- на этот индекс (гонка двух bootstrap'ов → P2002 → re-read победителя).
CREATE UNIQUE INDEX "Identity_single_registered_key"
  ON identity."Identity"(kind)
  WHERE kind = 'REGISTERED' AND "deletedAt" IS NULL;
```

- [ ] **Step 2: Падающая schema-спека** — `organizer-schema.int-spec.ts` по образцу удаляемой `identity-provider-schema.int-spec.ts` (тот же запрос к `pg_indexes`/`information_schema`, сменить объект ассерта):

```ts
// ADR-012: таблица IdentityProvider удалена; единственность организатора —
// частичный индекс Identity_single_registered_key (REQ-DEV-006: автотест наличия).
it('drops identity."IdentityProvider"', async () => {
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = 'identity' AND table_name = 'IdentityProvider'`;
  expect(rows).toEqual([]);
});
it('has Identity_single_registered_key partial unique index', async () => {
  const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'identity' AND tablename = 'Identity' AND indexname = 'Identity_single_registered_key'`;
  expect(rows).toHaveLength(1);
  expect(rows[0].indexdef).toContain('UNIQUE');
  expect(rows[0].indexdef).toContain('REGISTERED');
  expect(rows[0].indexdef).toContain('deletedAt');
});
```

- [ ] **Step 3: Удаление кода.** Применить миграцию к тестовой БД и перегенерировать клиент (`pnpm --filter @mymozhem/core prisma:generate`), затем удалить файлы и правки из шапки. `identity.service.ts`: удалить `findOrCreateByProvider` целиком; комментарий инварианта теперь:

```ts
// Инвариант «change both or neither» (двух мест): предикат
// kind='REGISTERED' AND deletedAt IS NULL — partial index "Identity_single_registered_key"
// и guarded create в findOrCreateOrganizer (T5). Менять только вместе.
```

`identity.errors.ts`: коды `EMAIL_CONFLICT`/`PROVIDER_IDENTITY_GONE` потеряли производителя — удалить весь файл и его экспорт из барреля (проверить `grep -rn 'IdentityError\|IDENTITY_ERROR_CODES' packages apps --include='*.ts' | grep -v node_modules` — потребителей вне oauth быть не должно).

`http-exception.filter.ts`: убрать импорт `OAuthError`, 7 строк `OAUTH_*` из `STATUS_BY_WIRE_CODE`, ветку `instanceof OAuthError` (L83 — оставить только AuthError с правкой комментария), ветку `toWireCode` (L100). Спек фильтра: удалить строки маппинга и тест «logs 4xx OAuthError at warn».

- [ ] **Step 4: Прогон гейтов ядра**

```bash
pnpm --filter @mymozhem/core build && pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core test:int
# Expected: PASS (включая новую organizer-schema.int-spec)
```

- [ ] **Step 5: Серверные e2e и гейты монорепы**

```bash
pnpm --filter @mymozhem/server test && pnpm build && pnpm boundary-check && pnpm guardrails && pnpm lint && pnpm typecheck
# Expected: PASS; grep -rn 'oauth\|OAUTH\|GOOGLE_' packages/core/src packages/sdk/src apps/server/src apps/server/test --include='*.ts' — пусто (кроме упоминаний в комментариях-истории, которые задача почистила)
```

Примечание: apps/web и apps/server e2e smoke ещё ссылаются на OAuth-флоу (лендинг, smoke.spec Шаг 0) — это T9; если `pnpm test` монорепы их затрагивает (vitest apps/web), красное web-ожидание зафиксировать и чинить только если падает не-web контур. `apps/web/e2e` вне typecheck (deferred T16 UI-среза) — smoke.spec компиляцией не гейтится.

- [ ] **Step 6: Commit**

```bash
git add -A packages apps/server
git commit -m "feat(core)!: удаление OAuth-контура (ADR-012) — модуль/контроллер/лимитеры/фильтр/e2e; миграция drop IdentityProvider + индекс единственности организатора"
```

---

