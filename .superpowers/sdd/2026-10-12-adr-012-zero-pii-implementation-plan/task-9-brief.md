### Task 9: Web + ops + docs

**REQ:** REQ-ID-003 (UI необязательного имени), REQ-SEC-006 (UX-маппинг новых кодов), REQ-DEV-003 (документы среза). Закрывает критерии выхода 2 (UI-путь bootstrap) и 6 (compose/чеклист).

**Files:**
- Modify: `apps/web/src/pages/landing.tsx` (секция организатора → router-навигация на `/host/login`)
- Create: `apps/web/src/pages/host/host-login-page.tsx`
- Modify: `apps/web/src/App.tsx` (+= route `/host/login`)
- Modify: `apps/web/src/api/endpoints.ts` (+= `bootstrapOrganizer`; `joinRoom` → `joinResponseSchema`)
- Modify: `apps/web/src/pages/play/join-form.tsx` (имя необязательно; сохранять `res.displayName`)
- Modify: `apps/web/src/pages/host/setup-page.tsx` (удалить verified-радио и state drawEligibility; settings `{}`)
- Modify: `apps/web/src/components/winners.tsx` (prizeId null → без «приз …»)
- Modify: `apps/web/src/pages/host/prizes-panel.tsx` (предупреждение о юр. ответственности + кнопка «Разыграть участника» без prizeId; `panelErrorText` += PRIZES_DISABLED)
- Modify: UX-маппинги wire-кодов (`joinErrorText` в `apps/web/src/pages/play/join-form.tsx`, `panelErrorText` в `prizes-panel.tsx`/`setup-page.tsx`/`screen-page.tsx` — найти определения `grep -rn 'function joinErrorText\|function panelErrorText' apps/web/src`): `ORGANIZER_SETUP_INVALID` → «Неверный токен организатора.», `PRIZES_DISABLED` → «Призовой режим выключен на этом сервере.»
- Modify: `apps/web/e2e/smoke.spec.ts` (Шаг 0 → bootstrap через UI; seed-вызов удалён)
- Delete: `apps/server/scripts/e2e-web-seed.mjs`
- Modify: `docker-compose.yml` (OAuth-блок 28–37 → `ORGANIZER_SETUP_TOKEN` :? + `PRIZE_MODE` :-off)
- Modify: `docs/sessions/2026-09-23-ui-slice-smoke-checklist.md` (§0.1 и §1 переписаны под setup-токен), `README.md` (+= quickstart абзац)

**Interfaces:**
- Consumes: T2 (`organizerBootstrapRequestSchema`, `joinResponseSchema`, коды), T5 (endpoint), T7 (lottery v2 payload).
- Produces: критерии выхода 2 и 6; `bootstrapOrganizer(c: ApiClient, input: OrganizerBootstrapRequest): Promise<TokenResponse>`.

- [ ] **Step 1: endpoint-обёртка и типы**

```ts
// endpoints.ts (импорты += organizerBootstrapRequestSchema-тип, joinResponseSchema, JoinResponse):
export const bootstrapOrganizer = (c: ApiClient, input: OrganizerBootstrapRequest): Promise<TokenResponse> =>
  c.call({ method: 'POST', path: '/auth/organizer', body: input, schema: tokenResponseSchema, auth: false });

// joinRoom — ответ теперь несёт фактический displayName (ADR-012 §3):
export const joinRoom = (c: ApiClient, input: JoinRequest): Promise<JoinResponse> =>
  c.call({ method: 'POST', path: '/rooms/join', body: input, schema: joinResponseSchema, auth: false });
```

- [ ] **Step 2: Страница setup-токена** — `host-login-page.tsx` (по образцу join-form: контролируемая форма, busy-гард, `role="alert"`), использует `anonClient`/`hostSession` из `host-session.ts`:

```tsx
// ADR-012 §2: вход организатора — setup-токен из конфигурации инстанса
// (self-hosted норма). Токен НЕ персистится: живёт только в state формы;
// после протухания refresh-сессии вводится заново.
export function HostLoginPage() {
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!token || busy) return;
    setBusy(true); setError(null);
    void bootstrapOrganizer(anonClient, { setupToken: token })
      .then((res) => { hostSession.setAccessToken(res.accessToken); navigate('/host'); })
      .catch((err: unknown) => setError(err instanceof ApiError && err.code === 'ORGANIZER_SETUP_INVALID'
        ? 'Неверный токен организатора.' : 'Не удалось войти. Попробуйте ещё раз.'))
      .finally(() => setBusy(false));
  };
  return (
    <main>
      <h1>Вход организатора</h1>
      <form onSubmit={submit}>
        <label>
          Токен организатора
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" disabled={busy} />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={busy || !token}>Войти</button>
      </form>
    </main>
  );
}
```

`landing.tsx`: секция «Я организатор» — `<Link to="/host/login">Войти по токену организатора</Link>` (router-Link теперь уместен: полная перезагрузка нужна была только OAuth-флоу). `App.tsx` += `<Route path="/host/login" element={<HostLoginPage />} />`.

- [ ] **Step 3: join-form — необязательное имя**

```tsx
// submit: имя не обязательно (ADR-012 §3) — пустое уходит без displayName,
// сервер назначит псевдоним; сохраняем ФАКТИЧЕСКОЕ имя из ответа.
if (!trimmedCode) { setError('Введите код комнаты.'); return; }
void joinRoom(client, trimmedName ? { code: trimmedCode, displayName: trimmedName } : { code: trimmedCode })
  .then((res) => {
    session.setAccessToken(res.accessToken);
    const claims = decodeAccessClaims(res.accessToken);
    if (!claims.roomId) { setError('Ответ сервера без комнаты. Попробуйте ещё раз.'); return; }
    SessionStore.saveGuest({ code: trimmedCode, displayName: res.displayName });
    onJoined(claims.roomId);
  }) ...
// label: «Ваше имя (необязательно)»; placeholder: «Получите псевдоним, если пусто»
```

Vitest-спеки join-form/endpoints (существующие) — обновить под новую схему ответа; += кейс «пустое имя → body без displayName».

- [ ] **Step 4: Лотерея v2 в UI.** `setup-page.tsx`: удалить state `drawEligibility` и оба radio (строки ~44, 155–168); `lotterySettingsSchema.parse({})`. `winners.tsx`:

```tsx
<li key={drawId}>
  {draw.prizeId === null
    ? displayNameOf(names, draw.winnerId)
    : `${displayNameOf(names, draw.winnerId)} — приз ${draw.prizeId}`}
</li>
```

`prizes-panel.tsx`: после формы создания приза — статичное предупреждение и безпризовая кнопка:

```tsx
// ADR-012 §4: создание приза — юридическая ответственность организатора
// (лотереи, налоги). Текст виден всегда: клиент режим не знает, серверный
// гейт отвечает PRIZES_DISABLED при prize_mode=off.
<p>Призовой режим — юридическая ответственность организатора (лотереи, налоги).</p>
// «Разыграть участника»: publish('lottery.draw.run', { drawId }) без prizeId —
// тот же tryStartDrawAttempt-паттерн (pending-гард, crypto.randomUUID).
```

- [ ] **Step 5: Smoke.** `smoke.spec.ts`: Шаг 0 и seed удаляются; вход организатора — через UI: `host.goto('/')` → ссылка «Войти по токену организатора» → `/host/login` → fill password → «Войти» → `waitForURL('**/host/new')`. Токен стенда — из env `ORGANIZER_SETUP_TOKEN` (прогон передаёт то же значение, что compose; CI-шаг seed больше не нужен — удалить из CI-джоба, если там отдельный seed-шаг: `grep -rn 'e2e-web-seed\|E2E_REFRESH_TOKEN' .github/`). Удалить `apps/server/scripts/e2e-web-seed.mjs`.

- [ ] **Step 6: Compose и docs.** `docker-compose.yml` — заменить блок 28–37:

```yaml
      # ADR-012 §2: bootstrap единственного организатора инстанса. Обязателен
      # (>=32 байта); без значения в окружении compose не стартует.
      ORGANIZER_SETUP_TOKEN: ${ORGANIZER_SETUP_TOKEN:?ORGANIZER_SETUP_TOKEN is required (>=32 bytes)}
      # ADR-012 §4: призовой режим выключен по умолчанию; on — юридическая
      # ответственность организатора (лотереи, налоги).
      PRIZE_MODE: ${PRIZE_MODE:-off}
```

Smoke-чеклист: §0.1 → «Setup-токен стенда» (значение в env стенда; наблюдаемый результат — `curl -s -X POST http://<origin>/auth/organizer -H 'content-type: application/json' -d '{"setupToken":"…"}'` → 200 + `Set-Cookie: mm_refresh`); §1 → «Вход организатора по setup-токену» (лендинг → ссылка → ввод токена → `/host/new`; негатив: неверный токен → «Неверный токен организатора.»); §0.2 (shared refresh-кука) и §0.3 (LAN crypto.randomUUID) сохраняются. README += абзац quickstart (self-hosted: `ORGANIZER_SETUP_TOKEN=… docker compose up -d --build`, вход организатора по токену, `PRIZE_MODE=off` по умолчанию).

- [ ] **Step 7: Прогоны**

```bash
pnpm --filter @mymozhem/web test && pnpm --filter @mymozhem/web build
docker compose up -d --build && ORGANIZER_SETUP_TOKEN='<стендовое>' pnpm --filter @mymozhem/web test:e2e
# Expected: vitest PASS; playwright smoke PASS (прогон против compose-стенда — локальный, не прод)
pnpm build && pnpm boundary-check && pnpm guardrails && pnpm lint && pnpm typecheck && pnpm test
```

- [ ] **Step 8: Commit**

```bash
git add apps/web apps/server docker-compose.yml docs/sessions/2026-09-23-ui-slice-smoke-checklist.md README.md
git commit -m "feat(web,ops): вход организатора по setup-токену, необязательное имя гостя, безпризовый розыгрыш (ADR-012); compose/README/чеклист под zero-PII дефолт"
```

---

## Self-review (зафиксировано для ревью владельцем)

**Spec coverage:** §1→T1, §2→T2, §3→T3 (+миграция в T4), §4→T4, §5→T5, §6→T6, §7→T7, §8→T8, §9→T9, §10→батчи A/B/C, §11 — вне объёма (соблюдено: REQ-ID-012 только маркер в T1). Все 6 критериев выхода покрыты: (1) T4 шаг 5 grep+гейты; (2) T5; (3) T6; (4) T7; (5) T8; (6) T9.

**Интерпретации плана:**
- **I-1:** миграция `drop_identity_provider` переехала T3 → T4 (цепочка компиляции schema.prisma → клиент → identity.service → oauth.service не должна рваться между коммитами).
- **I-2:** ответ join расширяется `displayName` (новая `joinResponseSchema`), а не «клиент читает ростер» — авто-rejoin'у нужно фактическое имя сразу, до первого listMembers.
- **I-3:** `PrizesDisabledError extends ContractError` (паттерн rewards.errors); гейт ставится ДО `findFirst` приза — при off ответ всегда `PRIZES_DISABLED`, не `PRIZE_UNKNOWN` (запинано в T7 шаг 6).
- **I-4:** старый частичный индекс `Identity_registered_email_key` (lower(email)) НЕ удаляется: безнадёжен при email=NULL, но безвреден и понадобится при возврате аккаунтов (триггер ADR-012); новый индекс — отдельной строкой той же миграции.
- **I-5:** `lotterySettingsSchema` сохраняется как пустой `strictObject({})` — манифесту нужна settings-схема, а удаление ключа appSettings меняло бы defineApp-контракт без выигрыша.
- **I-6:** `.env` вне git — удаление Google-кредов из него и отзыв клиента в Google Cloud (решение §0.7) — действия владельца после мерджа, в план не включены как шаги.

**Placeholder scan:** код приведён для всех нетривиальных шагов; скелеты e2e/int-спек даны по именам сценариев с ассертами — детали бута делегированы образцам (oauth.e2e-spec/guest-sweep.int-spec), это соответствует уровню детализации прежних планов репозитория.

**Type consistency:** `OrganizerBootstrapRequest`, `JoinResponse`, `generatePseudonym(taken, rnd)`, `findOrCreateOrganizer()`, `setupTokenMatches(provided, expected)`, `ORGANIZER_BOOTSTRAP_RATE_LIMITER`, `PrizesDisabledError` — имена согласованы между задачами (T2→T5/T6/T9, T3→T5/T7, T4→T5).

**Review Focus:** все 5 строк имеют пин-тесты в задачах-владельцах (T5 шаги 3/5, T6 шаг 4, T7 шаг 6, T8 шаг 1).
