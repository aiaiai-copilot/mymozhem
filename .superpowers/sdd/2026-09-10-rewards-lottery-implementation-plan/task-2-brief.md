### Task 2: SDK — контракт 1.6.0 + capabilities манифеста + wire-коды фазы 3

**Files:**
- Modify: `packages/sdk/src/contract-version.ts:8` (`CONTRACT_VERSION`)
- Modify: `packages/sdk/package.json` (`version`)
- Modify: `packages/sdk/src/errors/error-codes.ts` (новые коды)
- Modify: `packages/sdk/src/manifest/manifest.schema.ts` (capabilities)
- Modify: `packages/sdk/src/manifest/define-app.ts` (AppDefinition += capabilities)
- Modify: `packages/sdk/src/manifest/manifest.fixtures.ts` (переделка кейса capabilities)
- Test: `packages/sdk/src/errors/error-codes.contract.spec.ts`, `packages/sdk/src/manifest/manifest.contract.spec.ts`, `packages/sdk/src/manifest/define-app.contract.spec.ts` (существующие — расширить)

**Interfaces:**
- Produces: `APP_CAPABILITIES` (`['rewards'] as const`), `appCapabilitySchema`, тип `AppCapability`; поле `capabilities?: AppCapability[]` в `AppManifest` и `AppDefinition`; коды `'ROOM_NOT_ACTIVE'`, `'CAPABILITY_UNAVAILABLE'`, `'PRIZE_UNKNOWN'`, `'PRIZE_FUND_EXHAUSTED'`, `'DRAW_POOL_EMPTY'`, `'AWARD_UNKNOWN'`, `'REWARD_ALREADY_RESOLVED'` в `ContractErrorCode`. Потребители: Tasks 3, 5, 6, 7, 9, 10.

**REQ:** REQ-RWD-001/005 (capability как форма делегирования), REQ-CTR-004 (версионирование), REQ-CTR-005 (фикстуры).

- [ ] **Step 1: Failing test — новые wire-коды**

В `error-codes.contract.spec.ts` добавить:

```typescript
it.each([
  'ROOM_NOT_ACTIVE',
  'CAPABILITY_UNAVAILABLE',
  'PRIZE_UNKNOWN',
  'PRIZE_FUND_EXHAUSTED',
  'DRAW_POOL_EMPTY',
  'AWARD_UNKNOWN',
  'REWARD_ALREADY_RESOLVED',
] as const)('accepts phase-3 code %s', (code) => {
  expect(contractErrorCodeSchema.safeParse(code).success).toBe(true);
});
```

Примечание: `ROOM_NOT_ACTIVE` — вывод на wire существующего внутреннего кода realtime (`REALTIME_ERROR_CODES.ROOM_NOT_ACTIVE`, realtime.errors.ts:5) для REST-контура rewards (терминальная комната при создании приза, Task 6); строковый паритет — существующий паттерн (`EVENT_PAYLOAD_INVALID`).

- [ ] **Step 2: Failing test — capabilities в манифесте**

В `manifest.contract.spec.ts` добавить:

```typescript
it('accepts a manifest with known capabilities', () => {
  const m = validManifests[0];
  expect(appManifestSchema.safeParse({ ...m, capabilities: ['rewards'] }).success).toBe(true);
});

it('rejects unknown capability values', () => {
  const m = validManifests[0];
  expect(appManifestSchema.safeParse({ ...m, capabilities: ['teleport'] }).success).toBe(false);
});

it('capabilities remain optional', () => {
  expect(appManifestSchema.safeParse(validManifests[0]).success).toBe(true);
});
```

В `define-app.contract.spec.ts` добавить:

```typescript
it('passes capabilities from the definition into the manifest', () => {
  const manifest = defineApp({
    appId: 'lottery',
    manifestVersion: 1,
    capabilities: ['rewards'],
    appSettings: z.strictObject({}),
    events: {
      'draw.completed': {
        schema: z.strictObject({ drawId: z.uuid() }),
        visibility: 'public',
        clientInitiated: false,
      },
    },
  });
  expect(manifest.capabilities).toEqual(['rewards']);
});
```

- [ ] **Step 3: Run — RED**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: FAIL (коды не принимаются; capabilities отклоняются strictObject'ом — сейчас за это отвечает фикстура `invalidManifestCases` в manifest.fixtures.ts:92-95 «manifest carries a capabilities field (rewards is phase 3)»).

- [ ] **Step 4: Implement**

`error-codes.ts` — перед `'INTERNAL_ERROR'` добавить блок:

```typescript
  // Фаза 3 (design 2026-09-10): rewards/lottery + REST-контур фонда.
  'ROOM_NOT_ACTIVE',
  'CAPABILITY_UNAVAILABLE',
  'PRIZE_UNKNOWN',
  'PRIZE_FUND_EXHAUSTED',
  'DRAW_POOL_EMPTY',
  'AWARD_UNKNOWN',
  'REWARD_ALREADY_RESOLVED',
```

`manifest.schema.ts` — перед `appManifestSchema`:

```typescript
// Capability манифеста (REQ-RWD-001/005): точка расширения, заложенная в ф.2
// (strictObject сознательно отвергал поле до фазы 3). Неизвестное значение —
// отказ валидации манифеста.
export const APP_CAPABILITIES = ['rewards'] as const;
export const appCapabilitySchema = z.enum(APP_CAPABILITIES);
export type AppCapability = z.infer<typeof appCapabilitySchema>;
```

и в `appManifestSchema` добавить поле `capabilities: z.array(appCapabilitySchema).optional(),` (комментарий строк 38-40 про «strictObject отклонит capabilities до фазы 3» переписать: поле принято с фазы 3, enum принуждает известные значения).

`define-app.ts`: в `AppDefinition` добавить `readonly capabilities?: readonly AppCapability[];` (импорт типа из `./manifest.schema`); в `defineApp` при сборке объекта манифеста добавить spread:

```typescript
    ...(definition.capabilities ? { capabilities: [...definition.capabilities] } : {}),
```

`manifest.fixtures.ts`: убрать кейс «capabilities field» из `invalidManifestCases`; в `validManifests` добавить манифест с `capabilities: ['rewards']`; в `invalidManifestCases` добавить `{ name: 'unknown capability value', value: { ...validManifests[0], capabilities: ['teleport'] } }`.

`contract-version.ts`: `export const CONTRACT_VERSION = '1.6.0';`. `packages/sdk/package.json`: `"version": "1.6.0"`.

Внимание: grep `capabilities` по `packages/sdk/src/**/*.spec.ts` — если где-то есть тест, фиксирующий отказ поля (кроме fixtures-итераций), обновить его на новое поведение.

- [ ] **Step 5: Run — GREEN**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: PASS, включая parity-тест версии (`pkg.version === CONTRACT_VERSION`).

- [ ] **Step 6: Commit**

```bash
git add packages/sdk
git commit -m "feat(sdk): контракт 1.6.0 — capabilities манифеста, wire-коды фазы 3

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---
