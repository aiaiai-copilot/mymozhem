### Task 3: SDK — `clientInitiated` в манифесте событий

**Files:**
- Modify: `packages/sdk/src/manifest/manifest.schema.ts:30-33` (`manifestEventSchema`)
- Modify: `packages/sdk/src/manifest/define-app.ts:17-25,118-123` (`AppDefinition.events`, маппинг)
- Modify: `packages/sdk/src/manifest/manifest.fixtures.ts`, `packages/sdk/src/manifest/define-app.fixtures.ts`
- Test: `packages/sdk/src/manifest/manifest.contract.spec.ts`, `define-app.contract.spec.ts`
- Modify (все манифест-литералы в репо — найти `grep -rln "manifestVersion" --include="*.ts" packages apps | grep -v dist | grep -v node_modules`): `apps/server/test/realtime.e2e-spec.ts` (TEST_APP), `packages/core/src/realtime/event-commit.int-spec.ts` (TEST_APP), `packages/core/src/realtime/event-log.int-spec.ts` и `packages/core/src/room/room.service.int-spec.ts` (если содержат манифест-литералы — проверить grep'ом)

**Interfaces:**
- Produces: `manifestEventSchema = { schema, visibility, clientInitiated: boolean }`; `AppDefinition.events` entry = `{ schema: z.ZodType; visibility: Visibility; clientInitiated: boolean }`. Consumed by Task 6 (гейт диспетчера) и Task 9 (манифест квиза).

**REQ:** REQ-CTR-008/009 (реестр типов), design §2 (клиенту открыты только команды).

- [ ] **Step 1: Failing tests**

В `manifest.contract.spec.ts`: фикстура события без `clientInitiated` отклоняется; с `clientInitiated: false` принимается. В `define-app.contract.spec.ts`: `defineApp` проносит флаг в зарегистрированный манифест:

```typescript
it('carries clientInitiated into the registered manifest', () => {
  const manifest = defineApp({
    appId: 'flag-app',
    manifestVersion: 1,
    appSettings: z.strictObject({ label: z.string() }),
    events: {
      'note.posted': { schema: z.strictObject({ n: z.number() }), visibility: 'public', clientInitiated: true },
      'note.derived': { schema: z.strictObject({ n: z.number() }), visibility: 'public', clientInitiated: false },
    },
  });
  expect(manifest.events['note.posted']?.clientInitiated).toBe(true);
  expect(manifest.events['note.derived']?.clientInitiated).toBe(false);
});
```

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/sdk test -- manifest`
Expected: FAIL (поле отсутствует/отклоняется strictObject'ом).

- [ ] **Step 3: Implement**

`manifest.schema.ts`:

```typescript
// Per-type exposure ceiling is mandatory (REQ-CTR-009, ADR-008 §2). clientInitiated
// (фаза 2): только типы с true открыты для клиентского publish; производные типы
// (эмиссия модуля, actorId=null) клиенту закрыты — гейт в app-runtime диспетчере.
export const manifestEventSchema = z.strictObject({
  schema: jsonSchemaObjectSchema,
  visibility: visibilitySchema,
  clientInitiated: z.boolean(),
});
```

`define-app.ts` — тип и маппинг:

```typescript
export type AppDefinition = {
  appId: string;
  manifestVersion: number;
  contractRange?: string;
  appSettings: z.ZodType;
  // Short names; the core prefixes the namespace itself (design §4.1).
  // clientInitiated — обязательное явное решение по каждому типу (fail-safe = false).
  events: Record<string, { schema: z.ZodType; visibility: Visibility; clientInitiated: boolean }>;
};
```

```typescript
  const events = Object.fromEntries(
    Object.entries(definition.events).map(([shortName, event]) => [
      shortName,
      { schema: toRegisteredSchema(event.schema), visibility: event.visibility, clientInitiated: event.clientInitiated },
    ]),
  );
```

Обновить фикстуры: каждому событию в `manifest.fixtures.ts` / `define-app.fixtures.ts` добавить `clientInitiated` (валидным — явные true/false; добавить невалидную фикстуру без поля). Обновить все манифест-литералы из grep-списка (test-app'ы: `note.posted`/`secret.recorded` — `clientInitiated: true`, они публикуются e2e напрямую; `round.hinted` — true; производных там нет).

- [ ] **Step 4: Run — GREEN по всему дереву**

Run: `pnpm build && pnpm --filter @mymozhem/sdk test && pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/server test`
Expected: PASS (int не запускать здесь — Task 6/7; но typecheck всего дерева обязателен: `pnpm typecheck`).

- [ ] **Step 5: Commit**

```bash
git add packages apps
git commit -m "feat(sdk): манифест — обязательный clientInitiated на тип события (design 2026-09-09 §2)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

