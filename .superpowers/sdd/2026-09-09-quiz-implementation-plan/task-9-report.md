# Task 9 — app-quiz: пакет и манифест — Report

**Status: BLOCKED** — конфликт брифа (verbatim-имена событий) с существующим SDK-контрактом `shortEventNameSchema`. Решение затрагивает интерфейс контракта — не принимаю его сам, эскалировать владельцу/контроллеру.

## Что сделано

Создан пакет `packages/app-quiz` полностью по брифу:

- `package.json` (зеркало sdk: `@mymozhem/app-quiz@0.0.0`, deps `@mymozhem/sdk: workspace:*`, `zod ^4.0.0`; `ajv ^8.20.0` в devDependencies — sdk его не реэкспортирует, ядро держит так же)
- `tsconfig.json`, `jest.config.js` — зеркала sdk
- `src/quiz-settings.ts` — `quizSettingsSchema` verbatim из брифа (correctAnswers без аннотации → fail-safe module-private)
- `src/quiz-events.ts` — 7 payload-схем verbatim из брифа
- `src/quiz-manifest.ts` — `QUIZ_APP_ID='quiz'`, `QUIZ_MANIFEST_VERSION=1`, `buildQuizManifest()` verbatim из брифа
- `src/index.ts` — реэкспорт трёх модулей
- `src/quiz-manifest.contract.spec.ts` — контрактный тест по Step 1 брифа (табличный assert 7 типов, Ajv2020-валидация appSettings и payload'ов, проверка видимости через `readPropertyVisibility`)
- `pnpm install` выполнен, `pnpm-lock.yaml` обновлён (один lockfile)

## Блокер

`shortEventNameSchema` (packages/sdk/src/events/event-type.ts:27-29) принимает только dotted-lowercase имена:

```typescript
const NAME_SEGMENT = '[a-z][a-z0-9_-]*';
```

Бриф (verbatim-сниппет `buildQuizManifest`) и весь дизайн/план квиза используют camelCase short-имена: `questionOpened`, `answerSubmitted`, `questionClosed`, `finishGame`, `answerAccepted`, `questionRevealed`, `gameFinished`. Все 7 имён содержат заглавные буквы и отклоняются схемой.

Факты:

1. `defineApp` падает на `appManifestSchema.safeParse` с `MANIFEST_INVALID` / `invalid_key` (Invalid key in record) — с первого же события манифеста. Тестовый прогон: `defineApp (../sdk/src/manifest/define-app.ts:136:11) at buildQuizManifest (src/quiz-manifest.ts:16:19)`.
2. `shortEventNameSchema` — единственный гейт имён, и он используется не только в ключах `appManifestSchema.events`, но и в `AppCommit.shortName` (app-runtime, контракт 1.5.0, задача 7). То есть решение затрагивает и манифест, и рантайм-путь коммита.
3. Схема не менялась ни одной задачей quiz-батча (`git diff main...HEAD -- packages/sdk/src/events/event-type.ts` пуст; последние коммиты по файлу — 6c78db4, 747c085, оба до quiz-среза). Контракт 1.5.0 (задачи 1–8) этот вопрос не решал.
4. План квиза (docs/sessions/2026-09-09-quiz-implementation-plan.md) и дизайн (2026-09-09-quiz-module-design.md) нигде не оговаривают регистр имён — camelCase прошёл незамеченным через design review.

Варианты решения (оба — изменение интерфейса, вне моих полномочий):

- **A. Ослабить `shortEventNameSchema`** (например `[a-z][a-zA-Z0-9_-]*`): обратно-совместимое расширение wire-формата, но это правка SDK-контракта (REQ-CTR-008) — вопрос версии контракта (1.5.0 уже выпущен в этом батче) и апдейт spec'ов SDK.
- **B. Переименовать типы событий квиза** в lowercase (`question.opened` или `question-opened`): правка брифа/дизайна/плана, ripple в задачи 10–14 (e2e-сценарии, редьюсер, фикстуры — везде camelCase).

## TDD Evidence

- **RED (ожидаемый, Step 2):** `pnpm install && pnpm --filter @mymozhem/app-quiz test` → `TS2307: Cannot find module './quiz-manifest'` (исходников нет). PASS как RED.
- **После Step 3:** тот же прогон падает уже на блокере — `ContractError MANIFEST_INVALID` из `defineApp` (invalid_key на записях events), 0 тестов выполнено. Это не GREEN и не исправимый в рамках брифа RED.
- **GREEN:** не достигнут.

## Files changed (uncommitted)

- `packages/app-quiz/package.json` (new)
- `packages/app-quiz/tsconfig.json` (new)
- `packages/app-quiz/jest.config.js` (new)
- `packages/app-quiz/src/quiz-settings.ts` (new)
- `packages/app-quiz/src/quiz-events.ts` (new)
- `packages/app-quiz/src/quiz-manifest.ts` (new)
- `packages/app-quiz/src/quiz-manifest.contract.spec.ts` (new)
- `packages/app-quiz/src/index.ts` (new)
- `pnpm-lock.yaml` (modified)

## Self-review

- Спек покрывает все 4 пункта Step 1 брифа (табличный assert visibility/clientInitiated; Ajv2020 `{allErrors: true, strict: false}`; валидные/невалидные payload'ы всех 7 типов; readPropertyVisibility по всем 4 свойствам appSettings).
- Сверх брифа в спеке: один позитивный кейс `correctAnswers` короче `questions` (документирует семантику «вопрос без правильного ответа» из комментария брифа к `questionRevealedPayload`) и негативный кейс «пустой text вопроса». Оба в рамках Step 1.
- uuid-формат в payload-тестах НЕ проверяю на невалидную строку: Ajv ядра без ajv-formats игнорирует `format: uuid` — тест зеркалит поведение ядра (structural invalid: non-string actorId, missing fields).
- Коммит не выполнен: рабочее дерево содержит падающий тестовый набор (блокер), коммитить RED-состояние не стал.

## Concerns

- До решения владельца задачи 10–14 не имеют смысла начинать: они потребляют эти же short-имена через `AppCommit.shortName` и e2e-протокол.
- Если решением будет вариант A (ослабить схему), нужен также апдейт существующих spec'ов SDK на shortEventNameSchema/eventTypeSchema и решение про версию контракта.

---

## Resolution (после рулинга контроллера)

**Решение: вариант B** — short-имена событий квиза переименованы в dotted-lowercase, `shortEventNameSchema` в SDK не тронута. Контроллер обновил план, дизайн (с erratum) и бриф; я перечитал бриф и применил новые имена.

Новые имена (manifest keys / wire types): `question.opened`, `answer.submitted`, `question.closed`, `game.finish`, `answer.accepted`, `question.revealed`, `game.finished`. TS-идентификаторы (`questionOpenedPayload` и т.д.) остались camelCase — менялись только ключи `events` в манифесте и имена в assertions спеки.

Изменённые файлы после рулинга:

- `packages/app-quiz/src/quiz-manifest.ts` — ключи `events` → quoted dotted names (verbatim обновлённый бриф)
- `packages/app-quiz/src/quiz-manifest.contract.spec.ts` — `EXPECTED_EVENTS` и `PAYLOAD_CASES` на новые имена

### TDD Evidence (финальное)

- **RED (Step 2, до реализации):** `pnpm install && pnpm --filter @mymozhem/app-quiz test` → `TS2307: Cannot find module './quiz-manifest'` (исходников нет) — ожидаемый RED.
- **GREEN (Step 4):** `pnpm --filter @mymozhem/app-quiz test` → **41 passed, 41 total** (1 suite). Все 4 пункта Step 1 брифа зелёные: манифест проходит `appManifestSchema`, табличный assert 7 типов (visibility/clientInitiated), Ajv2020-валидация appSettings (валидный снапшот + 5 негативных кейсов) и payload'ов всех 7 типов (21 кейс), `readPropertyVisibility` по всем 4 свойствам (`correctAnswers` → module-private fail-safe, остальные → public).
- **Boundary (Step 4):** `pnpm boundary-check` → `no dependency violations found (493 modules, 1432 dependencies cruised)`. app-quiz импортирует только `@mymozhem/sdk` и `zod` (ajv — devDep только спеки).
- Дополнительно (CI-гейты): `pnpm --filter @mymozhem/app-quiz typecheck`, `lint`, `build` — все чистые.

### Commit

- `5cf1df7` — `feat(app-quiz): пакет квиза — манифест, appSettings (correctAnswers module-private), схемы 7 типов событий` (9 files, +330; trailer Co-Authored-By на месте; lockfile включён).

### Self-review (по диффу 5cf1df7)

- Исходники соответствуют обновлённому брифу verbatim (схемы, манифест, имена файлов, index-реэкспорт).
- package.json/tsconfig.json/jest.config.js — зеркала sdk; `ajv ^8.20.0` в devDependencies (sdk не реэкспортирует; тест зеркалит конфиг ядра `new Ajv2020({ allErrors: true, strict: false })`).
- uuid-формат в payload-тестах не проверяется на невалидную строку сознательно: Ajv ядра без ajv-formats игнорирует `format: uuid` — тест отражает поведение ядра, а не желаемое.
- Игровой логики нет (YAGNI): только схемы + манифест + index. Замечаний к диффу нет.

**Final status: DONE.**
