# План реализации фикса Н1+Н13 (устойчивость соединения и сессии)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устранить кодовые корни находок приёмки Н1/Н13: молчаливая потеря команд/ответов (publish/REST без таймаута), смерть гостевой сессии на сетевом обрыве, auth-шум от реактивного refresh; плюс визуальное затемнение нефокусного окна на play/console как митигaция environmentной части Н1.

**Architecture:** Вся работа — `apps/web` (сервер не трогается). Четыре независимых механизма: (1) ack/REST-таймауты с типизированным отказом, (2) классификация «терминал vs временный» в сессионной машине, (3) проактивный refresh по пробуждению, (4) focus-dim оверлей. UI-поверхности «Отправляю…»/явный отказ строятся на существующих `answerErrorText`/`commandErrorText`/`submitError`.

**Tech Stack:** React 18, socket.io-client 4.8.3 (только через `realtime/`), vitest (node, без DOM), zod/SDK контракты.

**Spec:** `docs/sessions/2026-11-10-h1-h13-connection-resilience-design.md` — план аргументирует от него; §0 — решения владельца (обязательны к прочтению исполнителем), §4 — звонки строителя.

**Нормативка:** REQ-* не изменяются (качество реализации клиента). Затронутые обязательства: boundary `web-socketio-only-in-realtime` (зеркало REQ-RT-006), REQ-SEC-006 (коды ошибок безопасны для показа), REQ-CTR-005 (TDD от контракта/чистой логики). Закрывает находки приёмки Н1 и Н13 (`docs/sessions/2026-10-19-design-ui-acceptance-checklist.md`).

## Global Constraints

- Вся работа в `apps/web`; сервер, SDK, пакеты app-модулей НЕ трогаем.
- socket.io-client импортируется только в `apps/web/src/realtime/` (boundary-гейт).
- Новых зависимостей нет (install запрещён); `socket.timeout` — часть уже установленного socket.io-client 4.8.3.
- Идиома «DOM-тестов нет»: unit (vitest, node) для чистой логики; React-wiring — typecheck, верификация UI — живая приёмка.
- Константы из дизайна §4 (звонки строителя): publish/subscribe ack-таймаут `REQUEST_TIMEOUT_MS = 5_000`, REST-таймаут `FETCH_TIMEOUT_MS = 10_000`, порог проактивного refresh `REFRESH_AHEAD_MS = 120_000`. Каждая — exported константа с комментарием.
- Формулировка отказов — честная (решение 7): «нет подтверждения — проверьте, не применилось ли», НЕ «точно не отправлено».
- Reduced-motion: затемнение без анимаций появления (прецедент RM-блока transitions.css).
- Гейты на каждый коммит: `pnpm --filter @mymozhem/web lint && pnpm --filter @mymozhem/web typecheck && pnpm --filter @mymozhem/web test`; boundary-check из корня `pnpm boundary-check` при смене импортов.
- Коммиты: conventional (`fix(web): …`, `feat(web): …`, `docs(acceptance): …`), трейлер `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Исполнение: батчи по 3 задачи, каждый батч — новая сессия; worktree на весь срез (ритуалы владельца).

## Review Focus

1. **Late ack после таймаута:** publish отклонён по таймауту, ack пришёл позже → проигравший промис гонки reject'ится/resolve'ится в пустую — unhandled rejection. Ожидание: тишина. Пин — тест T1.
2. **`dueSoon(null)` обязан быть `false`:** страница без access-токена (screen до join, host-login) иначе стреляла бы refresh без куки на каждый focus → новый warn-шум «no refresh cookie» вместо старого. Пин — тест T6.
3. **`online` на живом соединении:** wake-канал не должен плодить лишние refresh/кики — дедуп minInterval + `refreshAttempted`-латч + no-op wakeUp на connected. Пин — тест T4/T6.
4. **blur при hidden-вкладке (мобильный app-switch):** затемнения нет — трекер ставит dim только при `blurred && visible`. Пин — тест T7.
5. **Таймер AbortController не очищен:** следующий запрос наследует сработавший abort/утечку. Ожидание: per-call controller, clearTimeout в finally, второй запрос после первого работает. Пин — тест T2.
6. **Двойной `online` не плодит двойной rejoin:** гард `rejoinInFlight` уже есть; temporary-ретрай обязан через него проходить. Пин — тест T5.

---

## Батч A — транспортная надёжность (таймауты и классификация)

### Task 1: Ack-таймаут и fail-fast в RoomConnection

**Files:**
- Modify: `apps/web/src/realtime/room-connection.ts` (publish :106-113, subscribeOnce :129-137)
- Test: `apps/web/src/realtime/room-connection.spec.ts`

**Interfaces:**
- Consumes: существующий `SocketLike` (НЕ меняется), `ApiError`.
- Produces: `REQUEST_TIMEOUT_MS = 5_000` (exported, комментарий «звонок строителя, дизайн §4»); `publish` reject'ится `ApiError('NOT_CONNECTED', 0)` при мёртвом сокете и `ApiError('PUBLISH_TIMEOUT', 0)` по таймауту; `subscribeOnce` по таймауту reject'ится `ApiError('SUBSCRIBE_TIMEOUT', 0)`. Потребители кодов — T8/T9.

- [ ] **Step 1: Расширить FakeSocket** — режим «зависший ack»: `programHang(event)` — emitWithAck возвращает никогда не settle'ящийся промис (фиксирует emit в `calls`). `connected` уже есть.

- [ ] **Step 2: Падающие тесты** (vi.useFakeTimers):

```ts
it('publish: мёртвый сокет → немедленный NOT_CONNECTED без emit', async () => {
  // socket.connected = false; await expect(conn.publish(...)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  // socket.calls пуст — emit не уходил
});
it('publish: ack не пришёл за REQUEST_TIMEOUT_MS → PUBLISH_TIMEOUT', async () => {
  // programHang(PUBLISH); const p = conn.publish(...); p.catch(() => {});
  // await vi.advanceTimersByTimeAsync(5_000); rejects { code: 'PUBLISH_TIMEOUT' }
});
it('publish: поздний ack после таймаута — без unhandled rejection', async () => {
  // programHang → timeout; затем settle'им зависший промис вручную; process unhandledRejection не стреляет
  // (минимум: гонка обязана иметь .catch на проигравшей ветке — пин статически в коде + тест завершается зелёным)
});
it('subscribeOnce: зависший subscribe → SUBSCRIBE_TIMEOUT, join переходит в disconnected', async () => {
  // programHang(SUBSCRIBE); conn.join() с fake timers → joinError-путь: stateCb('disconnected')
});
```

- [ ] **Step 3: Прогон** — `pnpm --filter @mymozhem/web test -- room-connection` → новые кейсы FAIL (таймаутов нет).

- [ ] **Step 4: Реализация** — приватный хелпер `withAckTimeout(promise, ms, code): Promise<unknown>` в room-connection.ts: `Promise.race` с setTimeout-отказом; проигравшая ветка получает холостой `.catch(() => {})` (Review Focus 1). `publish`: первой строкой `if (!this.socket.isConnected()) throw new ApiError('NOT_CONNECTED', 0)`. Таймаут — `REQUEST_TIMEOUT_MS`. `subscribeOnce` — тот же хелпер.

- [ ] **Step 5: Прогон** — те же кейсы PASS; весь сьют room-connection зелёный; гейты web зелёные.

- [ ] **Step 6: Commit** — `fix(web): publish/subscribe ack-таймаут 5с + fail-fast NOT_CONNECTED (находка Н1)`.

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

### Task 3: Классификация отказов сессии

**Files:**
- Create: `apps/web/src/state/session-failure.ts`
- Test: `apps/web/src/state/session-failure.spec.ts`

**Interfaces:**
- Consumes: `ApiError` (`apps/web/src/api/api-error.ts`).
- Produces: `isTerminalSessionFailure(e: unknown): boolean` — `true` ⟺ `e instanceof ApiError && e.status >= 400 && e.status < 500`. Потребители — T4 (connect_error), T5 (rejoin). Таблица: 401 refresh → терминал; 403/404/409 join → терминал; 5xx/HTTP_5xx → временный; TypeError/AbortError/неизвестное → временный (дизайн §3(В), builder-check Q1).

- [ ] **Step 1: Падающий тест** — таблица кейсов: `new ApiError('SESSION_INVALID', 401)` → true; `new ApiError('ROOM_JOIN_DENIED', 403)` → true; `new ApiError('HTTP_502', 502)` → false; `new ApiError('PUBLISH_TIMEOUT', 0)` → false; `new TypeError('fetch failed')` → false; `new Error('boom')` → false.

- [ ] **Step 2: Прогон** — FAIL (модуль не существует).

- [ ] **Step 3: Реализация** — предикат с комментарием-таблицей классификации (дизайн §3(В): терминален только серверный отказ по существу; 5xx — инфраструктурный обрыв, кейс рестарта сервера посреди события).

- [ ] **Step 4: Прогон** — PASS; гейты.

- [ ] **Step 5: Commit** — `feat(web): классификация отказов сессии — терминален только 4xx (находка Н13)`.

---

## Батч B — сессионная машина (Н13) и проактивный refresh

### Task 4: Классификация в connect_error RoomConnection

**Files:**
- Modify: `apps/web/src/realtime/room-connection.ts` (onConnectError :59-83)
- Test: `apps/web/src/realtime/room-connection.spec.ts`

**Interfaces:**
- Consumes: `isTerminalSessionFailure` (T3).
- Produces: поведение: временный отказ refresh → `stateCb('disconnected')`, `refreshAttempted` сброшен, `onSessionDead` НЕ стреляет; терминальный → как сейчас (`onSessionDead`).

- [ ] **Step 1: Падающие тесты** (FakeSocket: refreshFn-хук программируется отказом):

```ts
it('connect_error + refresh падает TypeError (сеть) → disconnected, onSessionDead НЕ стреляет, латч сброшен', async () => {
  // joined=true; refreshReject(new TypeError('failed')); trigger connect_error
  // sessionDeadCount === 0; state === 'disconnected'
  // повторный connect_error → refresh вызван снова (латч сброшен — retry разрешён)
});
it('connect_error + refresh падает ApiError 401 → onSessionDead стреляет (прежний путь)', …);
it('online-ретрай: после временного отказа успешный refresh на второй волне → kickReconnect', …);
```

- [ ] **Step 2: Прогон** — FAIL (первый кейс: сейчас любой провал refresh → onSessionDead).

- [ ] **Step 3: Реализация** — в `.catch` refresh-хука: `if (isTerminalSessionFailure(e)) { stateCb('disconnected'); onSessionDead?.(); } else { this.refreshAttempted = false; stateCb('disconnected'); }`. Комментарий: принцип решения 4 — сеть/5xx = пауза; retry приходит по wake-каналу (T6).

- [ ] **Step 4: Прогон** — PASS; сьют зелёный; гейты.

- [ ] **Step 5: Commit** — `fix(web): сетевой провал refresh больше не убивает сессию в connect_error (находка Н13)`.

### Task 5: Классификация rejoin на play + повтор по online

**Files:**
- Modify: `apps/web/src/pages/play/play-page.tsx` (rejoin :73-91)
- Test: `apps/web/src/state/guest-rejoin.spec.ts` (если классификацию выносим в чистую функцию — см. шаг 1)

**Interfaces:**
- Consumes: `isTerminalSessionFailure` (T3).
- Produces: чистая `rejoinFailureAction(e: unknown): 'terminal' | 'retry'` (export из play-page.tsx или guest-rejoin.ts — по дисциплине файла; предпочтительно guest-rejoin.ts рядом с rejoinAsGuest). Поведение play-page: terminal → прежний путь (clearGuest + форма); retry → `autoJoinPending` снова true («Входим…») + одноразовый слушатель `window.online` → `rejoin()`.

- [ ] **Step 1: Падающий тест** — `rejoinFailureAction(new ApiError('ROOM_JOIN_DENIED', 403)) === 'terminal'`; `rejoinFailureAction(new TypeError()) === 'retry'`; `rejoinFailureAction(new ApiError('HTTP_502', 502)) === 'retry'`.

- [ ] **Step 2: Прогон** — FAIL.

- [ ] **Step 3: Реализация** — функция в guest-rejoin.ts; в play-page `rejoin` catch-ветка раздваивается по ней. Retry-ветка: `setAutoJoinPending(true)` (экран «Входим…» вместо формы), `window.addEventListener('online', handler, { once: true })` где handler → `void rejoin()` — гард `rejoinInFlight` уже защищает от дублей (Review Focus 6). Комментарий: сеть лежит → ждём online, личность не трогаем (решение 4).

- [ ] **Step 4: Прогон** — PASS; гейты (wiring — typecheck, идиома «DOM-тестов нет»).

- [ ] **Step 5: Commit** — `fix(web): rejoin гостя не сгорает на сетевом обрыве — повтор по online (находка Н13)`.

### Task 6: Проактивный refresh по пробуждению

**Files:**
- Modify: `apps/web/src/state/session.ts` (decodeAccessClaims :5-15)
- Create: `apps/web/src/state/wake-refresh.ts`
- Modify: `apps/web/src/state/use-room-binding.ts` (onWake :72-77)
- Modify: `apps/web/src/pages/host/host-gate.tsx`, `host-login-page.tsx`, `setup-page.tsx` (монтирование хука)
- Test: `apps/web/src/state/wake-refresh.spec.ts`, `apps/web/src/state/session.spec.ts` (фикстуры += exp)

**Interfaces:**
- Consumes: `createFocusRefetcher` (focus-refetch.ts), `SessionStore.refresh`.
- Produces:
  - `decodeAccessClaims` возвращает `exp: number` (секунды, обязательное — серверные токены всегда с exp; фикстуры session.spec.ts дополняются);
  - `accessTokenDueSoon(token: string | null, nowMs: number, thresholdMs?: number): boolean` — `null` → **false** (Review Focus 2: refresh без куки шумит «no refresh cookie»); malformed → false (декод бросает → ловим → false); `(exp*1000 - nowMs) < thresholdMs` → true;
  - `REFRESH_AHEAD_MS = 120_000` (exported);
  - `createSessionWakeRefresher(getToken, refresh, opts?: { thresholdMs?, minIntervalMs?, now?, onWake? }): () => void` — дедуп createFocusRefetcher внутри; due → `void refresh().catch(() => {}).finally(() => onWake?.())`, не due → `onWake?.()` сразу (refresh-then-kick порядок, дизайн §3(Г));
  - `useSessionWakeRefresh(session: SessionStore)` — хук, слушатели visibilitychange/focus/pageshow/online с cleanup.

- [ ] **Step 1: Падающие тесты** — dueSoon: null→false, свежий токен→false, истекающий→true, истёкший→true, malformed→false. createSessionWakeRefresher: due → refresh вызван, onWake ПОСЛЕ settle refresh; не due → onWake без refresh; refresh reject → onWake всё равно стреляет, исключение проглочено; двойной вызов в окне minInterval → один refresh (дедуп).

- [ ] **Step 2: Прогон** — FAIL.

- [ ] **Step 3: Реализация** — wake-refresh.ts + decodeAccessClaims += exp; use-room-binding: onWake заменяется на `createSessionWakeRefresher(() => tokens.getAccessToken(), () => tokens.refresh(), { onWake: () => { if (visible) conn.wakeUp(); } })` + `window.addEventListener('online', onWake)` (ретрай обрыва по online, дизайн §3(В)); cleanup += online.

- [ ] **Step 4: Монтирование** — `useSessionWakeRefresh(hostSession)` в host-gate, host-login-page, setup-page (room-страницы console/play/screen покрыты use-room-binding автоматически).

- [ ] **Step 5: Прогон** — PASS; полный сьют web зелёный (фикстуры exp!); гейты + `pnpm boundary-check`.

- [ ] **Step 6: Commit** — `feat(web): проактивный refresh по пробуждению — 401-цыпочки и warn-шум простоев сходят на нет (находка Н13)`.

---

## Батч C — focus-dim и UI-поверхности отказа

### Task 7: Затемнение нефокусного окна (play + console)

**Files:**
- Create: `apps/web/src/state/focus-dim.ts`, `apps/web/src/components/focus-dim.tsx`, `apps/web/src/state/use-focus-dim.ts`
- Modify: `apps/web/src/styles/tokens.css`, `apps/web/src/styles/transitions.css`, `apps/web/src/pages/play/play-page.tsx`, `apps/web/src/pages/host/console-page.tsx`
- Test: `apps/web/src/state/focus-dim.spec.ts`, `apps/web/src/styles/tokens.spec.ts` (fs-ассерты по прецеденту)

**Interfaces:**
- Consumes: ничего из предыдущих задач.
- Produces: `createFocusDimTracker(): { dimmed(): boolean; onBlur(): void; onFocus(): void; onVisibility(visible: boolean): void }` — dimmed ⟺ blurred && visible (Review Focus 4); `<FocusDim />` — null или оверлей `div.focus-dim` (`pointer-events: none`, решение 1) с текстом «Окно неактивно — кликните, чтобы продолжить» (черновик §4, финал на приёмке); `useFocusDim(): boolean`; CSS-класс `.focus-dim` + токен `--focus-dim-veil` (кандидат с комментарием, идиома среза).

- [ ] **Step 1: Падающие тесты** — трекер: начальное false; blur+visible → true; blur+hidden → false; focus → false; hidden→visible при удержанном blur → true; повторный blur без focus — без изменений.

- [ ] **Step 2: Прогон** — FAIL.

- [ ] **Step 3: Реализация** — трекер (чистый), хук (blur/focus на window, visibilitychange на document, cleanup), компонент, стили: `position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: var(--focus-dim-veil); pointer-events: none; z-index` выше контента; RM-блок: без transition/animation на `.focus-dim`.

- [ ] **Step 4: Монтирование** — `{dimmed && <FocusDim />}` в корне play-page (scene-контур) и console-page. Проектор НЕ трогаем (решение 2).

- [ ] **Step 5: tokens.spec** — fs-ассерт определения `--focus-dim-veil` и отсутствия сырого литерала в transitions.css (прецедент regex из среза).

- [ ] **Step 6: Прогон** — PASS; гейты.

- [ ] **Step 7: Commit** — `feat(web): затемнение нефокусного окна на play/console — съеденный macOS клик получает видимый смысл (находка Н1)`.

### Task 8: Play: busy-состояние и честные тексты отказа ответа

**Files:**
- Modify: `apps/web/src/pages/play/play-page.tsx` (answerErrorText :~35-48, submitAnswer :256-263, рендер кнопок вариантов)
- Test: `apps/web/src/pages/play/` — текст-маппинг выносится в чистую экспортируемую функцию (прецедент: open-question-label.ts); spec рядом

**Interfaces:**
- Consumes: коды `NOT_CONNECTED`/`PUBLISH_TIMEOUT` из T1.
- Produces: `answerErrorText` += кейсы NOT_CONNECTED/PUBLISH_TIMEOUT → «Нет подтверждения ответа — проверьте, не засчитан ли он, и нажмите ещё раз.» (решение 7; финальная редакция §4). Busy: `answerSubmitting: boolean` — кнопки вариантов disabled + индикация на время полёта.

- [ ] **Step 1: Падающий тест** — текст-маппинг: `answerErrorText(new ApiError('NOT_CONNECTED', 0))` и `('PUBLISH_TIMEOUT', 0)` → строка содержит «Нет подтверждения»; неизвестный код → прежний честный код; TypeError → «Ошибка сети…» (прежнее).

- [ ] **Step 2: Прогон** — FAIL.

- [ ] **Step 3: Реализация** — маппинг + busy: `submitAnswer` ставит `setAnswerSubmitting(true)` до publish, сброс в `finally`; disabled на кнопках вариантов пока `answerSubmitting`; визуальная индикация «Отправляю…» по дисциплине страницы.

- [ ] **Step 4: Прогон** — PASS; гейты.

- [ ] **Step 5: Commit** — `fix(web): ответ участника — busy-состояние и честный отказ «нет подтверждения» (находка Н1)`.

### Task 9: Console: busy и тексты для publish-команд и кнопок события

**Files:**
- Modify: `apps/web/src/pages/host/console-page.tsx` (commandErrorText :26-29, sendCommand :~160-180, complete/cancel), `apps/web/src/pages/host/quiz-controls.tsx`
- Test: `apps/web/src/pages/host/console-page.spec.ts` (прецедент существует)

**Interfaces:**
- Consumes: коды T1.
- Produces: `commandErrorText` += NOT_CONNECTED/PUBLISH_TIMEOUT → «Нет подтверждения команды — проверьте, не применилась ли она, прежде чем повторять.» (решение 7); busy: одна команда в полёте на QuizControls (кнопки команд disabled) + прежний `completing` распространяется текстом «Завершаем…» (уже есть disabled — добавить индикацию).

- [ ] **Step 1: Падающий тест** — commandErrorText кейсы NOT_CONNECTED/PUBLISH_TIMEOUT → «Нет подтверждения…»; прочее — прежнее.

- [ ] **Step 2: Прогон** — FAIL.

- [ ] **Step 3: Реализация** — маппинг; `commandPending: boolean` в console-page: sendCommand ставит/сбрасывает в finally, прокидывается в QuizControls пропом (disabled на кнопках команд); complete/cancel — прежний `completing` + текст занятости.

- [ ] **Step 4: Прогон** — PASS; гейты.

- [ ] **Step 5: Commit** — `fix(web): команды ведущего — busy и честный отказ «нет подтверждения» (находка Н1)`.

---

## Батч D — REST-контуры консоли и документация

### Task 10: Busy-состояния REST-действий консоли и setup

**Files:**
- Modify: `apps/web/src/pages/host/members-panel.tsx` (exclude), `prizes-panel.tsx` (create/draw), `awards-panel.tsx` (fulfill/revoke), `setup-page.tsx` (submit)
- Test: существующие spec'ы панелей (members-panel.spec.ts, prizes-panel.spec.ts) — если чистая логика затронута; иначе typecheck

**Interfaces:**
- Consumes: T2 (таймаут гарантирует settle — busy не зависнет).
- Produces: единообразие: у каждой REST-кнопки in-flight гард (disabled + индикация «Отправляю…»/«Завершаем…» по месту), ошибка — через существующие поверхности панелей.

- [ ] **Step 1: Инвентаризация** — пройти панели, у каждого сетевого действия либо есть in-flight гард, либо добавить `pending` state: set перед вызовом, сброс в finally.
- [ ] **Step 2: Реализация** по списку шага 1; тексты отказов не меняются (поверхности есть).
- [ ] **Step 3: Прогон** — гейты web зелёные.
- [ ] **Step 4: Commit** — `fix(web): busy-состояния REST-действий консоли и setup (находка Н1)`.

### Task 11: Документация environmentного механизма и приёмочные строки

**Files:**
- Modify: `docs/sessions/2026-10-19-design-ui-acceptance-checklist.md` (раздел наблюдений/остатка)

- [ ] **Step 1:** В чеклист — наблюдение: «macOS тратит первый клик по окну на активацию, когда frontmost — другое приложение (подтверждено зондом в Safari/Chromium/Chrome, сессия 56); страница событий не получает. Митигaция — затемнение нефокусного окна (T7); лечения кодом нет — это оконный сервер ОС.»
- [ ] **Step 2:** Строки живой приёмки новых поведений (⬜): (а) 5.5-re-run: iPhone Wi-Fi off/on ~10 с при открытом вопросе → участник остаётся в комнате, баннер «Нет соединения», reconnect с пересчитанным таймером; (б) затемнение: фокус в другое приложение → вуаль на play и console, фокус назад → снята; проектор без вуали; (в) publish-отказ: заглушить сеть, «Открыть вопрос» → через ~5 с «Нет подтверждения…», повтор после восстановления сети работает; (г) сверка лога стенда: warn-цыпочки jwt expired при простоях резко сокращены.
- [ ] **Step 3: Commit** — `docs(acceptance): environmentный механизм Н1 + строки приёмки фикса Н1/Н13`.

---

## Self-review (зафиксировано для ревью владельцем)

1. **Покрытие спеки:** дизайн §3(А)→T7, §3(Б)→T1/T2/T8/T9/T10, §3(В)→T3/T4/T5, §3(Г)→T6, §3(Д)→T11, решение 7→тексты T8/T9. Пробелов нет.
2. **Интерпретации плана (не буква дизайна):** (I-1) классификация терминальности обобщена до «ApiError 4xx» — покрывает и refresh-401 (буква §3(В)), и rejoin-отказы join (403/404/409) одним предикатом; (I-2) ack-таймаут реализован гонкой в RoomConnection, а не `socket.timeout()` — SocketLike не меняется, логика unit-тестируема без сети; (I-3) play/screen получают проактивный refresh через use-room-binding (они room-страницы), standalone-хук нужен только host-страницам без привязки; (I-4) `decodeAccessClaims.exp` — обязательное поле: серверные токены всегда с exp, фикстуры session.spec.ts дополняются в T6.
3. **Консистентность типов:** `isTerminalSessionFailure`, `rejoinFailureAction`, `accessTokenDueSoon`, `createSessionWakeRefresher`, `createFocusDimTracker`, коды NOT_CONNECTED/PUBLISH_TIMEOUT/SUBSCRIBE_TIMEOUT — используются в поздних задачах ровно как определены в ранних.
4. **Review Focus:** 6/6 строк имеют пины-тесты в задачах-владельцах (T1/T2/T4/T5/T6/T7).
5. **Пропорция:** план ~4× спеки по объёму, кодовые тела — только тестовые ассерты и сигнатуры; реализационные тела не транскрибированы.
6. **Риски исполнения:** (а) T1 шаг 2 — FakeSocket программирует «зависание», late-ack пин частично статический (честно помечено в тесте); (б) T7 z-index/вуаль — визуальная проверка на приёмке, DOM-тестов нет (идиома); (в) T6 фикстуры exp — самый вероятный источник красного прогона, шаг 5 это предусматривает.
