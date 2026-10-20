# Task 3 report — app-quiz manifest v3: `durationSec` + серверный `openedAt`

**Status:** DONE
**Commit:** `cd88eddc9b2af4b560bfdca552b3c2c836cebdeb` (branch `design-ui-batch-a`)
**Message (verbatim from brief + Co-Authored-By):** `feat(app-quiz): манифест v3 — durationSec вопроса (5–600|null, дефолт 30) + серверный openedAt в question.opened`

## REQ-* coverage

- REQ-RT-009 — серверное время/актор не из payload: `openedAt` на коммите всегда `ctx.now`, клиентское значение перезаписывается (тест `overwrites a client-supplied openedAt with ctx.now`).
- REQ-CTR-005 — контрактные тесты манифеста из zod-схем, проверка зарегистрированных JSON Schema через Ajv (input-режим регистрации C-9.1: defaulted ключ `durationSec` необязателен на гейте).
- REQ-CORE-007 — гейт по зарегистрированному артефакту: все durationSec/openedAt кейсы прогнаны через `ajv.compile(manifest.appSettings / events['question.opened'].schema)`.

## Steps

### Step 1 — failing tests: quiz-manifest.contract.spec.ts

- Пин версии: `pins manifestVersion 3 with the rewards capability` (было 2).
- appSettings (Ajv над зарегистрированной JSON Schema), новый блок `durationSecValid`:
  - `durationSec` опущен — валидно (input-режим, кейс = базовый validSettings);
  - `600` (верхняя граница) — валидно; `5` (нижняя граница) — валидно; `null` («без лимита») — валидно.
- В `invalidSettings` добавлены: `3` (ниже минимума) — невалидно; `601` (выше максимума) — невалидно; `30.5` (не int) — невалидно.
- `question.opened` payload-кейсы: `{questionIndex}` валидно (было); `{questionIndex, openedAt: ISO}` валидно (новое); не-ISO `openedAt` — невалидно (новое); extra key невалидно (было, strict сохранён).

### Step 2 — failing tests: handlers + state

- `quiz-handlers.spec.ts`: happy-path exact-match (:104-110) обновлён — коммит несёт `payload: { questionIndex, openedAt: T0 }` (T0 = ctx.now фикстуры); новый тест — клиентский `openedAt: '1999-01-01...'` в publish перезаписывается `ctx.now`; runtime-dispatch exact-match (:405-420) обновлён аналогично.
- `quiz-state.spec.ts`: новый тест — `openedAt` берётся из payload при наличии (payload `12:00:01` vs recordedAt `12:00:02` → `12:00:01`); fallback на `event.recordedAt` при отсутствии — уже запинан существующим тестом (:35-42), оставлен.

### Step 3 — RED evidence

`pnpm --filter @mymozhem/app-quiz test` → **9 failed / 88 passed**, все падения — новые/изменённые ожидания:

- `quiz manifest › pins manifestVersion 3 with the rewards capability`
- `registered appSettings JSON Schema › accepts durationSec at the lower bound (5) / at the upper bound (600) / null (no time limit)`
- `registered event JSON Schemas › question.opened accepts an ISO openedAt (server-stamped on commit)`
- `handleQuizPublish / question.opened › commits … stamped with openedAt = ctx.now`
- `handleQuizPublish / question.opened › overwrites a client-supplied openedAt with ctx.now (REQ-RT-009)`
- `createQuizRuntime / createQuizApp › dispatches handlePublish through the runtime module`
- `reduceQuiz › question.opened prefers payload.openedAt … over event.recordedAt`

(Кейсы `3`/`601`/`30.5` «проходили» и в RED — strict-схема v2 отвергала неизвестный ключ; это ожидаемо, позитивные кейсы выше дают настоящий RED.)

### Step 4 — реализация

- `quiz-settings.ts:7` — элемент вопроса += `durationSec: z.number().int().min(5).max(600).nullable().default(30)`; visibility public наследуется от `questions`.
- `quiz-events.ts:4` — `questionOpenedPayload = strictObject({ questionIndex: int≥0, openedAt: z.iso.datetime().optional() })` (strict сохранён).
- `quiz-manifest.ts:14` — `QUIZ_MANIFEST_VERSION = 3` (+ комментарий про redeploy-эффект quiz@2 → APP_MANIFEST_UNKNOWN, прецедент lottery@1).
- `quiz-handlers.ts` `openQuestion` — коммит `{ questionIndex: p.questionIndex, openedAt: ctx.now }` (всегда перезапись, REQ-RT-009).
- `quiz-state.ts` — `openedAt: p.openedAt ?? event.recordedAt`; комментарий поля обновлён.
- `quiz-handlers.spec.ts` SETTINGS-фикстура (тип `QuizSettings` = output) += `durationSec: 30` в обоих вопросах — иначе TS2741 после расширения output-типа (ts-jest type-checks).

### Step 5 — GREEN evidence

- `pnpm --filter @mymozhem/app-quiz test` → **97 passed / 97** (3 suites).
- `pnpm --filter @mymozhem/app-quiz build` → OK; `typecheck` OK; `lint` OK.

### Step 6 — ripples

Grep (`QUIZ_MANIFEST_VERSION`, `manifestVersion: 2`, `'quiz'`-фикстуры) по apps/server/test, apps/web/src, packages/core, packages/sdk. Найдено и обработано:

| Сайт | Что сделано |
|---|---|
| `apps/web/src/state/fixtures/quiz-log.fixture.ts:16` | `manifestVersion: 2 → 3` |
| `quiz-log.fixture.ts:20-24, :54-58` | оба `quiz.question.opened` += `openedAt` (`12:00:01Z` q0, `12:05:00Z` q1) |
| `apps/web/src/state/projections.spec.ts:37-38` | golden-ассерт `state.openedAt`: теперь из payload фикстуры (`12:05:00Z`), не клиентский RECORDED_AT — комментарий и ожидание обновлены |
| `apps/web/src/pages/host/quiz-editor.spec.ts:27-35, :44-47` | exact-match на `quizSettingsSchema.parse(...)`: parsed output теперь несёт дефолт `durationSec: 30` — ожидания обновлены (форма durationSec не редактирует до T10, комментарий зафиксирован). Найдено прогоном `pnpm --filter @mymozhem/web test` (2 RED), в brief не названо |
| `apps/server/test/quiz.e2e-spec.ts:30-38` | QUIZ_SETTINGS (тип `QuizSettings`) += `durationSec: 30` — ts-jest type-check |
| `apps/server/test/quiz.e2e-spec.ts:398` | exact-match payload snapshot'а `question.opened` → `{ questionIndex: 0, openedAt: expect.any(String) }`. Найдено чтением :288-300/:390-400, в brief явно не названо |
| `apps/server/test/quiz-points.e2e-spec.ts:31-39` | QUIZ_SETTINGS += `durationSec: 30`; убран устаревший комментарий «quiz.e2e не правим … manifestVersion 2» (оба спека едут на константе) |
| `packages/core/src/transport/rooms-lifecycle.controller.int-spec.ts:34` | НЕ тронут: `manifestVersion: 2` там — lottery-манифест, quiz@1 — SDK-фикстура `validManifests[0]`, к app-quiz отношения нет |
| `packages/sdk/src/room/configure-room-request.contract.spec.ts:5-8` | НЕ тронут: проверяет форму wire-запроса configure, версия произвольна, к манифесту quiz не привязан |
| `packages/sdk/src/manifest/define-app.contract.spec.ts` | НЕ тронут: локальная zod-фикстура `quizSettings`, не импорт app-quiz |
| `packages/core/src/{app-registry,room,rewards,realtime}/**` | НЕ тронуты: работают на SDK-фикстурах/TEST_APP, boundary запрещает ядру импорт app-пакетов |
| `apps/web/src/pages/host/{setup-page,quiz-controls}.tsx`, `api-client.spec.ts`, `log-store.spec.ts`, `roster-refetch.spec.ts` | НЕ тронуты: версию берут из константы / payload `question.opened` точно не матчат |

### Gates (все зелёные)

- `pnpm --filter @mymozhem/app-quiz test` — 97/97
- `pnpm --filter @mymozhem/web test` — **117/117** (19 files)
- `pnpm build` — 6/6 turbo tasks
- `pnpm --filter @mymozhem/server test` — **71/71** (10 suites, incl. quiz.e2e 14.5s, quiz-points.e2e)
- `pnpm test:int` — **223/223** (23 suites, core integration, testcontainers)
- `pnpm typecheck` — 10/10; `pnpm lint` — 6/6

### Step 7 — commit

`cd88edd` — 13 files changed, 127 insertions(+), 29 deletions(-).

## Self-review

- TDD соблюдён: RED (9 падений ровно по новым ожиданиям) → реализация → GREEN.
- zod v4 идиомы: `z.iso.datetime()`, `z.number().int()` — подтверждены рантайм-прогоном (zod@4.4.3).
- Input-режим регистрации (C-9.1): defaulted `durationSec` не попадает в `required` зарегистрированной JSON Schema (прецедент `mode: z.string().default('relaxed')` в define-app.contract.spec) — кейс «опущен → валидно» зелёный через Ajv.
- `openedAt` в коммите всегда `ctx.now` — без веток «если клиент прислал».
- Reducer: `payload.openedAt ?? event.recordedAt` — обратная читаемость логов до v3 сохранена; анти-бот REQ-RT-013 (`submitAnswer` читает `state.openedAt`) не изменён семантически (оба источника — серверное время).
- Эффект редеплоя (реестр знает только v3, quiz@2 → APP_MANIFEST_UNKNOWN) зафиксирован комментарием в `quiz-manifest.ts`; совместимость не делалась по дизайну §13.
- Новых зависимостей нет; boundary-правил не нарушено (ядро не импортирует app-quiz).

## Concerns

1. **Хранимые settings без дефолта.** Комната, сконфигурированная settings без `durationSec`, хранит JSON как передан; публичная проекция appSettings тогда тоже без ключа. Клиентский таймер (T5/T9) обязан читать `durationSec` через parse схемы (или `?? 30`), а не напрямую из сырого JSON — web уже парсит settings схемой в editor, но потребителей проекции это касается в следующих задачах батча.
2. **quiz-editor пока не редактирует durationSec** (T10) — все новые комнаты получат дефолт 30; это соответствует плану батча.
3. В RED-фазе негативные durationSec-кейсы (`3`/`601`/`30.5`) формально проходили до реализации (strict v2 отвергал ключ) — настоящий RED давали позитивные кейсы и пин версии; зафиксировано для честности evidence.
