### Task 2: REST-таймаут в ApiClient

**Files:**
- Modify: `apps/web/src/api/api-client.ts` (call :28-33)
- Test: `apps/web/src/api/api-client.spec.ts`

**Interfaces:**
- Consumes: ничего из T1.
- Produces: `FETCH_TIMEOUT_MS = 10_000` (exported); отказ по таймауту — НЕ ApiError (DOMException/Error), чтобы классификация T3 читала его как временный.

- [ ] **Step 1: Падающие тесты:**

```ts
it('запрос, не ответивший за FETCH_TIMEOUT_MS, reject\'ится (не ApiError)', async () => {
  // fetch-мок: промис, reject'ящийся по signal 'abort'; fake timers +10_000
  // await expect(call).rejects.not.toBeInstanceOf(ApiError)
});
it('таймаутный отказ refresh-ноги не зацикливает retry', async () => {
  // первый ответ 401 → tokens.refresh() висит → таймаут → исходный call reject'ится, повторного запроса нет
});
it('второй запрос после сработавшего таймаута первого — чистый (per-call controller)', async () => {
  // первый висит→таймаут; второй отвечает 200 → resolve; fetch вызван дважды
});
```

- [ ] **Step 2: Прогон** — `pnpm --filter @mymozhem/web test -- api-client` → FAIL.

- [ ] **Step 3: Реализация** — в `call`: `const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);` fetch с `signal: ctrl.signal`; `finally { clearTimeout(timer); }` (Review Focus 5). Retry-ветка 401 не меняется.

- [ ] **Step 4: Прогон** — PASS; весь api-client сьют зелёный; гейты.

- [ ] **Step 5: Commit** — `fix(web): REST-таймаут 10с через AbortController — подвисший refresh больше не вечен (находка Н1)`.

