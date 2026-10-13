### Task 1: SDK 1.8.0 — код ошибки IDENTITY_ANONYMIZED

**Закрывает:** контрактную часть C-8.1 (дизайн §4: новый код в `CONTRACT_ERROR_CODES`, минор SDK). Потребители — Task 3 (rewards) и HTTP-фильтр.

**Files:**
- Modify: `packages/sdk/src/errors/error-codes.ts`
- Modify: `packages/sdk/src/errors/error-codes.spec.ts`
- Modify: `packages/sdk/package.json` (version)
- Modify: `packages/sdk/src/contract-version.ts` (CONTRACT_VERSION)

**Interfaces:**
- Consumes: ничего из других задач.
- Produces: `CONTRACT_ERROR_CODES` включает `'IDENTITY_ANONYMIZED'` (перед `'INTERNAL_ERROR'`); `CONTRACT_VERSION = '1.8.0'`; `package.json` version `1.8.0`.

- [ ] **Step 1: RED — обновить спеки под новый код и версию**

В `packages/sdk/src/errors/error-codes.spec.ts`:
- В тест «exports exactly the codes named by the design §8» добавить `'IDENTITY_ANONYMIZED',` в ожидаемый массив **перед** `'INTERNAL_ERROR'`.
- Добавить ряд после существующего `it.each` для phase-3 кодов:

```ts
it.each(['IDENTITY_ANONYMIZED'] as const)('accepts phase-4 code %s', (code) => {
  expect(contractErrorCodeSchema.safeParse(code).success).toBe(true);
});
```

- [ ] **Step 2: Запустить — убедиться в RED**

Run: `pnpm --filter @mymozhem/core test -- errors/error-codes.spec.ts` — нет, спека живёт в SDK:
Run: `pnpm --filter @mymozhem/sdk test -- errors/error-codes.spec.ts`
Expected: FAIL — `'IDENTITY_ANONYMIZED'` отсутствует в `CONTRACT_ERROR_CODES`.

- [ ] **Step 3: GREEN — добавить код и поднять версии**

`packages/sdk/src/errors/error-codes.ts` — в массив `CONTRACT_ERROR_CODES` перед `'INTERNAL_ERROR'`:

```ts
  // Фаза 4 (C-8.1): award по анонимизированной/неизвестной identity отклонён —
  // приз не должен осиротеть (дизайн 2026-09-24 §4).
  'IDENTITY_ANONYMIZED',
```

`packages/sdk/src/contract-version.ts`: `export const CONTRACT_VERSION = '1.8.0';`
`packages/sdk/package.json`: `"version": "1.8.0"`.

- [ ] **Step 4: Прогон SDK полностью + build**

Run: `pnpm --filter @mymozhem/sdk test && pnpm --filter @mymozhem/sdk build`
Expected: PASS (включая contract-version.spec — pkg.version ≡ CONTRACT_VERSION сверяется автоматически) + build без ошибок.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/errors/error-codes.ts packages/sdk/src/errors/error-codes.spec.ts packages/sdk/package.json packages/sdk/src/contract-version.ts
git commit -m "feat(sdk): IDENTITY_ANONYMIZED contract error code (C-8.1), SDK 1.8.0"
```

---

