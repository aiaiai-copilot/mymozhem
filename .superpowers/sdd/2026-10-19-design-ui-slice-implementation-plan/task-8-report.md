# Task 8 — Контур проектора (`/screen`): отчёт имплементера

## Что реализовано

Переверстан `apps/web/src/pages/screen/screen-page.tsx` по мокапам-эталонам; state-архитектура (join/rejoin/roster-refetch, вывод состояний из лога) не тронута. Проектор остался read-only.

- **Step 1 — каркас:** `main.screen-page` (фон сцены, position:relative, min-height 100dvh, padding 34px 44px по `pj-inner` мокапа timer-projector-participant). `<Logo contour="scene" size="projector" />` (22px золотом) рендерится в обоих return-ветках — включая экран подключения/ошибки join и вопрос с таймером (п. 17). Позиционирование — `.screen-page .logo { margin-bottom: 14px }` (страница, ruling C-1). Ожидание/отмена/закрытые ответы/ошибка join — `.screen-waiting`: центрирование во всём кадре (top 50% + translateY(-50%), п. 8), логотип не влияет.
- **Step 2 — вопрос:** верхняя строка `.screen-strip`: кикер «Вопросъ N из M» (ъ = U+044A, verbatim из play-page; fallback «Вопросъ N») + таймер 56px золотом var(--gold), tabular-nums, `<small>осталось</small>` — по мокапу timer-projector-participant. Таймер: `useQuestionTimer(durationSec, quiz.openedAt)` — durationSec только из schema-parse `questions[currentQuestion].durationSec` (`?? null`, без raw appSettings и без «?? 30»); хук вызван до ранних return. Только при `durationSec !== null`; ноль — спокойный `0:00`. Заголовок Oranienbaum 38px, margin-bottom 35px (отступ перед вариантами, п. 8). Варианты — grid 1fr 1fr, поверхность var(--scene-surface), без золотых вертикальных линий, буквенные метки А–З золотым `<b>` (как у участника). Компактная плотность (длинный вопрос / >4 вариантов, projector-options-no-lines): 34px/1.12, gap 10px 20px, min-height 48px, padding 9px 12px — переключение чистой функцией `isCompactQuestion` (новый `state/question-density.ts` + spec, 6 тестов). Порог «длинного» текста `COMPACT_TEXT_LENGTH = 100` — допущение (мокапы числом не определяют), к ревью.
- **Step 3 — reveal:** `.screen-reveal` grid 1fr/1.1fr gap 36px (tracks-scene-with-logo). Слева «Правильный отвѣтъ» (ѣ = U+0463, ъ = U+044A — проверено hexdump; заменяет «Правильный ответ: …») muted-label + значение 40px золотом; источник ответа — только payload revealed. Справа «Табло» + `<RaceTracks entries contour="scene" topN={4} />`; entries — quiz.totals + displayNameOf + lastRoundGains. Строка «ещё N» — как рендерит компонент (ruling C-4, не переопределена).
- **Step 4 — финал:** топ-5 дорожками + «ещё N» (компонент); победители — `.screen-winners` (flex, вертикальный центр) в правой колонке grid 1.2fr/1fr; заголовок 32px, имена 24px — стилизацией со стороны страницы, winners.tsx не тронут (play/console не затронуты). Без розыгрыша (`lottery.draws` пуст): блок победителей не рендерится, `.screen-final-solo` центрирует табло на всю зону (одна колонка minmax(0,720px) + justify-content:center; 720px — допущение, мокап состояния не показывает, к ревью). Места из payload game.finished больше не используются — дорожки сортируют desc сами (прецедент финала участника T7); импорты Standings/gameFinishedPayload удалены.
- **Замена старых стилей:** base.css:74-85 (`.screen-question`/`.screen-options` «потребители живы до T8») удалены; финальные стили — в новом `apps/web/src/styles/screen.css` (те же имена классов переопределены там; единственный потребитель — screen-page.tsx, висячих ссылок нет — проверено grep). `main.tsx`: импорт screen.css последним (после scene.css). Хвост шапки scene.css обновлён: «проектор (T8) — соседний screen.css».

## Размещение стилей (ruling C-2) — обоснование

Соседний `styles/screen.css`, а не расширение scene.css: scene.css по шапке — «контур участника (/play)», раскладки страниц разные; общее у контуров сцены только `.logo` (остаётся в scene.css, как есть). Пер-страничный файл зеркалит структуру pages/ и держит файлы компактными; порядок импортов в main.tsx сохраняет каскад tokens → base → transitions → контуры.

## Гейты (шаг 5, после всех правок)

- `pnpm --filter @mymozhem/web test` — 23 файла, 151 тест passed (было 145 + 6 новых question-density).
- `pnpm --filter @mymozhem/web typecheck` — чисто.
- `pnpm --filter @mymozhem/web lint` — чисто.
- `pnpm --filter @mymozhem/web build` — успешно (chunk-size warning 665 kB — предсуществующее, не моё).

## Файлы

- Изменены: `apps/web/src/pages/screen/screen-page.tsx`, `apps/web/src/styles/base.css`, `apps/web/src/main.tsx`, `apps/web/src/styles/scene.css` (одна строка шапки).
- Созданы: `apps/web/src/styles/screen.css`, `apps/web/src/state/question-density.ts`, `apps/web/src/state/question-density.spec.ts`.
- progress.md не коммитился (леджер контроллера).

## Self-review находки

1. Случайно задел устаревший комментарий «join не эмитит событий» (отнесён к T12) — откачено, строка восстановлена verbatim перед коммитом.
2. `.screen-answer` — класс-хук без CSS-правила (семантическая обёртка левой колонки reveal); осознанно, для симметрии чтения grid.

## Расхождения мокапов (решения имплементера, к ревью)

1. **Буквенные метки вариантов:** timer-projector-participant (сессия 45) показывает А/Б/В/Г на проекторе, projector-options-no-lines (сессия 44) — без меток. Взял метки: паритет с контуром участника (T7) и более поздний мокап.
2. **Кикер:** timer-мокап — muted PT Sans 16px; six-clean и participant (.play-kicker) — золотой display. Взял золотой var(--font-display) 18px (six-clean + паритет с участником).
3. **Скругление вариантов:** timer-мокап — radius 10px; six-clean — без radius. Взял 10px в обеих плотностях (консистентность поверхностей сцены с .btn-scene).
4. **Заголовок табло («Табло»/«Итоговое табло»):** final-winners-large — золотой caption 25px (табличный мокап сессии 44, до решения п. 13 о дорожках); tracks-scene-with-logo — muted small-caps 14px. Взял muted small-caps (дорожечный эталон сессии 45, единообразие reveal/финала). Кегли победителей 32/24 — из final-winners-large по брифу (бриф важнее).
5. **Подпись «осталось» у таймера** — из timer-мокапа; дизайн п. 12 её не упоминает, но бриф отсылает «по мокапу».
6. **Кегли дорожек проектора** (16/15/13px, полотно 9px) — переопределение поверх transitions.css под `.screen-page` по tracks-scene-with-logo; базовые стили компонента не тронуты (консоль/участник не затронуты).
7. Допущения без мокапа: порог длинного вопроса 100 символов; ширина solo-табло финала 720px; кегль `.screen-waiting`/`.screen-note` 24px и центровка текста ожидания.

## Concerns

- Watch-item (gold focus-visible сужен до .btn-scene): проектор без интерактива — ничего не потребовалось.
- Визуальная сверка на живом проекторе остаётся за ручной приёмкой (DOM-тестов в репо нет, I-11).
