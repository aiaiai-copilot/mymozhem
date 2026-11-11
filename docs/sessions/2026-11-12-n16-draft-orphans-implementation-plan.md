# Н16 (DRAFT-сироты) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Убрать класс DRAFT-сирот: комната рождается по явному действию, привязка организатора к комнатам — серверная (перечень «Мои события»), DRAFT хранит наполнение-черновик и удаляется мягко.

**Architecture:** Ядро (packages/core) получает GET /rooms/mine и DELETE /rooms/:roomId поверх существующего RoomService (softDelete уже есть); контракт — zod-схемы в @mymozhem/sdk (ADR-006). Web (apps/web): гейт /host и консоль переводятся с localStorage-привязки на серверный список; новая страница перечня; setup-страница — кнопка «Создать событие» + «Сохранить черновик» + resume-пrefill.

**Tech Stack:** NestJS (Fastify), Prisma, zod v4, React + react-router, vitest (web), jest (core/sdk/server e2e + testcontainers), playwright (smoke).

**Spec:** `docs/sessions/2026-11-12-n16-draft-orphans-design.md` (§0 — 11 решений владельца; §4 — builder-calls, считать утверждёнными). План реализует REQ-RT-005 (soft-delete DRAFT), REQ-SEC-003 (deletedAt в проверках), REQ-ID-005 (только REGISTERED), REQ-CTR-005 (контрактные тесты), REQ-DEV-001 (границы).

## Global Constraints

- zod v4: `z.strictObject`, `z.uuid()` (RFC-9562 version nibble обязателен), `z.iso.datetime()`; схемы ответов — только из `@mymozhem/sdk` (комментарий endpoints.ts).
- SDK minor-бамп 2.1.0 → 2.2.0; правило связки версии с contract-version.ts соблюсти (файл — источник правила).
- Идиома репо «DOM-тестов нет»: логика страниц выносится в чистые экспортируемые функции, тесты — на них.
- Wire-копия и формулировки — русские, стиль существующих (`submitErrorText`/`commandErrorText` прецеденты).
- Ответная `.parse` на границе контроллеров (прецедент RoomsController/RoomsLifecycleController); `@HttpCode(200)` для POST без создания, 204 для DELETE.
- Коммиты: conventional (`feat`/`test`/`refactor`), тело на русском допустимо, футер `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Исполнение: worktree на срез (superpowers:using-git-worktrees), батчи по 3 задачи, каждый батч — отдельная сессия (правило владельца); гейты после каждого батча: тесты + lint + typecheck + boundary-check.
- Один lockfile (REQ-DEV-002): зависимостей не добавляем — всё на существующих.

## Review Focus

1. **Двойной клик «Создать событие» / StrictMode-дубль** → ровно один POST /rooms (in-flight гард disabled по busy). Пин: T8 spec.
2. **Param `?room=` указывает на чужую/удалённую/отсутствующую комнату**: setup → «не найдена» + ссылка на перечень; console → navigate на перечень. Пины: T8 и T9 specs.
3. **Несколько ACTIVE** (теоретически возможно серверно): консоль берёт первую по `updatedAt` desc — сортировка сервера пинится в T2 (int), выбор «первой ACTIVE из отсортированного списка» — в T9 (spec).
4. **Невалидный черновик**: «Сохранить черновик» при невалидной форме → серверный отказ на той же поверхности ошибок, что «Сохранить и запустить»; форма не затирается. Пин: T7/T8 specs.
5. **Гость удалённой DRAFT** получает отказ на следующем чтении (REQ-SEC-003): `assertMember` → ACTOR_NOT_MEMBER. Пин: T2 (int).

---

## Батч A — контракт и сервер

### Task 1: SDK — схема my-rooms + delete-void

**Files:**
- Create: `packages/sdk/src/room/my-rooms.ts`
- Create: `packages/sdk/src/room/my-rooms.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts` (export после create-room-response блока)
- Modify: `packages/sdk/package.json` (version 2.1.0 → 2.2.0; contract-version правило — по файлу contract-version.ts)

**Interfaces:**
- Consumes: `roomStatusSchema` (`./create-room-response`), `appIdSchema` (`../events/event-type`).
- Produces: `myRoomItemSchema`, `myRoomsResponseSchema`, типы `MyRoomItem`/`MyRoomsResponse`, `deleteRoomResponseSchema` (`z.void()` — ответ 204).

- [ ] **Step 1: Failing contract test** `my-rooms.contract.spec.ts`

```ts
const ROOM_ID = '00000000-0000-4000-8000-000000000001';
// accept: пустая DRAFT { roomId: ROOM_ID, code: 'WXYZ2347', status: 'DRAFT',
//   appId: null, manifestVersion: null, appSettings: null,
//   createdAt: '2026-11-12T14:32:00.000Z', updatedAt: '2026-11-12T15:05:00.000Z' }
// accept: наполненная DRAFT (appId: 'quiz', manifestVersion: 3, appSettings: { questions: [] })
// accept: COMPLETED с appSettings; массив из двух элементов — myRoomsResponseSchema
// reject: extra key; status 'PAUSED'; appId 'QUIZ!'; createdAt '12.11.2026';
//   roomId без version-nibble ('00000000-0000-0000-0000-000000000001'); 'not-an-object'
// deleteRoomResponseSchema: parse(undefined) OK; parse({}) FAIL
```

- [ ] **Step 2:** Run: `pnpm --filter @mymozhem/sdk test -- my-rooms` — Expected: FAIL (модуля нет).
- [ ] **Step 3:** Реализовать `my-rooms.ts` (строго: strictObject; поля и значения как в тесте; `appSettings: z.record(z.string(), z.unknown()).nullable()`), export в index.ts, бамп версии.
- [ ] **Step 4:** Run: `pnpm --filter @mymozhem/sdk test` — Expected: PASS весь пакет.
- [ ] **Step 5:** Commit: `feat(sdk): схемы my-rooms и delete-void для среза Н16` (+ Co-Authored-By).

### Task 2: Core — RoomService.listOwnRooms + softDeleteOwnDraft

**Files:**
- Modify: `packages/core/src/room/room.errors.ts` (код ROOM_NOT_FOUND + класс)
- Modify: `packages/core/src/room/room.service.ts` (два метода)
- Test: `packages/core/src/room/room.service.int-spec.ts` (int, testcontainers)
- Test: `packages/core/src/membership/` int-spec с join-кейсами (REQ-SEC-003 пин — рядом с существующими)

**Interfaces:**
- Consumes: `DELETABLE_STATUSES`/assertDeletable НЕ переиспользовать — метод осознанно сужает до DRAFT (дизайн §3.1).
- Produces: `listOwnRooms(organizerId: string): Promise<Room[]>` (findMany: `organizerId`, `deletedAt: null`, `status in (DRAFT, ACTIVE, COMPLETED)`, `orderBy updatedAt desc`); `softDeleteOwnDraft(roomId: string, organizerId: string): Promise<void>`; `RoomNotFoundError` (code `ROOM_NOT_FOUND`).

- [ ] **Step 1: Failing int-tests**

```ts
// listOwnRooms: seed — DRAFT + ACTIVE + COMPLETED + CANCELLED + deletedAt-DRAFT +
//   чужая DRAFT (другой REGISTERED через prisma напрямую) → возвращаются ровно
//   DRAFT/ACTIVE/COMPLETED свои, порядок updatedAt desc.
// softDeleteOwnDraft: happy → deletedAt проставлен; ACTIVE → RoomTransitionError
//   (ROOM_TRANSITION_INVALID); unknown / чужая / уже удалённая → RoomNotFoundError
//   (ROOM_NOT_FOUND) — три кейса с ОДИНАКОВЫМ кодом (uniform, дизайн §3.1).
// REQ-SEC-003: гость join в DRAFT → softDeleteOwnDraft организатором →
//   membership.assertMember(roomId, guestId) отклоняет ActorNotMemberError.
```

- [ ] **Step 2:** Run: `pnpm --filter @mymozhem/core test:int -- room.service` — Expected: FAIL (методов нет).
- [ ] **Step 3:** Реализовать. `softDeleteOwnDraft`: guarded `updateMany({ where: { id, organizerId, status: 'DRAFT', deletedAt: null }, data: { deletedAt: new Date() } })`; при `count === 0` — re-read: комната существует, моя, не удалена → `RoomTransitionError`; иначе → `RoomNotFoundError` (не различаем unknown/foreign/deleted).
- [ ] **Step 4:** Run: `pnpm --filter @mymozhem/core test:int` — Expected: PASS.
- [ ] **Step 5:** Commit: `feat(core): listOwnRooms и softDeleteOwnDraft (Н16)` (+ Co-Authored-By).

### Task 3: Transport — GET /rooms/mine + DELETE /rooms/:roomId

**Files:**
- Create: `packages/core/src/transport/my-rooms.controller.ts`
- Modify: `packages/core/src/transport/transport.module.ts` (регистрация)
- Modify: `packages/core/src/transport/http-exception.filter.ts` (`ROOM_NOT_FOUND: 404`)
- Test: `apps/server/test/my-rooms.e2e-spec.ts` (boot-прецедент: `transport.e2e-spec.ts`)

**Interfaces:**
- Consumes: T2 методы; `authenticate(req, this.tokens)`; SDK `myRoomsResponseSchema` (T1).
- Produces: HTTP `GET /rooms/mine` → 200 `MyRoomsResponse`; `DELETE /rooms/:roomId` → 204 (тела нет). Ошибки: без токена 401; GUEST → 403 (`RoomOrganizerNotRegisteredError`, тот же приём, что `RoomsController.create`); не-DRAFT → 409 `ROOM_TRANSITION_INVALID`; чужая/unknown/deleted → 404 `ROOM_NOT_FOUND`.

- [ ] **Step 1: Failing e2e** — кейсы: mine без токена 401; mine гостем 403; happy (2 созданные комнаты видны, ответ проходит `myRoomsResponseSchema.parse` на клиенте теста); delete DRAFT → 204 и комната исчезает из mine; повторный delete → 404 ROOM_NOT_FOUND; delete ACTIVE → 409 ROOM_TRANSITION_INVALID.
- [ ] **Step 2:** Run: `pnpm --filter @mymozhem/server test -- my-rooms` — Expected: FAIL (404 на всё).
- [ ] **Step 3:** Контроллер: `@Controller('rooms')`, `@Get('mine')` и `@Delete(':roomId')` + `@HttpCode(204)`; `z.uuid().parse(roomId)`; маппинг Prisma-строки в wire (status — прямое значение; даты — `.toISOString()`; appId/manifestVersion/appSettings — как есть); ответная `myRoomsResponseSchema.parse` на границе. Фильтр += ROOM_NOT_FOUND: 404. Регистрация в модуле.
- [ ] **Step 4:** Run: `pnpm --filter @mymozhem/server test -- my-rooms` — Expected: PASS.
- [ ] **Step 5:** Commit: `feat(core): HTTP-контур my-rooms (GET mine, DELETE room) (Н16)` (+ Co-Authored-By).

## Батч B — web-инфраструктура

### Task 4: ApiClient DELETE/204 + endpoints + маршрут

**Files:**
- Modify: `apps/web/src/api/api-client.ts` (`method: 'GET' | 'POST' | 'DELETE'`; ветка 204)
- Modify: `apps/web/src/api/endpoints.ts` (listMyRooms, deleteRoom)
- Modify: `apps/web/src/routes.ts` (HOST_ROOMS_PATH)
- Test: `apps/web/src/api/api-client.spec.ts`

**Interfaces:**
- Consumes: `myRoomsResponseSchema`, `deleteRoomResponseSchema`, типы (T1).
- Produces: `listMyRooms(c: ApiClient): Promise<MyRoomsResponse>`; `deleteRoom(c: ApiClient, roomId: string): Promise<void>`; `HOST_ROOMS_PATH = '/host/rooms'`.

- [ ] **Step 1: Failing tests** api-client.spec: DELETE + 204 → `schema.parse(undefined)` (res.json() на пустом теле НЕ вызывается для 204); DELETE + 404 с `{ code: 'ROOM_NOT_FOUND' }` → ApiError с этим кодом; существующие GET/POST кейсы не тронуты.
- [ ] **Step 2:** Run: `pnpm --filter @mymozhem/web exec vitest run src/api/api-client.spec.ts` — Expected: FAIL по новым кейсам.
- [ ] **Step 3:** Реализовать: расширить union method; после `res.ok`-проверки `if (res.status === 204) return req.schema.parse(undefined)`. Endpoints и маршрут — по сигнатурам выше (routes.ts — константа сразу оправдана: потребителей несколько с первого коммита).
- [ ] **Step 4:** Run тот же + `pnpm --filter @mymozhem/web exec vitest run src/api` — Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): DELETE/204 в ApiClient, эндпоинты my-rooms, маршрут перечня (Н16)` (+ Co-Authored-By).

### Task 5: Гейт /host — серверная маршрутизация

**Files:**
- Modify: `apps/web/src/pages/host/host-gate-flow.ts` (полная замена тела resolve)
- Modify: `apps/web/src/pages/host/host-gate.tsx` (передать listRooms)
- Test: `apps/web/src/pages/host/host-gate-flow.spec.ts` (переписать кейсы)

**Interfaces:**
- Consumes: `listMyRooms` (T4), `HOST_ROOMS_PATH` (T4), `MyRoomsResponse` (T1).
- Produces: `resolveHostGateTarget(session: GateSession, listRooms: () => Promise<MyRoomsResponse>): Promise<HostGateTarget>`; `HostGateTarget = typeof HOST_CONSOLE_PATH | typeof HOST_ROOMS_PATH | '/'` (HOST_NEW_PATH из union УБРАТЬ — гейт на setup больше не ведёт).

- [ ] **Step 1: Failing tests** — таблица: ACTIVE в списке → console; только DRAFT → rooms; пустой список → rooms; COMPLETED-only → rooms; listRooms бросает (сеть/5xx) → rooms (fail-open, дизайн §3.2); нет токена после refresh → '/'; гостевой токен → '/'. SessionStore в тестах не фигурирует.
- [ ] **Step 2:** Run: `pnpm --filter @mymozhem/web exec vitest run src/pages/host/host-gate-flow.spec.ts` — Expected: FAIL (старая сигнатура).
- [ ] **Step 3:** Реализовать: токен-логика (refresh при пустой памяти, REGISTERED-чек) без изменений; localStorage-ветку заменить на `try { const rooms = await listRooms(); return rooms.some(r => r.status === 'ACTIVE') ? HOST_CONSOLE_PATH : HOST_ROOMS_PATH; } catch { return HOST_ROOMS_PATH; }`. Комментарий «одна комната на организатора (MVP)» удалить (дизайн §4.7). host-gate.tsx: `resolveHostGateTarget(hostSession, () => listMyRooms(hostClient))`.
- [ ] **Step 4:** Run spec — Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): гейт /host на серверной привязке (Н16)` (+ Co-Authored-By).

### Task 6: Страница «Мои события»

**Files:**
- Create: `apps/web/src/pages/host/my-rooms.ts` (чистая логика)
- Create: `apps/web/src/pages/host/rooms-list-page.tsx`
- Modify: `apps/web/src/App.tsx` (Route)
- Test: `apps/web/src/pages/host/my-rooms.spec.ts`

**Interfaces:**
- Consumes: `listMyRooms`, `deleteRoom`, `HOST_ROOMS_PATH` (T4); `createFocusRefetcher` (`state/focus-refetch.ts`); `pluralRu` (`state/plural-ru.ts`); `quizSettingsSchema` (`@mymozhem/app-quiz`).
- Produces (чистые, под тестами): `roomRowTitle(r: MyRoomItem): string`; `myRoomsErrorText(e: unknown): string`; `deleteErrorText(e: unknown): string`.

- [ ] **Step 1: Failing tests** my-rooms.spec:

```ts
// roomRowTitle: appId null → 'Без наполнения'; quiz + 5 вопросов → 'Квиз · 5 вопросов';
//   quiz + 1 вопрос → 'Квиз · 1 вопрос' (pluralRu); lottery → 'Лотерея';
//   appId 'quiz', но appSettings не парсится схемой → 'Квиз' (без счётчика, fail-safe).
// myRoomsErrorText: не-ApiError → 'Ошибка сети…'; ApiError → честный код.
// deleteErrorText: ROOM_TRANSITION_INVALID → 'Удалить можно только черновик.';
//   ROOM_NOT_FOUND → 'Комната уже удалена.'; прочее → код/сеть (стиль submitErrorText).
```

- [ ] **Step 2:** Run: `pnpm --filter @mymozhem/web exec vitest run src/pages/host/my-rooms.spec.ts` — Expected: FAIL.
- [ ] **Step 3:** Реализовать чистые функции; страницу по мокапу (дизайн §3.3, `.superpowers/brainstorm/72876-1794434548/content/rooms-list-and-editor.html`): fetch при mount + после delete + focus-рефетч; состояния loading / error+«Повторить» / empty («Живых событий нет.» — только когда нет ни одной строки, COMPLETED считаются строками) / rows; DRAFT: «Продолжить» → navigate `/host/new?room=<id>`, «Удалить» → inline-confirm → `deleteRoom` → refetch; COMPLETED: «В консоль» → `/host/console?room=<id>`; ACTIVE: «В консоль» → HOST_CONSOLE_PATH; «Новое событие» → `/host/new`. Строки — в порядке сервера (updatedAt desc, не пересортировывать). Консольная палитра, классы по мокапу (console.css пополняется секцией перечня).
- [ ] **Step 4:** Run: `pnpm --filter @mymozhem/web exec vitest run src/pages/host` + typecheck — Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): страница перечня «Мои события» (Н16)` (+ Co-Authored-By).

## Батч C — страницы host-контура

### Task 7: QuizEditor — prefill и кнопка черновика

**Files:**
- Modify: `apps/web/src/pages/host/quiz-editor.tsx` (props + reverse-маппинг)
- Test: `apps/web/src/pages/host/quiz-editor.spec.ts`

**Interfaces:**
- Consumes: `QuizSettings` (`@mymozhem/app-quiz`).
- Produces: `quizSettingsToForm(s: QuizSettings): QuizFormState` (обратная к `buildQuizSettings`; `durationSec: null` → `{ unlimited: true, durationSec: '30' }`); `QuizEditorProps` становятся `{ onSubmit, onSaveDraft, busy, initial? }` — `onSaveDraft: (settings: QuizSettings) => void`, `initial?: QuizFormState`.

- [ ] **Step 1: Failing tests** quiz-editor.spec: round-trip `buildQuizSettings(quizSettingsToForm(s))` deep-eq `s` на 3 фикстурах (обычный вопрос; `durationSec: null`; 6 вариантов ответа); toForm ставит correctIndex из correctAnswers.
- [ ] **Step 2:** Run: `pnpm --filter @mymozhem/web exec vitest run src/pages/host/quiz-editor.spec.ts` — Expected: FAIL.
- [ ] **Step 3:** Реализовать `quizSettingsToForm` (чистая, экспортируемая); `QuizEditor` принимает `initial` (инициализация useState от него, дефолт — прежний пустой) и рендерит вторую кнопку «Сохранить черновик» (secondary, левее primary; обе парсят форму `quizSettingsSchema` перед вызовом — невалидная форма не уходит наружу, Review Focus 4; busy гасит обе).
- [ ] **Step 4:** Run spec — Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): prefill редактора квиза и сохранение черновика (Н16)` (+ Co-Authored-By).

### Task 8: Setup-страница — явное создание, resume, два исхода

**Files:**
- Modify: `apps/web/src/pages/host/setup-page.tsx` (переработка)
- Create: `apps/web/src/pages/host/setup-flow.ts` (чистая логика режима)
- Test: `apps/web/src/pages/host/setup-flow.spec.ts`

**Interfaces:**
- Consumes: `createRoom`, `configureRoom`, `activateRoom`, `listMyRooms` (T4); `quizSettingsToForm`/новые пропы QuizEditor (T7); `HOST_ROOMS_PATH` (T4); `lotterySettingsSchema` (`@mymozhem/app-lottery`).
- Produces: `resolveSetupMode(roomParam: string | null, rooms: MyRoomsResponse): { kind: 'fresh' } | { kind: 'resume'; room: MyRoomItem } | { kind: 'missing' }` (resume — только DRAFT из списка; ACTIVE/COMPLETED/отсутствующая → 'missing').

- [ ] **Step 1: Failing tests** setup-flow.spec: таблица resolveSetupMode (null → fresh; DRAFT в списке → resume с ней; ACTIVE/COMPLETED/unknown id → missing); комментарием зафиксировать: resume разрешён только для DRAFT (дизайн №7 — «продолжить» ведёт в редактор черновика).
- [ ] **Step 2:** Run: `pnpm --filter @mymozhem/web exec vitest run src/pages/host/setup-flow.spec.ts` — Expected: FAIL.
- [ ] **Step 3:** Переработать setup-page: **удалить auto-create effect целиком** (setup-page.tsx:62-76, включая createStarted-ref и SessionStore-вызовы). Режим fresh без roomId: выбор приложения + кнопка «Создать событие» (primary); клик → busy → `createRoom` → редактор (двойной клик невозможен — disabled, Review Focus 1). Режим resume: `listMyRooms` → resolveSetupMode; missing → «Комната не найдена» + ссылка на перечень; resume → roomId + appKind из `appId` + `initial={quizSettingsToForm(...)}` при quiz; поле выбора приложения disabled, когда `appId` уже задан (дизайн §3.4). Подвал редактора: «Сохранить черновик» → `configureRoom` → строка «Черновик сохранён в HH:MM»; «Сохранить и запустить» → configure → activate → console (как сегодня); тихая ссылка «К моим событиям» → HOST_ROOMS_PATH (§4.10). Lottery: черновик — `lotterySettingsSchema.parse({})`. Ошибки — на существующей поверхности `submitErrorText` (дополнить ROOM_TRANSITION_INVALID текстом про удалённую/недоступную комнату).
- [ ] **Step 4:** Run: `pnpm --filter @mymozhem/web exec vitest run src/pages/host` + typecheck — Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): setup — явное создание, resume черновика, два исхода (Н16)` (+ Co-Authored-By).

### Task 9: Консоль — серверная привязка, снос localStorage-ключей

**Files:**
- Modify: `apps/web/src/pages/host/console-page.tsx`
- Modify: `apps/web/src/state/session.ts` (удалить 5 host-room методов)
- Test: `apps/web/src/pages/host/console-page.spec.ts`, `apps/web/src/state/session.spec.ts`
- Create: `apps/web/src/pages/host/console-room-resolve.ts` + spec (чистая логика выбора комнаты)

**Interfaces:**
- Consumes: `listMyRooms` (T4), `HOST_ROOMS_PATH` (T4).
- Produces: `resolveConsoleRoom(roomParam: string | null, rooms: MyRoomsResponse): { kind: 'room'; room: MyRoomItem } | { kind: 'none' }` — param задан → искать в списке (есть → room, нет → none); без param → первая ACTIVE из серверного порядка (Review Focus 3); нет ACTIVE → none. После задачи `SessionStore.{loadHostRoomId, saveHostRoomId, loadHostRoomCode, saveHostRoomCode, clearHostRoom}` не существуют.

- [ ] **Step 1: Failing tests** console-room-resolve.spec: param попадает в DRAFT/COMPLETED/ACTIVE → room; param вне списка → none; без param — первая ACTIVE (не DRAFT перед ней); без param и без ACTIVE → none. session.spec: кейсы host-ключей удалены.
- [ ] **Step 2:** Run: `pnpm --filter @mymozhem/web exec vitest run src/pages/host/console-room-resolve.spec.ts src/state/session.spec.ts` — Expected: FAIL.
- [ ] **Step 3:** console-page: mount → `listMyRooms` → resolveConsoleRoom(searchParam 'room'); `none` → navigate(HOST_ROOMS_PATH, replace); roomId/roomCode — из выбранной комнаты (state после fetch, `useRoomBinding` терпит null — подтверждено builder-check). Удалить: `isStaleRoomJoinError`, effect с `clearHostRoom`, `roomGone`-ветку «Комната не найдена»; вместо неё: `binding.joinError` → navigate на перечень (однократно). COMPLETED-экран: «Вернуться к началу» → navigate(HOST_ROOMS_PATH). session.ts: удалить 5 методов; grep `HostRoom` по src — ноль попаданий вне spec.
- [ ] **Step 4:** Run: `pnpm --filter @mymozhem/web test` + lint + typecheck — Expected: PASS, весь сьют зелёный.
- [ ] **Step 5:** Commit: `refactor(web): консоль на серверной привязке, снос mm.host.* (Н16)` (+ Co-Authored-By).

## Батч D — приёмочный контур

### Task 10: Playwright smoke под новый флоу

**Files:**
- Modify: `apps/web/e2e/smoke.spec.ts`
- Modify (при необходимости): helpers e2e (`apps/web/e2e/`)

**Interfaces:**
- Consumes: весь срез; существующие playwright-идиомы (getByRole, hasText — Н1/Н13 опыт).

- [ ] **Step 1:** Обновить флоу setup: `/host` → (логин) → перечень (empty-state) → «Новое событие» → «Создать событие» → редактор → заполнение → «Сохранить и запустить» → консоль. Все существующие ассерты консоли/сцен сохранить.
- [ ] **Step 2:** Новый проход: заполнить 2 вопроса → «Сохранить черновик» → «К моим событиям» → строка «Квиз · 2 вопроса» → «Продолжить» → форма с вопросами на месте → «Сохранить и запустить».
- [ ] **Step 3:** Новый проход: «Новое событие» → «Создать событие» → «К моим событиям» → у строки «Без наполнения» «Удалить» → confirm → строка исчезла; в перечне нет лишних комнат (ровно ожидаемые строки — пин Review Focus 1 на живом DOM).
- [ ] **Step 4:** Run: `pnpm --filter @mymozhem/web test:e2e` — Expected: PASS (локальный стек по README playwright-конфига).
- [ ] **Step 5:** Commit: `test(web): smoke под серверную привязку и черновики (Н16)` (+ Co-Authored-By).

### Task 11: Чеклист живой приёмки + финальные гейты

**Files:**
- Create: `docs/sessions/2026-11-12-n16-acceptance-checklist.md`

**Interfaces:**
- Consumes: критерии §7 дизайна.

- [ ] **Step 1:** Чеклист из критериев §7 дизайна, строки протокола по образцу `2026-10-19-design-ui-acceptance-checklist.md` (блоки: 0 — стенд; 1 — рождение по клику, ноль auto-mount строк в БД; 2 — перечень и маршрутизация; 3 — черновик resume с другого браузера/origin; 4 — удаление + psql deletedAt; 5 — COMPLETED-консоль после перезагрузки, вручение награды; 6 — гость удалённой DRAFT; 7 — консоль без mm.host.* на новом origin). Включить зачистку 7 существующих стендовых сирот через перечень как строку приёмки.
- [ ] **Step 2:** Полные гейты среза: `pnpm -r test` + `pnpm --filter @mymozhem/core test:int` + `pnpm --filter @mymozhem/server test` + `pnpm -r lint` + `pnpm -r typecheck` + boundary-check (команда из CI-конфига) — Expected: всё зелёное.
- [ ] **Step 3:** Commit: `docs(sessions): чеклист живой приёмки Н16` (+ Co-Authored-By).

---

## Self-review (зафиксирован для ревью владельцем)

- **Покрытие спеки:** §3.1→T1–T3; §3.2→T5; §3.3→T6; §3.4→T7–T8; §3.5→T9; §3.6→T2 (REQ-SEC-003 пин) + T3; §3.7→T1/T2/T3 контракт+int+e2e, T4–T9 vitest, T10 smoke, T11 чеклист+гейты. Критерии §7 → строки чеклиста T11. Пробелов нет.
- **Типы/имена согласованы:** myRoomItemSchema/myRoomsResponseSchema/MyRoomItem (T1) → endpoints (T4) → gate/list/setup/console (T5–T9); resolveSetupMode (T8) и resolveConsoleRoom (T9) — разные функции, имена не пересекаются; quizSettingsToForm (T7) → T8.
- **Зависимости между задачами последовательные внутри батчей** (T4 → T5/T6; T7 → T8): параллельные имплементеры внутри батча B возможны для T5+T6 после T4 (опыт батча D дизайн/UI-среза), батч C — строго последователен (общие файлы host-контура).
- **Пропорция:** тела функций не транскрибированы; код только там, где фиксирует контракт/таблицу решений.
