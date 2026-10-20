# Task 10 brief (батч D, сессия 51) — редактор квиза и setup

Модель: sonnet. Диспатч параллельно с T12 (непересекающиеся файлы).

- План Task 10 (~:221–236) + дизайн §5.3/§6, п. 9, п. 14.
- TDD строго: RED зафиксировать, потом GREEN.
- Файлы: quiz-editor.tsx, quiz-editor.spec.ts, setup-page.tsx; стили — новая секция в конце console.css.
- `QuizQuestionForm += { durationSec: string; unlimited: boolean }` (дефолт `'30'`/`false`); buildQuizSettings: unlimited → null, иначе Number(trim); валидация остаётся на quizSettingsSchema (5–600, default 30).
- Спек: дефолт→30, unlimited→null (включая мусор в поле), 5/600 pass + 4/601 fail через safeParse, trim; устаревший комментарий «Task 10» переписать.
- Текст общей ошибки += время («целое 5–600 с или «без лимита»»).
- Radio-группа (п. 9): fieldset + один видимый legend «Правильный ответ» (СОВРЕМЕННАЯ орфография — Приложение A только сцена), radio aria-label «Вариант N — правильный», повторяющийся label убран, name=`correct-${qIndex}` сохранён.
- Разметка списка вопросов по console-editor.html (длительности/номера); «+ Добавить вариант» .btn-secondary, «Сохранить и запустить» .btn-primary (#10514F из токенов, без новых литералов).
- setup-page.tsx → палитра/классы консоли (console-page, console-card, .btn); поведение не менять.
- Мокапы (read-only, основной чекаут): console-editor.html — ВНИМАНИЕ, каталог сессии 45 (33682-1792424164), не 45713 (план пишет без каталога; канонический список дизайн-дока); forms-and-system-states-v2.html, editor-secondary-button-darker.html (45713).
- Среда: без install/npx/новых зависимостей; гейты `pnpm --filter @mymozhem/web test|lint|typecheck`; коммит `feat(web): редактор — поле «Время на ответ» (5–600/без лимита), radio-legend «Правильный ответ», палитра консоли` + Co-Authored-By.
- Отчёт: файлы, RED/GREEN, гейты, отклонения явно, флаги для таск-ревью.
