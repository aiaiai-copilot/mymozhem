# Task 11 — ревью: handlers команд и фабрика рантайм-модуля

**Пакет:** `review-27c63f3..9750944.diff` (1 коммит: `9750944`, conventional, по-русски, трейлер `Co-Authored-By` присутствует — проверено по `git log`).
**Ревьюер:** двухстадийное ревью (spec-compliance против брифа + качество кода). Тест-сьют не перезапускался — свидетельства из отчёта исполнителя (83/83 зелёные, boundary-check чистый).

---

## 1. Spec compliance: ❌ — один конкретный промах (dense-rank)

### Промах

**Dense-rank standings реализован как competition ranking.** Бриф фиксирует дословно: «place = 1-based с разделением мест при равенстве (**плотный ранг: 1,2,2,3**)». «Плотный ранг» = dense rank: после ничьей следующее отличное значение получает предыдущее место + 1. Реализация (`quiz-handlers.ts:540-546`) при смене total присваивает `place = index + 1` — это competition ranking: для totals `{100, 50, 50, 30}` получится `1,2,2,4`, а не зафиксированные брифом `1,2,2,3`. Различающий случай (третий distinct total после ничьей) тестом не покрыт — имеющийся тест (`100/50/50 → 1,2,2`) проходит при обоих ранжированиях, поэтому промах прозеленевал. Правильная реализация: при смене total `place = previousPlace + 1` (или счётчик distinct-групп), плюс тест на `1,2,2,3`.

### Проверено и соответствует брифу

- **Все ветки отказов присутствуют, коды точные, порядок как в брифе:**
  - `question.opened`: ORGANIZER-гейт → `finished` → `accepting` → `questionIndex >= length` (PUBLISH_FORBIDDEN / ROUND_NOT_OPEN ×2 / QUESTION_UNKNOWN) — роль до состояния, как зафиксировано.
  - `answer.submitted`: PARTICIPANT-гейт → ROUND_NOT_OPEN → QUESTION_UNKNOWN → OPTION_UNKNOWN → ALREADY_ANSWERED → ANSWER_TOO_FAST — все шесть веток, порядок брифа соблюдён.
  - `question.closed`: ORGANIZER-гейт → `!accepting || questionIndex !== currentQuestion` → ROUND_NOT_OPEN (один код на оба условия, как в брифе).
  - `game.finish`: ORGANIZER-гейт → `finished` → ROUND_NOT_OPEN.
- **Анти-бот REQ-RT-013:** строгое `<`, условие `minAnswerIntervalMs > 0 && openedAt !== null && now − openedAt < interval`; тесты фиксируют `interval−1` → отказ, ровно `interval` → принят, `0` → контроль выключен, `openedAt: null` → принят. Границы верные.
- **Скоринг:** правильные (`optionIndex === correctAnswers[qi]`, отсутствующий индекс → правильных нет) по возрастанию `seq`, k-й (0-based) → `max(base − k·step, 0)`; неправильные не получают ничего; `totals` = state.totals + awarded. Соответствует.
- **Состав commits по каждой команде** (shortName / payload / visibility / actor) — точно по брифу, включая `answer.accepted {questionIndex, actorId}` public/server и `question.revealed` с опусканием `correctIndex` при несконфигурированном ответе (тест явно проверяет `not.toHaveProperty('correctIndex')`).
- **Visibility ceiling (REQ-CTR-009):** сверено с `quiz-manifest.ts` — каждый коммитимый тип совпадает с манифестной видимостью: `question.opened/closed`, `game.finish`, `answer.accepted`, `question.revealed`, `game.finished` — public; `answer.submitted` — module-private. Превышений нет.
- **REQ-RT-009:** `actorId` в исходящих payload'ах только из `ctx.actorId`; роль только из `ctx.actorRole` (REQ-ID-011).
- **Runtime-фабрика:** `appId`/`manifestVersion` из констант пакета, `manifest: buildQuizManifest()`, `reduce: reduceQuiz`, `initialState: initialQuizState`, `handlePublish: handleQuizPublish` — wiring подтверждён тестом, включая dispatch через `runtime.handlePublish` и reduce по событию. Сигнатуры `createQuizRuntime()` / `createQuizApp()` совпадают с интерфейсом брифа.
- **Boundary:** импорты только `@mymozhem/sdk`, `zod`, локальные файлы — `packages/core` не импортируется.
- **Имена событий:** dotted-lowercase по ruling батча 3; TS-идентификаторы camelCase.
- **Коммит:** conventional, по-русски, `Co-Authored-By: Claude Code <noreply@anthropic.com>`, push не выполнялся.

### Оценка задокументированных judgment calls

1. Детерминированный порядок totals/standings (total desc, tie → actorId) — бриф молчит, выбор разумен и задокументирован. Не противоречит.
2. `awarded` включает клампнутые в 0 — буквальное прочтение «k-й получает max(base − k·step, 0)». Не противоречит.
3. `EVENT_UNKNOWN_TYPE` на неизвестный shortName — защитная ветка, код из `CONTRACT_ERROR_CODES`, switch должен быть исчерпывающим. Не противоречит.
4. Страховка `question === undefined → OPTION_UNKNOWN` — дешевая защита от рассинхрона state/settings. Не противоречит.

---

## ⚠️ Cannot verify from diff

- Фактический прогон тестов/boundary-check (по инструкции ревью — принято из отчёта исполнителя: 83/83, 3 suites; boundary 508 modules чисто).
- Соответствие `AppHostContext`/`AppRuntimeModule`/`AppCommit` контракту Task 4 (SDK) — принято на веру через typecheck из отчёта; типы в diff используются согласованно.
- Поведение редьюсера `reduceQuiz` (Task 10) само по себе — здесь проверен только факт wiring; тест фабрики прогоняет одно событие `question.opened` через `runtime.reduce` и проверяет `accepting`/`currentQuestion`.

---

## Strengths

- Полное табличное покрытие веток отказов с точными кодами; счастливые пути проверяют commits целиком (`toEqual` с actor/visibility), а не выборочно.
- Анти-бот границы зафиксированы обеими сторонами (interval−1 отказ / ровно interval принят) плюс выключение контроля нулём — ровно то, что требует REQ-RT-013.
- Защитные ветки (EVENT_UNKNOWN_TYPE, undefined-question) локализованы, прокомментированы и не маскируют основную логику.
- Комментарии в коде привязаны к REQ/ADR (REQ-RT-009, REQ-ID-011, REQ-CTR-009, ADR-005, REQ-CORE-004) — ревью и будущие сессии читают намерение без отчёта.

---

## Issues

### Critical
Нет.

### Important

1. **Dense-rank реализован как competition ranking** — `packages/app-quiz/src/quiz-handlers.ts:540-546`. При смене total `place = index + 1`: для totals `{100, 50, 50, 30}` standings получат места `1,2,2,4`, тогда как бриф фиксирует плотный ранг `1,2,2,3`. Исправление: при смене total инкрементировать `place` на 1 относительно предыдущего distinct-значения (а не брать `index + 1`), и добавить тест на различающий случай `1,2,2,3` (текущий тест `100/50/50 → 1,2,2` индифферентен к разнице ранжирований).

### Minor

1. **Скоринг покрыт двумя правильными ответами вместо трёх** — `quiz-handlers.spec.ts:261-290`. Бриф предлагал таблицу «3 правильных по seq → 1000/900/800»; реализованный тест проверяет 1000/900, ветка k=2 (и, заодно, кламп в 0) тестом не зафиксирована. Формула та же, риск низкий — но раз бриф называл значения явно, стоит добить третью строку.
2. **`await` на синхронном возврате** — тесты делают `await handleQuizPublish(...)`, хотя функция возвращает `AppCommit[]` синхронно. Безвредно и даже устойчиво к будущей асинхронизации сигнатуры; отмечено для полноты.

---

## Task quality verdict: **Changes required**

Единственное обязательное изменение — Issue Important 1 (dense-rank против зафиксированного брифом `1,2,2,3` + различающий тест). Всё остальное по брифу и глобальным ограничениям чисто; minor-пункты — по желанию владельца.
