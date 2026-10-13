### Task 1: SDK io:'input' (P1, C-9.1) → SDK 1.7.0

**Files:**
- Modify: `packages/sdk/src/manifest/define-app.ts` (toRegisteredSchema)
- Modify: `packages/sdk/src/contract-version.ts` (`CONTRACT_VERSION`)
- Modify: `packages/sdk/package.json` (`version`)
- Test: `packages/sdk/src/manifest/define-app.spec.ts` (существующий; если имя иное — найти по `toRegisteredSchema`/`defineApp` в `packages/sdk/src/manifest/`)
- Test: `packages/core/src/app-registry/app-registry.service.spec.ts` (существующий unit спека validateSettings; найти по `validateSettings`)

**Interfaces:**
- Consumes: `z.toJSONSchema(schema, { io: 'input', override })` — zod 4; defaulted ключи в input-режиме не попадают в `required`.
- Produces: артефакт манифеста, где defaulted ключи appSettings необязательны (configure `{}` проходит verdict-only гейт); SDK/контракт 1.7.0.

- [ ] **Step 1: Failing test — defaulted ключ необязателен в артефакте, аннотации видимости сохраняются**

```ts
it('defaulted settings key is optional in the registered artifact (io: input, C-9.1)', () => {
  const manifest = defineApp({
    appId: 'fixture-defaults',
    manifestVersion: 1,
    appSettings: z.strictObject({
      mode: z.string().default('relaxed').meta({ 'x-visibility': 'public' }),
      requiredKey: z.string().meta({ 'x-visibility': 'public' }),
    }),
    events: {},
  });
  const artifact = manifest.appSettings as {
    required?: string[];
    properties: Record<string, Record<string, unknown>>;
  };
  expect(artifact.required).toEqual(['requiredKey']);
  expect(artifact.properties.mode.default).toBe('relaxed');
  expect(artifact.properties.mode['x-visibility']).toBe('public');
});
```

- [ ] **Step 2: Run** — `pnpm --filter @mymozhem/sdk test -- define-app` → FAIL (`required` содержит `mode`)

- [ ] **Step 3: Implement** — в `toRegisteredSchema` добавить `io: 'input'`:

```ts
    const json = z.toJSONSchema(schema, {
      // input-режим (решение владельца C-9.1, REQ-RWD-014): defaulted ключи — необязательные
      // на входе; дефолт применяет zod-parse в handler'е модуля, гейт ядра verdict-only.
      io: 'input',
      override: (ctx) => { /* без изменений */ },
    });
```

- [ ] **Step 4: Bump контракта** — `CONTRACT_VERSION = '1.7.0'`; `packages/sdk/package.json` `"version": "1.7.0"` (контрактный тест пинит равенство). Прогнать `pnpm --filter @mymozhem/sdk test` — зелёный; контрактные спеки quiz/lottery, пинившие output-режим (`required` с defaulted ключом, напр. `drawEligibility`), поправить под input-режим.

- [ ] **Step 5: Failing test (core)** — `validateSettings` принимает `{}` для манифеста с defaulted настройками:

```ts
it('accepts {} when every settings key is defaulted (C-9.1 end-to-end на гейте)', () => {
  const registry = new AppRegistryService([fixtureManifestWithDefaultedSettings]);
  expect(() => registry.validateSettings('fixture-defaults', 1, {})).not.toThrow();
});
```

- [ ] **Step 6: Run red → уже зелёный после Step 3? Если зелёный сразу — значит гейт читает тот же артефакт (ожидаемо); оставить тест как пин. Прогнать полный unit конвейер:** `pnpm build && pnpm run test` → зелёный.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk packages/core packages/app-quiz packages/app-lottery
git commit -m "feat(sdk): toRegisteredSchema в io:'input' — defaulted ключи appSettings необязательны (C-9.1, REQ-RWD-014); контракт 1.7.0"
```

