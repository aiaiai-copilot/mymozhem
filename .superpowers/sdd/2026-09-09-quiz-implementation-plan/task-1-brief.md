### Task 1: SDK — контракт 1.5.0 + новые wire-коды ошибок

**Files:**
- Modify: `packages/sdk/src/contract-version.ts:8` (`CONTRACT_VERSION`)
- Modify: `packages/sdk/package.json` (`version`)
- Modify: `packages/sdk/src/errors/error-codes.ts` (новые коды)
- Test: `packages/sdk/src/errors/error-codes.contract.spec.ts` (существующий — расширить), `packages/sdk/src/contract-version.contract.spec.ts`

**Interfaces:**
- Produces: коды `'MODULE_UNAVAILABLE'`, `'PUBLISH_FORBIDDEN'`, `'ANSWER_TOO_FAST'`, `'ROUND_NOT_OPEN'`, `'ALREADY_ANSWERED'`, `'QUESTION_UNKNOWN'`, `'OPTION_UNKNOWN'` в `ContractErrorCode` — их используют Task 6 (app-runtime) и Task 11 (quiz handlers).

- [ ] **Step 1: Failing test — новые коды в перечислении**

В `error-codes.contract.spec.ts` добавить:

```typescript
it.each([
  'MODULE_UNAVAILABLE',
  'PUBLISH_FORBIDDEN',
  'ANSWER_TOO_FAST',
  'ROUND_NOT_OPEN',
  'ALREADY_ANSWERED',
  'QUESTION_UNKNOWN',
  'OPTION_UNKNOWN',
] as const)('accepts phase-2 code %s', (code) => {
  expect(contractErrorCodeSchema.safeParse(code).success).toBe(true);
});
```

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: FAIL (коды не принимаются).

- [ ] **Step 3: Implement**

В `error-codes.ts` перед `'INTERNAL_ERROR'` добавить блок:

```typescript
  // Quiz-срез (фаза 2, design 2026-09-09): диспетчер app-runtime и отказы модуля.
  'MODULE_UNAVAILABLE',
  'PUBLISH_FORBIDDEN',
  'ANSWER_TOO_FAST',
  'ROUND_NOT_OPEN',
  'ALREADY_ANSWERED',
  'QUESTION_UNKNOWN',
  'OPTION_UNKNOWN',
```

В `contract-version.ts`: `export const CONTRACT_VERSION = '1.5.0';` В `packages/sdk/package.json`: `"version": "1.5.0"`.

- [ ] **Step 4: Run — GREEN**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: PASS, включая parity-тест версии (contract-version.contract.spec.ts).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk
git commit -m "feat(sdk): контракт 1.5.0 — wire-коды фазы 2 (app-runtime + отказы квиза)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

