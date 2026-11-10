# Task 9 report — Консоль: каркас, игра, reveal, «Квиз окончен»

Commit: `3efda3d` (ветка design-ui-slice). Сообщение — из шага 8 брифа.

## Что реализовано

**Step 1–2 (каркас, TDD):**
- `pages/host/open-question-label.ts` — `openQuestionLabel(index, durationSec)`: число → «Открыть вопрос N (30 с)», null → без суффикса.
- `styles/console.css` (новый) + импорт в `main.tsx` после screen.css. Палитра — токены T4; разметка/значения перенесены из мокапов console-phone-landscape-v2 / console-reveal-final-button / console-quiz-finished / console-empty-long-errors-v2.
- Каркас console-page: sticky-полоса комнаты (Logo console/participant + индикатор связи «на связи/подключение…/нет связи» + код комнаты) → hero (QuizControls) → секции (карточка «Приглашения» + панели) → тихая «Завершить событие» внизу. Иерархия «статус → момент → действие».
- Ландшафт-правило: `@media (orientation: landscape) and (max-height: 400px)` — hero две колонки (`1fr 220px`, действия справа), секции в два столбца; первый экран = полоса + hero с главной кнопкой без прокрутки.

**Step 3 (игра):** hero: «Вопрос N из M — открыт», текст вопроса, таймер 52px (`useQuestionTimer(durationSec, quiz.openedAt)`, `formatTimer`, только при числовом durationSec и accepting) + счётчик «N из M ответили» с баром. Главная кнопка «Закрыть вопрос»; рядом disabled secondary «Открыть вопрос N+1 — сначала закройте текущий» (причина текстом, п. 15). Тихая «Завершить событие» внизу страницы (`.btn-quiet`), наградами не блокируется (REQ-RWD-009).

**Step 4 (reveal):** «Вопрос N из M — закрыт», плашка «Правильный ответ» (correctIndex из reveal-payload → options по schema-parse; поле optional — без него плашки нет), разбор «верно/неверно/не успели» (awarded / answered−awarded / participants−answered, clamp 0), ростер = `<RaceTracks contour="console" topN={expanded ? undefined : 4}>` с приростом из `lastRoundGains` и именами `displayNameOf`; toggle «ещё N — развернуть»/«Свернуть» — локальный state, `useEffect` схлопывает к топ-4 при смене currentQuestion (I-5). Главная кнопка — `openQuestionLabel(next, nextDurationSec)`.

**Step 5 («Квиз окончен»):** условие `quiz.finished && feed.status === 'ACTIVE'` (в console-page — `quizFinishedLive`). Hero: label «Квиз окончен», заголовок «Все N вопросов сыграны» (или «Сыграно вопросов: X из N» при досрочном finish — мокап покрывает только полную колоду), подсказка «Осталось вручить наград: N…» ТОЛЬКО при pendingAwards > 0 (п. 18; null/ошибка загрузки → без подсказки). Главная кнопка «Завершить событие» — та же `completeEvent` (confirm + completeRoom), что была на странице. Данные наград — существующий `listRewards` (как AwardsPanel), рефетч по публичным `rewards.*` (awarded/fulfilled/revoked); загрузка только пока экран показан. Итоговое табло — RaceTracks (gain 0, топ-4 + toggle). Дубль тихой «Завершить событие» внизу на этом экране скрыт (`!feed.quiz.finished`).

**Step 6:** `components/standings.tsx` удалён; единственный потребитель (quiz-controls) мигрирован на RaceTracks; висячий комментарий «как в Standings» в race-tracks.tsx поправлен. `standings` в fixtures — данные payload, не компонент (остались, как и предписано).

## TDD evidence (openQuestionLabel + helpers)

RED (`pnpm --filter @mymozhem/web test` после добавления тестов, до реализации):
```
Test Files  2 failed | 21 passed (23)
Tests  4 failed | 143 passed (147)
FAIL console-page.spec.ts > participantsCount — participantsCount is not a function
FAIL console-page.spec.ts > pendingAwardsCount — pendingAwardsCount is not a function
(openQuestionLabel — module './open-question-label' not found, suite-level fail)
```
GREEN после `open-question-label.ts` + helpers в console-page.tsx:
```
Test Files  23 passed (23)
Tests  157 passed (157)
```

## Гейты

- `pnpm --filter @mymozhem/web test` — 157/157 (23 файла).
- `pnpm --filter @mymozhem/web typecheck` — чисто; `lint` — чисто.
- `pnpm run boundary-check` — 0 violations (763 modules).
- `pnpm build` — 6/6 successful.
- `pnpm test` корня — 10/10 successful (core/server — cached, входы не менялись: подтверждено, что не тронуты).
- `pnpm run test:int` — 223/223 (cached, не тронуты); `pnpm lint`/`typecheck` корня — зелёные; `guardrails` — all alive.

## Файлы

- Созданы: `apps/web/src/pages/host/open-question-label.ts`, `apps/web/src/styles/console.css`
- Изменены: `apps/web/src/pages/host/quiz-controls.tsx`, `apps/web/src/pages/host/console-page.tsx`, `apps/web/src/pages/host/quiz-controls.spec.ts` (+openQuestionLabel), `apps/web/src/pages/host/console-page.spec.ts` (+participantsCount/pendingAwardsCount), `apps/web/src/main.tsx` (импорт console.css), `apps/web/src/components/race-tracks.tsx` (комментарий)
- Удалён: `apps/web/src/components/standings.tsx`

## Решения и обоснования

- **openQuestionLabel — отдельным файлом** (`pages/host/open-question-label.ts`), не внутри quiz-controls.tsx: чистая функция рядом со страницей — прецедент `host-gate-flow.ts`; компонентный файл не раздувается.
- **Размещение стилей (ruling C-2):** `styles/console.css` — соседне к scene.css/screen.css (там участник/проектор, здесь ведущий; кнопки и дорожки остаются в transitions.css). Симметрия контуров, один импорт в main.tsx.
- **deckExhausted в reveal:** главная кнопка становится «Завершить квиз» (иерархия «следующее действие» — колода кончилась, действие одно). Мокап не покрывает; зафиксировано.
- **participantsCount/pendingAwardsCount** — экспортированные чистые функции console-page.tsx, под тестами console-page.spec.ts (бриф мандатирует расширение обоих spec-файлов).
- **«ещё N — развернуть»:** интерактивная кнопка в обёртке `.console-tracks`; статичный `.tr-more` RaceTracks внутри обёртки скрыт CSS (`display:none`), чтобы не дублировать строку — RaceTracks (shared с проектором, который read-only по п. 8) не тронут.

## Расхождения с мокапами (бриф/дизайн важнее — зафиксировано)

1. Подпись главной кнопки reveal — одна строка «Открыть вопрос 4 (30 с)» по брифу/Review Focus 4, а не двухэтажная с `<span class="sub">30 секунд на ответ</span>` из console-reveal-final-button.
2. Тихая «Завершить событие» — `.btn-quiet` (бриф Step 3 verbatim), а не красная `.btn-danger-quiet` мокапов.
3. Подсказка «Квиз окончен» — только невручённые награды (бриф/п. 18); «разыграть 1 приз» из подсказки мокапа и secondary-кнопка «Разыграть "Шоколад"» не реализованы (розыгрыш — PrizesPanel ниже, T11/T12).
4. ok-зелёный индикатора связи `#2F6B4F` — литерал мокапа с комментарием (в токенах T4 нет; прецедент — `.play-input::placeholder` в scene.css).
5. Reveal-карточка «Участники» в ландшафте во всю ширину (рендерится внутри QuizControls, до `.console-sections`); двухстолбиковый `.land-below` мокапа для неё не воспроизведён.
6. h1 «Консоль ведущего» убран — в мокапах заголовка страницы нет, идентичность несёт полоса с логотипом.

## Concerns

- Визуальная сверка (ландшафт ≤400px, toggle, таймер) — за ручной приёмкой T13; DOM-тестов нет (I-11).
- `ConnectionBanner` в консоли заменён индикатором в полосе + error-banner при disconnected (по мокапу errors); play/screen не тронуты.
