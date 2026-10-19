# Дизайн/UI-срез — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (установленный метод репозитория: свежий субагент-имплементер на задачу, таск-ревью, финревью батча). Steps use checkbox (`- [ ]`) syntax. **Исполнение — батчами по 3 задачи, каждый батч новой сессией (правило владельца).**

**Goal:** Перевести все три контура web-клиента (участник, проектор, консоль) на утверждённый визуальный язык и добавить три функциональности среза: таймер вопроса, ростер-«забег», live-ростер через `core.member.joined`.

**Architecture:** Backend-изменения минимальны и идут первыми: SDK-реестр core-событий += `member.joined`, ядро коммитит его в join-транзакции (через вынос EventLog-примитивов в отдельный модуль — иначе цикл DI), app-quiz v3 (обязательная длительность вопроса + серверный `openedAt` в payload `question.opened`). Web получает `styles/` (токены/база/состояния), self-hosted woff2, чистые вычислительные модули (таймер, дорожки) с юнит-тестами и перевёрстку контуров по мокапам-эталонам.

**Tech Stack:** TS strict, zod v4, NestJS (ядро), React 18 + Vite (web), jest/vitest, playwright. **Ноль новых npm-зависимостей во всём срезе** (шрифты — файлы в `public/`).

**Spec:** `docs/sessions/2026-10-19-design-ui-slice-design.md` (принят владельцем 2026-10-19). При расхождении документ важнее мокапов; мокапы — эталоны разметки (пути в каждой задаче).

## Global Constraints

- Токены и значения — verbatim из дизайн-дока §4/§8 (палитры, 140/60/300 мс, focus 3px/offset 2px, disabled 0.55, `@media (hover:hover) and (pointer:fine)`, reduced-motion).
- REQ-SEC-009: displayName НЕ попадает в лог/провод — payload `member.joined` = только identityId.
- REQ-RT-009: actorId — только из аутентифицированного контекста/серверной стороны, не из клиентского payload (касается и `openedAt`: сервер перезаписывает).
- REQ-RT-006: `socket.io-client` — только `apps/web/src/realtime/`; серверный socket.io — только `packages/core/src/realtime`.
- REQ-CORE-008: `correctAnswers` остаётся module-private; `durationSec` — public (наследует аннотацию `questions`).
- REQ-RWD-009: «Завершить событие» не блокируется невручёнными наградами.
- REQ-CTR-004: CONTRACT_VERSION ≡ package.json version SDK.
- Один lockfile (REQ-DEV-002); TDD (тест первым, REQ-DEV-001); CI-порядок build → boundary-check не ослабляется.
- Blagovest в репозиторий НЕ попадает (гейт лицензии, дизайн п. 4); логотип — Oranienbaum через отдельный токен `--font-logo`.
- Дореформенный словарь — только Приложение A (решение владельца №19); рабочие подписи и пользовательский контент не преобразуются.
- apps/server e2e резолвит `@mymozhem/core` из dist, core резолвит `@mymozhem/sdk` из dist: перед e2e — `pnpm build` (HANDOFF «Долгоживущие ограничения»).
- Команды гейтов: `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:int` (веб e2e — T13), `pnpm boundary-check`, `pnpm guardrails`.

## Review Focus

Классы входов, которые спека подразумевает, но ни один задачный тест не должен пропустить (по убыванию вероятности укуса; каждый запинан тестом в задаче-владельце):

1. **Reconnect/поздний вход при открытом вопросе:** таймер обязан показать фактический остаток, а не полный — snapshot перефолдится, `openedAt` едет в payload. Пин: T5 (unit `remainingSec` от давнего/свежего `openedAt`), T13 (playwright: reload участника mid-question → таймер не сбросился).
2. **Часы клиента впереди сервера** (`openedAt` в будущем): остаток не превышает `durationSec` (clamp). Пин: T5 unit.
3. **Join-шторм на старте события** (десятки `member.joined` подряд): рефетч ростера не чаще раза в 2 с. Пин: T12 unit (дедуп).
4. **«Без лимита»** (`durationSec: null`): таймера нет ни на одном контуре, на кнопке «Открыть вопрос N» нет длительности. Пин: T5 unit (null→null), T9 unit (`openQuestionLabel` без суффикса).
5. **Длинный контент** (6 вариантов, длинный вопрос/имена): переносы, двухколоночная плотность проектора, страничный скролл, имена не обрезаются. Класс визуальный — пин: T13 smoke (длинный вопрос виден целиком на проекторе) + строки чеклиста T14.

---

## Батч A — контракт, ядро, квиз (задачи 1–3)

### Task 1: SDK — событие `member.joined`, контракт 2.1.0

**Files:**
- Modify: `packages/sdk/src/events/core-events.ts` (CORE_EVENTS :21-42)
- Modify: `packages/sdk/src/contract-version.ts:8`, `packages/sdk/package.json:3`
- Test: `packages/sdk/src/events/core-events.contract.spec.ts`

**Interfaces:**
- Produces: `CORE_EVENTS['member.joined'] = { schema: z.strictObject({ identityId: z.uuid() }), visibility: 'public', version: 1 }`; `coreEventType('member.joined')` → `'core.member.joined'`; `CONTRACT_VERSION = '2.1.0'`. Потребители: T2 (ядро), T12 (web-триггер по строке типа).

- [ ] **Step 1: Failing test** — в `core-events.contract.spec.ts`: точный список ключей (:5-11) += `'member.joined'`; кейсы payload: `{identityId: uuid}` валиден, `{}` отклонён, лишний ключ отклонён (strict), не-uuid отклонён; visibility public; version 1.
- [ ] **Step 2:** `pnpm --filter @mymozhem/sdk test` — RED (ключа нет).
- [ ] **Step 3:** Добавить запись в `CORE_EVENTS` (по прецеденту `room.activated`); `CONTRACT_VERSION = '2.1.0'`; `package.json` version `2.1.0`.
- [ ] **Step 4:** `pnpm --filter @mymozhem/sdk test` — GREEN (включая `contract-version.contract.spec.ts` — парность версий).
- [ ] **Step 5:** `pnpm --filter @mymozhem/sdk build && pnpm build` — сборка всего дерева (core/web резолвят dist).
- [ ] **Step 6: Commit** `feat(sdk): core-событие member.joined (payload identityId, public) — CONTRACT_VERSION 2.1.0`.

### Task 2: Core — `EventLogModule` + коммит `member.joined` в join

**Files:**
- Create: `packages/core/src/realtime/event-log.module.ts`
- Modify: `packages/core/src/realtime/realtime.module.ts` (провайдеры RealtimeBus/EventOutbox/EventLogService/EventEmitLimiter выносятся; += imports/exports EventLogModule)
- Modify: `packages/core/src/membership/membership.module.ts` (imports += EventLogModule)
- Modify: `packages/core/src/membership/membership.service.ts` (join:203-268; конструктор :35-43)
- Test: `packages/core/src/membership/membership.service.int-spec.ts`; `apps/server/test/realtime.e2e-spec.ts`

**Interfaces:**
- Consumes: T1 (`coreEventType('member.joined')`, схема в CORE_EVENTS).
- Produces: `EventLogModule` (imports `PrismaModule, ConfigModule, MetricsModule`; providers `RealtimeBus, EventOutbox, EventLogService, EventEmitLimiter` — фабрика лимитера переезжает verbatim; exports все четыре). `RealtimeModule` реэкспортирует `EventLogModule` (потребители Room/Rewards/AppRuntime не меняются). `MembershipService` конструктор += `EventOutbox, EventLogService` (последними параметрами). Потребители: ручные конструирования `MembershipService` в int-спеках (см. шаг 4).

Контекст (из разведки): AppRegistryService — global (AppRegistryModule.register), EventLogModule его не импортирует; в unit/int-спеках модули собираются вручную — сборка `EventLogService` по прецеденту `membership.service.int-spec.ts:49-68`.

- [ ] **Step 1: Failing int-test** — `membership.service.int-spec.ts`: после успешного guest-join `readRoomLog` содержит `core.member.joined` с `payload.identityId === identity.id`, `actorId === identity.id`, visibility `public`; spectator-join тоже эмитит; отказанный join (exclusion по IP) события НЕ даёт.
- [ ] **Step 2:** `pnpm --filter @mymozhem/core test:int -- membership.service` (форма без `--`, фильтр проверить на >0 матчей) — RED.
- [ ] **Step 3: Рефактор-модуль.** Создать `event-log.module.ts` (провайдеры/экспорты по Interfaces); `realtime.module.ts`: убрать перенесённые провайдеры, imports/exports += `EventLogModule`. Прогон `pnpm test:int` (core) + `pnpm build` — всё зелёное до изменения поведения (рефактор под существующими тестами).
- [ ] **Step 4: Коммит в join.** `MembershipService` конструктор += `EventOutbox, EventLogService`; тело tx в `join()` (`prisma.$transaction`, :251-267) оборачивается в `this.outbox.run(async (tx) => …)`, последним шагом в tx — `commitCoreEvent(tx, room.id, 'member.joined', { identityId: identity.id }, identity.id)` (advisory lock leaf-most — коммит после всех записей; конвенция HANDOFF). Обновить ручные конструирования `MembershipService` в int-спеках (grep `new MembershipService`): добавить сборку EventOutbox/EventLogService по прецеденту того же файла (:49-68). **DI-рипл:** тестовые модули, импортирующие `MembershipModule` (guest-sweep.int-spec, rewards.int-spec, transport-спеки), теперь транзитивно тянут `EventLogService` → `AppRegistryService`; где нет глобального `AppRegistryModule.register` — добавить `AppRegistryModule.register([])` по прецеденту `rooms-lifecycle.controller.int-spec.ts` (тот же класс связки через RoomModule→RealtimeModule там уже решён).
- [ ] **Step 5:** int-test GREEN; `pnpm test` (core unit) GREEN.
- [ ] **Step 6: Failing e2e** — `apps/server/test/realtime.e2e-spec.ts`: подписанный гость получает live `core.member.joined` (хелпер `waitEvent(socket, REALTIME_MESSAGES.EVENT)`, :147-149), когда второй гость join'ится по HTTP; payload.identityId совпадает с identityId из join-ответа второго. RED → реализация уже на месте (шаг 4) → GREEN. Порядок: waiter навешивается ДО HTTP-join (опыт Quiz-среза: live-кадр может прийти раньше ack).
- [ ] **Step 7:** Полные гейты: `pnpm build && pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm boundary-check && pnpm guardrails`. Внимание: логи e2e теперь содержат `member.joined` — seq-плотность ассертится относительно baseline (ruling ф.2), PII-цикл quiz-points не затронут (payload id-only); абсолютные seq-ассерты, если всплывут, правятся под новый baseline.
- [ ] **Step 8: Commit** `feat(core): member.joined — публичное событие ядра при join (EventLogModule выносит EventOutbox/EventLogService из RealtimeModule)`.

### Task 3: app-quiz v3 — `durationSec` + серверный `openedAt`

**Files:**
- Modify: `packages/app-quiz/src/quiz-settings.ts:7` (элемент вопроса), `packages/app-quiz/src/quiz-events.ts:4`, `packages/app-quiz/src/quiz-handlers.ts:31-47` (openQuestion), `packages/app-quiz/src/quiz-state.ts:36-45`, `packages/app-quiz/src/quiz-manifest.ts:14`
- Test: `packages/app-quiz/src/quiz-manifest.contract.spec.ts`, `packages/app-quiz/src/quiz-handlers.spec.ts`, `packages/app-quiz/src/quiz-state.spec.ts`
- Ripple: `apps/web/src/state/fixtures/quiz-log.fixture.ts` (:16 manifestVersion, :20-24/:54-58 question.opened), `packages/app-quiz/src/quiz-manifest.contract.spec.ts:42-45` (пин версии)

**Interfaces:**
- Produces: `QUIZ_MANIFEST_VERSION = 3`; элемент вопроса `durationSec: z.number().int().min(5).max(600).nullable().default(30)` (input-режим регистрации — ключ необязателен на гейте, C-9.1; `null` = «без лимита»); `questionOpenedPayload = strictObject({ questionIndex: int≥0, openedAt: z.iso.datetime().optional() })`; коммит `question.opened` всегда несёт `openedAt = ctx.now` (перезапись клиентского); `QuizState.openedAt` = `payload.openedAt ?? event.recordedAt`. Потребители: T5 (таймер), T9 (кнопка с длительностью), T10 (редактор).
- Эффект редеплоя: реестр знает только v3; комнаты quiz@2 после редеплоя → `APP_MANIFEST_UNKNOWN` на dispatch (принято дизайном §13, прецедент lottery@1).

- [ ] **Step 1: Failing tests** — `quiz-manifest.contract.spec.ts`: версия 3; appSettings-кейсы: `durationSec` опущен — валидно (input-режим), `3` — невалидно, `600` — валидно, `601` — невалидно, `null` — валидно; `question.opened` payload: `{questionIndex}` валидно, `{questionIndex, openedAt: ISO}` валидно, extra key невалидно (strict сохранён).
- [ ] **Step 2: Failing tests** — `quiz-handlers.spec.ts`: коммит `question.opened` несёт `openedAt === ctx.now` (exact-match ожидания :104-110, :405-420 обновить); клиентский `openedAt` в publish перезаписывается `ctx.now` (REQ-RT-009). `quiz-state.spec.ts`: `openedAt` из payload при наличии; fallback на `event.recordedAt` при отсутствии.
- [ ] **Step 3:** `pnpm --filter @mymozhem/app-quiz test` — RED.
- [ ] **Step 4:** Реализация по Interfaces (схемы, handler, reducer, константа версии).
- [ ] **Step 5:** GREEN app-quiz; `pnpm --filter @mymozhem/app-quiz build`.
- [ ] **Step 6: Риплы.** `quiz-log.fixture.ts` (web): `manifestVersion: 3`, `question.opened` += `openedAt`. Прогоны: `pnpm --filter @mymozhem/web test`, `pnpm build && pnpm --filter @mymozhem/server test` (quiz.e2e / quiz-points едут на константе — проверить :8/:180/:186/:288-300), `pnpm test:int`.
- [ ] **Step 7: Commit** `feat(app-quiz): манифест v3 — durationSec вопроса (5–600|null, дефолт 30) + серверный openedAt в question.opened`.

---

## Батч B — визуальный фундамент и вычислимое (задачи 4–6)

### Task 4: `styles/` — токены, база, состояния, шрифты

**Files:**
- Create: `apps/web/src/styles/tokens.css`, `apps/web/src/styles/base.css`, `apps/web/src/styles/transitions.css`, `apps/web/public/fonts/` (woff2)
- Modify: `apps/web/src/main.tsx:5` (импорты), `apps/web/index.html` (`data-theme`), Delete: `apps/web/src/styles.css` (его `.screen-question`/`.screen-options` переезжают в base.css как есть — замена в T8)
- Test: `apps/web/src/styles/tokens.spec.ts`

**Interfaces:**
- Produces: токены (имена семантические, значения verbatim дизайн §4 + принятый мокап `component-states-live.html`): сцена `--scene-bg #0A252B, --scene-surface #1B3B40, --scene-surface-hover #23484D, --scene-surface-active #122E32, --gold #E6C77D, --scene-text #F6EDDC, --muted-scene #9DB8B2, --error-dark #F27668, --input-scene #A9BDB2, --track-fill #0F7B57, --track-canvas-dark #143138`; консоль `--console-bg #E3F0E9, --console-panel #F4F8F3, --console-strip #D7E8DE, --console-secondary #C4D8CC, --console-primary #10514F, --console-primary-hover #17685F, --console-primary-active #0A3E3B, --console-secondary-hover #B4CDBC, --console-secondary-active #A3BFA9, --ink #12343A, --muted #5A6B66, --error-light #A92820, --track-canvas-light #D5E2DA, --danger-hover #F3DCD2, --danger-active #ECCFC4`; тайминги `--t-hover 140ms, --t-press 60ms, --t-race 300ms`; шрифты `--font-logo` (до лицензии = `'Oranienbaum'`), `--font-display: 'Oranienbaum'`, `--font-body: 'PT Sans'`. transitions.css — кнопочная система из мокапа verbatim (`.btn`, `.btn-primary/-secondary/-quiet/-danger`, `.btn-scene`; hover только `@media (hover:hover) and (pointer:fine)`; active ≤60мс; focus-visible 3px offset 2px, на сцене золотой; disabled 0.55 без hover/active; reduced-motion гасит переходы). Точка темы: `<html data-theme="rybinsk">`, токены под `:root`, комментарий «вторая тема = переопределение токенов под `[data-theme=…]`» (готовность без пресетов, дизайн п. 5).
- Шрифты: woff2 Oranienbaum (400) и PT Sans (400, 700), кириллица, OFL — скачать с Google Fonts (только инструмент получения woff2; в рантайме обращений к Google нет) в `apps/web/public/fonts/`; `@font-face` в base.css, `font-display: swap`. Blagovest НЕ скачивать/не коммитить.

- [ ] **Step 1: Failing test** — `tokens.spec.ts` (node, `fs.readFileSync` tokens.css/transitions.css): каждый токен из Interfaces присутствует с точным значением; hover-блок обёрнут в `(hover: hover) and (pointer: fine)`; reduced-motion блок есть; `.btn` без `border` (grep-ассерт `border: none`).
- [ ] **Step 2:** `pnpm --filter @mymozhem/web test` — RED.
- [ ] **Step 3:** Файлы по Interfaces; woff2 скачаны и подключены; `main.tsx` импортирует три новых css вместо `styles.css`; `index.html` += `data-theme`.
- [ ] **Step 4:** GREEN + `pnpm --filter @mymozhem/web build` (vite подхватывает public/fonts).
- [ ] **Step 5: Commit** `feat(web): styles/ — токены, база, состояния, self-hosted шрифты (Oranienbaum/PT Sans, OFL)`.

### Task 5: Таймер — чистая логика + хук

**Files:**
- Create: `apps/web/src/state/question-timer.ts`
- Test: `apps/web/src/state/question-timer.spec.ts`

**Interfaces:**
- Produces: `remainingSec(durationSec: number | null, openedAt: string | null, nowMs: number): number | null` — `null` duration («без лимита») → `null`; `null` openedAt → `null`; иначе `clamp(durationSec - floor((nowMs - Date.parse(openedAt))/1000), 0, durationSec)`. `formatTimer(sec: number): string` — `m:ss`. `useQuestionTimer(durationSec: number | null, openedAt: string | null): number | null` — setInterval 1000ms, cleanup; без DOM-теста (паттерн репо: чистая функция тестируется, хук — typecheck). Потребители: T7, T8, T9.

- [ ] **Step 1: Failing test** — кейсы: без лимита → null; не открыт → null; ровно 30 → `0:30`; стоит на нуле (`0:00`, без отрицательных); Review Focus 1 (openedAt 20 с назад при 30 → 10; openedAt час назад → 0); Review Focus 2 (openedAt в будущем → durationSec, не выше); `formatTimer(65)` → `1:05`.
- [ ] **Step 2:** `pnpm --filter @mymozhem/web test` — RED.
- [ ] **Step 3:** Реализация + хук.
- [ ] **Step 4:** GREEN, typecheck.
- [ ] **Step 5: Commit** `feat(web): question-timer — remainingSec/formatTimer/useQuestionTimer (тик 1 с, clamp 0..durationSec)`.

### Task 6: Дорожки — чистая логика + компонент RaceTracks

**Files:**
- Create: `apps/web/src/state/race-tracks.ts`, `apps/web/src/components/race-tracks.tsx`
- Test: `apps/web/src/state/race-tracks.spec.ts`

**Interfaces:**
- Consumes: `ProjectedEvent` из SDK; payload `question.revealed` (`awarded: [{actorId, points}]`) из `@mymozhem/app-quiz`.
- Produces: `lastRoundGains(events: ProjectedEvent[]): Record<string, number>` — `awarded` ПОСЛЕДНЕГО `quiz.question.revealed` (прирост за раунд из перефолженного лога, дизайн §7 — reconnect-safe); `trackWidths(entries: {actorId, total}[], gains): Map<string, {fillPct, gainPct}>` — нормировка к лидеру (=100%), fill = (total−gain)/leader, gain = gain/leader, лидер 0/все нули → всё 0 (пустая дорожка); `topNWithRest<T>(list: T[], n: number): { top: T[]; rest: number }`; `myPlace(sortedEntries, myId): number | null`. Компонент `<RaceTracks entries={[{actorId, name, total, gain}]} highlightId? topN? contour="scene"|"console" />` — разметка по мокапу `component-states-live.html` (`.track-row/.tr-top/.tr-lane/.fill/.gain`, tabular-nums, transition var(--t-race); полотно: сцена `--track-canvas-dark`, консоль `--track-canvas-light`), «ещё N» при `topN`; DOM-тестов нет (паттерн репо), верификация T13. Потребители: T7, T8, T9.

- [ ] **Step 1: Failing test** — лидер-нормировка (1500/1200/900 → 100/80/60), прирост-сегмент (gain отделён от fill), нулевой лидер → пустые дорожки, нулевой gain → gainPct 0, `lastRoundGains` берёт последний reveal (два reveal подряд), `topNWithRest([…7], 4)` → rest 3, `myPlace` (плотный порядок desc, отсутствующий → null).
- [ ] **Step 2:** RED.
- [ ] **Step 3:** Реализация логики + компонент.
- [ ] **Step 4:** GREEN, typecheck.
- [ ] **Step 5: Commit** `feat(web): race-tracks — логика дорожек (нормировка к лидеру, прирост из последнего reveal) + компонент RaceTracks`.

---

## Батч C — сцена и консольный каркас (задачи 7–9)

### Task 7: Контур участника (`/play`)

**Files:**
- Modify: `apps/web/src/pages/play/play-page.tsx`, `apps/web/src/pages/play/join-form.tsx`
- Create: `apps/web/src/components/logo.tsx`
- Test: расширение существующих спеков чистых функций при касании (join-form.spec); unit для `myPlace`-интеграции уже в T6
- Эталоны: `participant-join-lobby-center-fix.html`, `participant-flow-layout-v2.html`, `participant-long-content.html`, `game-states.html`, `timer-projector-participant.html`, `tracks-scene-with-logo.html` (сессии 44/45)

**Interfaces:**
- Consumes: T4 (токены/кнопки), T5 (`useQuestionTimer`), T6 (`RaceTracks`, `lastRoundGains`, `myPlace`), T3 (`durationSec` из `appSettings.questions[i]`, `QuizState.openedAt` из payload).
- Produces: `<Logo contour="scene" size="participant" />` — «МЫ МОЖЕМЪ», `font-family: var(--font-logo)`, золото, 19px по центру вверху (все экраны контура, дизайн п. 17). Потребитель Logo также T8 (22px top-left) и T9.

- [ ] **Step 1:** Вход: заголовок «Входъ в игру» (Приложение A), поля `--input-scene` с золотыми подписями, кнопка «Играть» `.btn .btn-primary`? — НЕТ: сцена, вариант кнопки по мокапу входа (`participant-join-lobby-center-fix.html`), верхний отступ 34px.
- [ ] **Step 2:** Ожидание: центрирование `top: 50%` + `translateY(-50%)` относительно всей высоты (логотип/заголовок не влияют).
- [ ] **Step 3:** Вопрос: таймер 40px в верхней строке (при `durationSec !== null`), логотип, отступ перед вариантами 30px, варианты `.btn-scene` (поверхность, рост по высоте, переносы). Страничный скролл, без внутренних.
- [ ] **Step 4:** Reveal: вердикт «Верно!/Неверно./Вы не успели ответить.» + «+N очков», «Правильный отвѣтъ» (Приложение A), табло = `RaceTracks` полное с `highlightId` («это ты») и местом в шапке (`myPlace`).
- [ ] **Step 5:** Финал: полное табло дорожками + `Winners` только при наличии розыгрыша (дизайн п. 18: в логе есть `lottery.draw.completed`).
- [ ] **Step 6:** `pnpm --filter @mymozhem/web test && pnpm --filter @mymozhem/web typecheck && pnpm --filter @mymozhem/web lint`.
- [ ] **Step 7: Commit** `feat(web): контур участника по дизайн-срезу (вход/ожидание/вопрос с таймером/reveal с дорожками/финал)`.

### Task 8: Контур проектора (`/screen`)

**Files:**
- Modify: `apps/web/src/pages/screen/screen-page.tsx` (старые `.screen-question`/`.screen-options` из base.css заменяются финальными стилями)
- Эталоны: `projector-options-no-lines.html`, `projector-final-winners-large.html`, `projector-long-content.html`, `timer-projector-participant.html`, `tracks-scene-with-logo.html`

**Interfaces:**
- Consumes: T4, T5, T6, `Logo` (T7).
- Produces: проекторная раскладка (без интерактива).

- [ ] **Step 1:** Каркас: фон сцены, логотип 22px золотом левый верхний на всех экранах (включая вопрос с таймером — дизайн п. 17).
- [ ] **Step 2:** Вопрос: Oranienbaum 38px, таймер 56px золотом справа вверху (`--gold`, tabular-nums, по мокапу), варианты — две колонки (grid 1fr 1fr), отступ перед вариантами 35px, без золотых вертикальных линий; компактная плотность при длинном контенте (мокап `projector-options-no-lines`).
- [ ] **Step 3:** Reveal: «Правильный отвѣтъ» слева, дорожки справа — `topNWithRest(…, 4)` + «ещё N».
- [ ] **Step 4:** Финал: топ-5 + «+ ещё N участников»; победители — центрированный блок справа (заголовок 32px, имена 24px); **без розыгрыша блок победителей не рендерится, табло центрируется на всю зону** (дизайн п. 18).
- [ ] **Step 5:** Гейты web (test/typecheck/lint/build).
- [ ] **Step 6: Commit** `feat(web): контур проектора по дизайн-срезу (логотип, таймер 56px, дорожки топ-4/топ-5, финал без розыгрыша)`.

### Task 9: Консоль — каркас, игра, reveal, «Квиз окончен»

**Files:**
- Modify: `apps/web/src/pages/host/console-page.tsx`, `apps/web/src/pages/host/quiz-controls.tsx`
- Delete: `apps/web/src/components/standings.tsx` (последний потребитель мигрирует здесь; play/screen ушли в T7/T8)
- Create: `apps/web/src/pages/host/open-question-label.ts` (или в quiz-controls — чистая функция)
- Test: `apps/web/src/pages/host/quiz-controls.spec.ts` (расширение), `apps/web/src/pages/host/console-page.spec.ts` (расширение)
- Эталоны: `console-reveal-final-button.html`, `console-phone-landscape-v2.html`, `console-quiz-finished.html`, `console-empty-long-errors-v2.html`

**Interfaces:**
- Consumes: T4 (палитра консоли, кнопки), T5, T6, T3 (`durationSec`), питание `pinnedAppId` (console-page:69-77) не меняется.
- Produces: `openQuestionLabel(index: number, durationSec: number | null): string` — `'Открыть вопрос N'` + ` (30 с)` при числе, без суффикса при null (Review Focus 4). Иерархия консоли: статус → момент → действие.

- [ ] **Step 1: Failing test** — `openQuestionLabel`: (2, 30) → «Открыть вопрос 3 (30 с)»; (2, null) → «Открыть вопрос 3».
- [ ] **Step 2:** Каркас: палитра консоли (фон/панели/полоса комнаты), иерархия «статус → момент → следующее действие», ландшафт-правило — `@media (orientation: landscape) and (max-height: 400px)`: две колонки, действия справа; первый экран = статус + момент + главная кнопка без прокрутки.
- [ ] **Step 3:** Игра: таймер (useQuestionTimer) + счётчик ответов в блоке момента; главная кнопка закрытия. Тихая «Завершить событие» внизу (`.btn-quiet`), не блокируется наградами (REQ-RWD-009).
- [ ] **Step 4:** Reveal: ответ плашкой, разбор «верно/неверно/не успели», ростер = RaceTracks с приростом (`lastRoundGains`), топ-4 + «Ещё N» — разворот полного списка toggle (локальное состояние, I-5); главная кнопка `openQuestionLabel(next, durationSec)`.
- [ ] **Step 5:** «Квиз окончен» (`quiz.finished && status === 'ACTIVE'`): событие живо, главная кнопка «Завершить событие», подсказка невручённых наград — только если есть невручённые (п. 18).
- [ ] **Step 6:** Удалить `standings.tsx` и его импорты; промежуточное табло консоли = RaceTracks.
- [ ] **Step 7:** Гейты web + `pnpm build` + core/server не тронуты (прогон `pnpm test` корня).
- [ ] **Step 8: Commit** `feat(web): консоль — каркас «пульт ведущего», игра/reveal с дорожками и таймером, экран «Квиз окончен»`.

---

## Батч D — редактор, розыгрыш, live-ростер (задачи 10–12)

### Task 10: Редактор квиза и setup (поле длительности, radio-legend)

**Files:**
- Modify: `apps/web/src/pages/host/quiz-editor.tsx` (формы :7-18, buildQuizSettings :24-33, radio :133-139), `apps/web/src/pages/host/setup-page.tsx` (палитра консоли)
- Test: `apps/web/src/pages/host/quiz-editor.spec.ts`
- Эталоны: `console-editor.html`, `forms-and-system-states-v2.html`, `editor-secondary-button-darker.html`

**Interfaces:**
- Consumes: T3 (схема `durationSec`), T4 (палитра/кнопки консоли).
- Produces: `QuizQuestionForm += { durationSec: string; unlimited: boolean }` (строковое число, как прочие числовые поля); `buildQuizSettings` мапит: unlimited → `durationSec: null`, иначе число (дефолт `'30'`); radio-группа: один видимый `legend` «Правильный ответ» (современная орфография — рабочая подпись), доступные имена radio (`aria-label` «Вариант N — правильный»), повторяющийся label убран (дизайн п. 9).

- [ ] **Step 1: Failing test** — `buildQuizSettings`: дефолт → `durationSec: 30`; unlimited → `null`; границы 5/600 проходят zod-safeParse, 4/601 — общая ошибка формы; существующие кейсы (correctIndex при удалении варианта) зелёные.
- [ ] **Step 2:** RED.
- [ ] **Step 3:** Реализация: состояние/поля/маппинг; fieldset+legend разметка radio-группы; список вопросов с длительностями слева/полосой номеров (мокап); «+ Добавить вариант» `.btn-secondary`, «Сохранить и запустить» `.btn-primary` (#10514F унифицировано, п. 14).
- [ ] **Step 4:** GREEN + гейты web.
- [ ] **Step 5: Commit** `feat(web): редактор — поле «Время на ответ» (5–600/без лимита), radio-legend «Правильный ответ», палитра консоли`.

### Task 11: Консоль — розыгрыш, awards, завершение, пустые/ошибки

**Files:**
- Modify: `apps/web/src/pages/host/prizes-panel.tsx`, `apps/web/src/pages/host/awards-panel.tsx`, `apps/web/src/components/winners.tsx`, `apps/web/src/pages/host/console-page.tsx` (ветка COMPLETED)
- Эталоны: `console-draw-winner-larger.html`, `console-landscape-editor-draw-finish.html`, `console-empty-long-errors-v2.html`

**Interfaces:**
- Consumes: T4, T6.
- Produces: стилизованные панели; баннер победителя (имя 36px Oranienbaum — крупнейший элемент); завершение: hero, невручённые награды первыми, итоговый забег (RaceTracks).

- [ ] **Step 1:** Розыгрыш: баннер победителя 36px; безпризовая кнопка и prizes-формы — палитра консоли, `.btn`-классы; тихие кнопки без рамок (правило п. 15).
- [ ] **Step 2:** Завершение (COMPLETED): hero, невручённые награды первыми, итоговый забег; без наград — без блока (п. 18).
- [ ] **Step 3:** Пустые/длинные/ошибки по мокапу (`console-empty-long-errors-v2`), обе ориентации.
- [ ] **Step 4:** Гейты web.
- [ ] **Step 5: Commit** `feat(web): консоль — розыгрыш (победитель 36px), awards, завершение, пустые/ошибки`.

### Task 12: Live-ростер клиента (`member.joined`)

**Files:**
- Modify: `apps/web/src/state/roster-refetch.ts`, `apps/web/src/state/use-room-feed.ts` (комментарии :42, :65 устарели — «join не эмитит событий»)
- Test: `apps/web/src/state/roster-refetch.spec.ts`, `apps/web/src/state/use-room-feed`-уровень (чистая оркестрация)

**Interfaces:**
- Consumes: T1/T2 (`core.member.joined` едет live и в snapshot), существующий `createFocusRefetcher` (дедуп min-interval).
- Produces: `ROSTER_REFETCH_EVENTS += 'core.member.joined'`; событийный рефетч ростера дедуплицируется (min 2 с — Review Focus 3); рефетч — тот же `GET /rooms/:id/members` (payload без displayName, REQ-SEC-009).

- [ ] **Step 1: Failing test** — `shouldRefetchRoster('core.member.joined') === true`; дедуп: два `member.joined` в пределах 2 с → один вызов рефетча (чистая оркестрация по прецеденту focus-refetch.spec).
- [ ] **Step 2:** RED.
- [ ] **Step 3:** Реализация + правка устаревших комментариев (join теперь эмитит; focus-рефетч остаётся независимым триггером — дизайн §9).
- [ ] **Step 4:** GREEN + гейты web.
- [ ] **Step 5: Commit** `feat(web): live-ростер по core.member.joined (дедуп 2 с), устаревшие комментарии убраны`.

---

## Батч E — приёмка (задачи 13–14)

### Task 13: Playwright smoke — расширение под срез

**Files:**
- Modify: `apps/web/e2e/smoke.spec.ts`
- (Стенд: существующий compose; запуск по нормам репо — НЕ против production)

**Interfaces:**
- Consumes: все предыдущие задачи.

- [ ] **Step 1:** Существующий happy-path зелёный на новой вёрстке (селекторы поправить под новые классы/разметку; `.room-code strong` сохранить или обновить осознанно).
- [ ] **Step 2:** Новые ассерты: после открытия вопроса таймер виден участнику и проектору (формат `m:ss`); reveal → дорожки (`.tr-lane .fill` ширина > 0 у ответившего); reload участника mid-question → таймер не сбросился на полный (Review Focus 1); второй участник join → консоль видит его имя без перезагрузки (member.joined e2e через UI); консольный ландшафт-вьюпорт (~700×360) — главная кнопка видна без скролла; финал без розыгрыша — блок победителей отсутствует на проекторе (п. 18); длинный вопрос целиком виден на проекторе (Review Focus 5).
- [ ] **Step 3:** Прогон против локального стенда зелёный.
- [ ] **Step 4: Commit** `test(web): smoke-e2e под дизайн-срез (таймер, дорожки, live-ростер, ландшафт, финал без розыгрыша)`.

### Task 14: Чеклист приёмки на устройствах + сверка критериев

**Files:**
- Create: `docs/sessions/2026-10-19-design-ui-acceptance-checklist.md`

**Interfaces:**
- Consumes: весь срез. Образец: `2026-09-23-ui-slice-smoke-checklist.md`.

- [ ] **Step 1:** Чеклист: телефон обе ориентации + ноутбук + проектор с расстояния; hover/active/focus клавиатурой и тач; reduced-motion; woff2 загрузились (swap, без обращений к Google); логотип Oranienbaum (до лицензии); словарь Приложения A на месте и ничего лишнего; таймер на трёх контурах + «без лимита» + `0:00` без краснухи + reconnect-пересчёт; дорожки (лидер-нормировка, прирост, ноль, «ещё N»); live-ростер; «Квиз окончен»; финал без розыгрыша; длинный контент.
- [ ] **Step 2:** Сверка критериев приёмки дизайна §12 (8 критериев) — таблица с артефактами.
- [ ] **Step 3: Commit** `docs(sessions): чеклист приёмки дизайн/UI-среза + сверка критериев §12`.

---

## Приложение A — дореформенный словарь (решение владельца №19, утверждается с этим планом)

Полный список мест с дореформенным написанием (проверен по финальным мокапам):

| Место | Написание |
|---|---|
| Логотип (все экраны сцены) | «МЫ МОЖЕМЪ» |
| Заголовок вопроса (сцена: участник, проектор) | «Вопросъ N» |
| Reveal (сцена: участник, проектор) | «Правильный отвѣтъ» |
| Экран входа участника | «Входъ в игру» |

Всё остальное — современная орфография (включая legend редактора «Правильный ответ» и все рабочие подписи консоли). Пользовательский контент (тексты вопросов, имена) не преобразуется никогда. Расширение списка — только решением владельца.

## Self-review (интерпретации плана — фиксируются для ревью владельцем)

- **I-1:** `member.joined` эмитится только из `join()` (гость и spectator). Организаторская membership (`createOrganizerMembership` из `RoomService.create`) события не даёт — в момент создания комнаты ростер и так пуст.
- **I-2:** `openedAt` optional во входной схеме (клиент может опустить); handler ВСЕГДА перезаписывает `ctx.now` — клиентская подделка безэффективна (REQ-RT-009). Редьюсер: `payload.openedAt ?? event.recordedAt` — fallback сохраняет старые фикстуры/логи читаемыми.
- **I-3:** Цикл DI разрешён выносом `RealtimeBus/EventOutbox/EventLogService/EventEmitLimiter` в новый `EventLogModule` (пакет `realtime/`, boundary socket.io не затронут — модуль socket.io не импортирует). `RealtimeModule` реэкспортирует его; потребители (Room/Rewards/AppRuntime) не меняются; composition root не меняется.
- **I-4:** `standings.tsx` удаляется в T9, когда уходит последний потребитель (консоль); play/screen мигрируют в T7/T8.
- **I-5:** «Ещё N — развернуть» в консоли — toggle полного списка (локальное состояние компонента, между раундами схлопывается к топ-4).
- **I-6:** Дополнения к §4 дизайна из принятого мокапа `component-states-live.html` (там, где документ молчит): `--ink #12343A` (текст консоли), `--track-canvas-light #D5E2DA`, `--danger-hover/active`, `--muted`, `--muted-scene`. Это дополнение, не уточнение согласованного.
- **I-7:** `actorId` события `member.joined` = identityId входящего (актор — сам join'ящийся; прецедент publisher-событий), payload дублирует его же для удобства потребителя.
- **I-8:** Snapshot-реплей `member.joined` может дать один лишний рефетч при подписке — безвреден (дедуп 2 с + идемпотентный GET).
- **I-9:** Кнопки участника на сцене — по мокапу входа/вопроса (`.btn-scene` для вариантов; «Играть» — по `participant-join-lobby-center-fix.html`), класс `.btn-primary` консоли на сцене не используется.
- **I-10:** Затронутые REQ (срез не закрывает новых требований пакета — он визуальный + две фичи; перечислены принуждаемые инварианты): REQ-SEC-009 (T1/T2/T12), REQ-RT-009 (T3), REQ-RT-006 (T4-T12, boundary), REQ-CORE-008 (T3), REQ-RWD-009 (T9), REQ-CTR-004 (T1), REQ-DEV-001/002/003 (все задачи). Новые контрактные объекты: `core.member.joined` (SDK 2.1.0), quiz manifest v3.
- **I-11:** Тестовая стратегия визуального слоя — по дизайну §11: юнит на вычислимое, playwright-смоук, ручная приёмка; DOM-компонентных тестов нет (паттерн репо), скриншот-диффы отклонены.
- **I-12:** «Редактор» в состояниях консоли (дизайн §5.3) — это редактор на setup-странице host-контура (`quiz-editor.tsx` монтируется в `SetupPage`); после активации комнаты вопросы не редактируются (текущая семантика не меняется).
