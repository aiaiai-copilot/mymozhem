# Task 10 — ревью: app-quiz → manifestVersion 2 + эффекты начислений

**Коммит:** `e8f32b8` · **Ревьюер:** subagent reviewer · **Дата:** 2026-09-22

## Spec compliance: ✅

| Требование брифа | Статус | Подтверждение |
|---|---|---|
| `QUIZ_MANIFEST_VERSION = 2` | ✅ | `quiz-manifest.ts:8`; dist-артефакт (`dist/quiz-manifest.d.ts`) подтверждает сборку |
| `capabilities: ['rewards']` в defineApp | ✅ | `quiz-manifest.ts:12`; SDK поддерживает поле (`manifest.schema.ts:54`, `define-app.ts:24,135`) |
| Все команды возвращают `AppPublishResult` (`{ commits, effects: [] }`) | ✅ | `quiz-handlers.ts`: openQuestion, submitAnswer, closeQuestion, finishGame, сигнатура `handleQuizPublish` |
| closeQuestion: эффекты ровно `{ kind: 'award.points', identityId, points, reason: 'quiz.round' }` | ✅ | `quiz-handlers.ts:126-128` — дословно по брифу |
| Фильтр `points > 0` (clamp-ветка без нулевых грантов) | ✅ | `quiz-handlers.ts:127` + отдельный тест clamp-ветки |
| Скоринг не изменён (`Math.max(base − k·step, 0)`) | ✅ | `quiz-handlers.ts:111-114` — diff не трогает расчёт |
| Reveal-коммит не изменён | ✅ | Сохранённые ассерты `awarded`/`totals`/`correctIndex` в тестах; новый тест пиннит `awarded` в reveal |
| Порядок эффектов = порядок awarded (seq-ранжирование) | ✅ | `awarded` строится из `correct`, отсортированного по seq (`quiz-handlers.ts:108-110`); `filter`/`map` порядок сохраняют; тест ассертит точный упорядоченный массив `[P2=1000, P1=900]` |
| Без новой идемпотентности (гейт ROUND_NOT_OPEN) | ✅ | Гейт `quiz-handlers.ts:100-102` предшествует вычислению эффектов; новой логики нет |
| `game.finished` без эффектов (§0.8) | ✅ | `effects: []` с комментарием |
| Boundary: app-quiz импортирует только `@mymozhem/sdk` | ✅ | Проверено grep: не-локальные импорты — только `@mymozhem/sdk` и `zod` |
| Тесты мигрированы на новую форму без type-cast'ов | ✅ | Все `as AppCommit[]` убраны; ассерты идут через `result.commits`/`result.effects` напрямую |
| Манифест-контракт: пин version 2 + capabilities | ✅ | `quiz-manifest.contract.spec.ts:36-41` |
| Сообщение коммита по Step 5 | ✅ | Дословно, включая `Co-Authored-By` |
| Коммит затрагивает только `packages/app-quiz` | ✅ | 4 файла в дифе, все внутри пакета |
| quiz.e2e не запускался | ✅ (не флаговать) | Предписано брифом Step 4 и глобальными ограничениями |

REQ-покрытие подтверждено: REQ-RWD-002a/b (положительные начисления, clamp без грантов — совпадает с `z.number().int().positive()` в `app-effect.ts:15`), REQ-RT-004 (пин (appId, manifestVersion)=2), REQ-RWD-001 (capability в манифесте).

## Strengths

- **Миграция тестов честная**: ожидания переписаны на `expect(result).toEqual({ commits, effects: [] })` — полная форма возврата пиннится, а не обходится кастом. Это ловит и лишние эффекты, и лишние коммиты.
- **Новые тесты ассертят смысл**: точный упорядоченный `toEqual` на эффекты; clamp-тест проверяет ключевое различие — нулевые начисления остаются в reveal (табло), но не попадают в effects (ledger).
- **Тестовые actorId — валидные UUID** (`quiz-handlers.spec.ts:17-21`), так что порождаемые эффекты прошли бы zod-валидацию `awardPointsEffectSchema` — тесты не оторваны от контракта.
- Комментарий о дублировании табло/ledger с инвариантом «менять вместе» — нужная плотность, соответствует окружающему стилю файла.
- `quiz-runtime.ts` не потребовал изменений: `AppRuntimeModule.handlePublish` (Task 2-3) уже принимает `AppCommit[] | AppPublishResult` — миграция легла в существующий контракт без затыкания типов.

## Issues

### Minor

1. **`quiz-handlers.spec.ts:200` — вводящий в заблуждение комментарий.** В тесте «начисления» P1 помечен `// correct, second` при `seq: 3`, тогда как неверный P3 имеет `seq: 2`. Комментарий верен среди правильных ответов, но читатель, смотрящий на seq-номера, может решить, что P1 третий. Сценарий: будущий редактор «исправит» seq или ассерт, полагаясь на комментарий. Косметика, не блокер.

2. **`quiz-handlers.spec.ts:212, 234` — `result.commits[1].payload.awarded` типизируется как `unknown`.** `payload` — `Record<string, unknown>`, поэтому доступ не типизирован; `toEqual` работает, но опечатка в имени поля (`awardd`) не будет поймана компилятором. Соответствует pre-existing стилю файла (старый тест делал то же с `totals`), поэтому не запрос на изменение — фиксирую как наблюдение.

Critical: 0 · Important: 0 · Minor: 2.

## Cannot verify from diff

- Заявленные RED/GREEN-прогоны (86 тестов зелёные) — принимаются по отчёту; сьют не перезапускался по инструкции. Косвенное подтверждение: `pnpm build` прошёл (dist содержит version 2), типы в дифе согласованы с SDK-контрактами.
- Утверждение об ajv console-шуме как pre-existing — из дифа не следует, но и не влияет на приёмку.
- Отсутствие падения quiz.e2e на CAPABILITY_UNAVAILABLE до Task 11 — предсказано брифом, фактическое падение не проверялось (и не должно было).

## Вердикт

**Approved.** Полное соответствие брифу, без скоуп-крипа; миграция тестов ассертит новую форму по существу; порядок эффектов и clamp-семантика закрыты точными тестами. Minor-замечания — косметика, исправление по желанию.
