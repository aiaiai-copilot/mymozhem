# Task 7 — Контур участника (`/play`) — отчёт имплементера

**Статус:** DONE_WITH_CONCERNS (concerns — только известные расхождения/переходное состояние e2e, см. ниже)
**Коммит:** `1a39801` feat(web): контур участника по дизайн-срезу (вход/ожидание/вопрос с таймером/reveal с дорожками/финал)

## Что реализовано

### Новые файлы

- **`apps/web/src/components/logo.tsx`** — `<Logo contour size />` по ruling C-1: текст «МЫ МОЖЕМЪ» (Приложение A, verbatim, ѣ/ъ проверены побайтово против брифа), `font-family: var(--font-logo)`, золото на сцене; size participant = 19px / projector = 22px (CSS-модификаторы `.logo-participant`/`.logo-projector`). Позиционирование — у страницы (`.play-page .logo { text-align: center }`), компонент несёт только начертание/цвет/кегль. Контур console (цвет `--console-primary`) — для T9, часть запиненного контракта C-1.
- **`apps/web/src/styles/scene.css`** — стили контура участника + логотипа (см. «Размещение стилей» ниже). Подключён в `main.tsx` последним, после transitions.css — чтобы `.btn-join` переопределял `.btn-scene` при равной специфичности.

### play-page.tsx (разметка/стили/тексты; state-архитектура, авто-вход/rejoin/roster-refetch не тронуты)

- **Вход/авто-вход:** `main.play-page` (тёмная сцена: `--scene-bg`, `--scene-text`, padding 21/18/23 из мокапов, `min-height: 100vh/100dvh`, `position: relative` — опора центрирования ожидания); «Входим…» центрирован как ожидание.
- **Ожидание (Step 2):** заголовок «Вы в игре» (`.play-title`, золото Oranienbaum 30px) + тело `.play-waiting` с `position:absolute; top:50%; left/right:18px; transform:translateY(-50%)` — центрирование относительно всей высоты, логотип/заголовок не влияют (мокап center-fix, verbatim).
- **Вопрос (Step 3):** верхняя строка `.play-strip` — кикер «Вопросъ N из M» (золото, `--font-display`, 16px, uppercase; fallback без «из M», если вопроса нет в настройках) + таймер `.play-timer` 40px золотом tabular-nums, рендерится только при `durationSec !== null`. Источники строго по контракту T5: `durationSec` из распарсенных `questions[currentQuestion].durationSec` (parse обязателен, дефолт 30 материализуется на parse — никаких raw appSettings и `?? 30`), `openedAt` = `quiz.openedAt`. Хук `useQuestionTimer` вызван до ранних return (rules of hooks). Вопрос — Oranienbaum 28px, нижний отступ перед вариантами 30px (margin `.play-question`). Варианты — `.btn .btn-scene` на всю ширину с буквенными метками `<b>А</b>…` (каноническая разметка из component-states-live:272 и timer-projector-participant:222); список `.play-options` grid/gap 11px; кнопки растут по высоте, внутренних скроллов нет (п. 7). Ошибка ответа — `.play-error` (`--error-dark`, плотное, п. 6).
- **Reveal (Step 4):** вердикт `.play-verdict` 38px Oranienbaum с различением значком+цветом+текстом (мокап game-states): «✓ Верно!» (success `#8FCAA5`), «× Неверно.» (danger `#E5A092`), «Вы не успели ответить.» (нейтраль); «+N очков» при myPoints>0; «Правильный отвѣтъ» (Приложение A, заменило «Правильный ответ: …») плашкой `.play-correct` (поверхность + золотая кромка); табло = `<RaceTracks entries highlightId={myId} contour="scene" />` полное, шапка `.play-standings-head` — «Табло» + «N-е место» из `myPlace`. Entries: `quiz.totals` + `displayNameOf(names, …)` + `lastRoundGains(events)`.
- **Финал (Step 5):** «Игра завершена» + «Ваши очки: N» + полное табло дорожками («Итоговое табло» + место в шапке) + `Winners` под явным гардом `Object.keys(lottery.draws).length > 0` (п. 18; Winners и сам null-safe, гард для читаемости — как сказано в брифе). `Standings` и `gameFinishedPayload` из play-page убраны (места теперь из `myPlace`, а не из payload game.finished); Standings жив для host/screen до T8/T9.
- **Логотип** — на всех экранах контура (п. 17): в JoinForm (вход), в ветке autoJoinPending и в общем `main` поверх всех in-game состояний. Кнопка «Понятно» в rejoined-нотисе получила `.btn .btn-scene` (была браузерно-дефолтной на тёмной сцене).
- **Опрометчивый комментарий play-page:131 («join не эмитит событий») не трогал** — чистка T12, как сказано в диспатче.

### join-form.tsx (только разметка/стили/тексты; buildJoinRequest и логика submit не тронуты)

- «Входъ в игру» (Приложение A), поля `.play-field` (золотые подписи 14px) + `.play-input` (`--input-scene`, тёмный текст, min-height 49px, radius 4px, placeholder `#354B41` — литерал мокапа, в токенах T4 нет), focus-visible золотой контур 3px/2px.
- Код из URL — read-only полем по мокапу входа (было «Код комнаты: <strong>» абзацем); это чисто визуальное изменение, `code` state по-прежнему инициализируется из `codeFromUrl`.
- Кнопка «Играть» — `btn btn-scene btn-join`: НЕ консольный `.btn-primary` (I-9), вариант из мокапа входа (поверхность сцены + золото, 700 17px, min-height 52px, radius 4px, width 100%, **margin-top 34px**); состояния hover/active/focus/disabled наследуются от системы `.btn`/`.btn-scene` (transitions.css).

## Гейты (шаг 6)

- `pnpm --filter @mymozhem/web test` — **145/145 passed** (22 файла)
- `pnpm --filter @mymozhem/web typecheck` — чисто
- `pnpm --filter @mymozhem/web lint` — чисто

TDD: failing-test шагов в брифе нет; чистые функции join-form (`buildJoinRequest`) не касался — join-form.spec.ts не расширялся (по брифу: «при касании»). Вёрстка — typecheck + гейты (принятая стратегия I-11).

## Размещение новых стилей (обоснование, ruling C-2)

Новый файл **`styles/scene.css`**, а не расширение transitions.css: transitions.css по своей шапке — «система состояний и контент-анимаций» (кнопки/дорожки), туда раскладка экранов не ложится по смыслу; tokens.css/base.css заморожены ролями T4. scene.css собирает раскладку тёмного сценического контура (участник сейчас; проектор T8 — тот же контур §4, сможет расширить этот файл или добавить соседний `screen`-блок). Стили логотипа — там же: компонент по C-1 несёт только начертание/цвет/кегль, а это и есть сценическая типографика; позиционирование осталось странице (`.play-page .logo`).

## Self-review (свой diff свежим взглядом)

- Полнота против брифа: шаги 1–5 покрыты, словарь Приложения A verbatim (побайтово сверено: «МЫ МОЖЕМЪ», «Вопросъ N», «Правильный отвѣтъ» с U+0463, «Входъ в игру»).
- YAGNI: `logo-console`/`logo-projector` без текущего потребителя — но это запиненный контракт C-1 (T8/T9), не спекуляция. `OPTION_LETTERS` ограничен 8 буквами с fallback без метки (схема не ограничивает число вариантов сверху).
- Паттерны репо: чистые функции не тронуты, DOM-тестов не добавлял, сортировка/нормировка осталась внутри RaceTracks; `myPlace` получает предсортированный список по контракту T6 (дублирующий sort на странице — осознанно, ранг считается от полного списка).
- Hooks: `useQuestionTimer` до раннего return `!roomId` — проверено.
- progress.md (леджер контроллера) в коммит НЕ включён.

## Concerns / расхождения мокапов с брифом и принятые решения

1. **e2e smoke.spec.ts устарел к новой разметке** (ожидаемо, переходное состояние): :44 ждёт «Вход в игру» (теперь «Входъ в игру»), :58 `getByRole('button', { name: 'Париж', exact: true })` (accessible name теперь с буквой «А»), :73 `getByRole('cell', …)` (Standings-таблица на /play заменена RaceTracks). По плану веб-e2e не входит в гейты до T13 («веб e2e — T13», строка 26 плана; Task 13 владеет smoke.spec.ts) — оставлено T13. Не прогонял (вне гейтов шага 6).
2. **Кикер «Вопросъ N из M»**: словарь фиксирует «Вопросъ N»; «из M» взято из мокапов timer-projector-participant и participant-long-content (flow-v2 показывает без «из M»). Решение: с «из M» при наличии вопроса в настройках, иначе без.
3. **Цвет кикера**: flow-v2/long-content — золото Oranienbaum 16px; timer-projector-participant — muted 13px PT Sans. Взял золото (2 мокапа против 1; flow-v2 — эталон потока).
4. **Буквенные метки вариантов** («А», «Б»…) — из component-states-live (каноническая разметка `.btn-scene` с `<b>`) и timer-projector-participant; flow-v2 без меток. Взял с метками (правило `.btn-scene b` уже в transitions.css от T4).
5. **Цвета вердиктов success/danger (`#8FCAA5`/`#E5A092`) и placeholder `#354B41`** — литералы мокапов game-states/center-fix, в токенах T4 их нет; положил литералами в scene.css с комментариями, токены не расширял (файл T4). Кандидат на токены при касании T13/T14.
6. **«Без начисления очков»** (мокап game-states, неверно) не добавлял — бриф фиксирует только «+N очков» при myPoints>0; текущее поведение (ничего при 0) сохранено.
7. **Заголовок финала** оставлен «Игра завершена» (существующий текст; long-content/game-states согласны); tracks-scene-with-logo показывает «Игра окончена» — расхождение мокапов, бриф молчит, менять без основания не стал. Аналогично «место в шапке» — по брифу в шапке табло (`.play-standings-head`), а не sub-line «Ты — … · N-е место» из tracks-мокапа.
8. **Размер кегля вопроса 28px** (flow-v2) — edge/timer мокапы дают 27/26px; взял эталон потока. `line-height: 1.13` из flow-v2.
9. **`min-height: 100dvh`** добавлен прогрессивным улучшением поверх 100vh (мобильные браузерные панели) — мокапы молчат, хуже не делает.
