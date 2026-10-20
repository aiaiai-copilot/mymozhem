# Task 6 — отчёт: Дорожки — чистая логика + компонент RaceTracks

## Что реализовано

**Чистая логика** (`apps/web/src/state/race-tracks.ts`), 4 функции по Interfaces брифа:

- `lastRoundGains(events: ProjectedEvent[]): Record<string, number>` — проход по логу, перезапись на каждом `quiz.question.revealed`; payload парсится `questionRevealedPayload.parse` из `@mymozhem/app-quiz` (тот же паттерн, что `answerAcceptedPayload.parse` в `projections.ts:58`). Reveal не было → `{}`.
- `trackWidths(entries, gains): Map<string, {fillPct, gainPct}>` — лидер = max total; fill = (total−gain)/leader×100 (clamp fill ≥ 0 на случай gain > total), gain = gain/leader×100; лидер 0 → все 0/0 (без деления на ноль); отсутствующая запись в gains → gain 0.
- `topNWithRest<T>(list, n)` — `slice(0, n)` + `max(len−n, 0)`.
- `myPlace(sortedEntries, myId)` — плотный порядок desc (равные делят место, следующее отличающееся — place+1: 1,2,2,3); отсутствующий id → null.

**Компонент** (`apps/web/src/components/race-tracks.tsx`): `<RaceTracks entries highlightId? topN? contour />`, `contour` обязателен (`'scene' | 'console'`). Сортировка desc внутри компонента (стабильная, как в `standings.tsx`); нормировка — к лидеру ПОЛНОГО списка, обрезка topN не меняет масштаб. Разметка по мокапу: `.track-row > .tr-top (.tr-name, .tr-score tabular-nums) + .tr-lane (.fill, .gain)`, width инлайн в процентах; `highlightId` → `<span class="me">это ты</span>` внутри `.tr-name` (мокап tracks-scene); `topN` → `<div class="tr-more">ещё {rest}</div>`; `.fill.solo` при gainPct 0 (закруглённый конец, мокап console-reveal-tracks).

**CSS** — блок «Дорожки» добавлен в конец `apps/web/src/styles/transitions.css` (обоснование ниже); reduced-motion блок расширен селекторами `.race-tracks .fill/.gain`.

## TDD Evidence

**RED** — `pnpm --filter @mymozhem/web test` после написания спеки (Step 1–2):

```
Error: Cannot find module './race-tracks' imported from
  apps/web/src/state/race-tracks.spec.ts
 Test Files  1 failed | 21 passed (22)
```

Ожидаемо: модуль `race-tracks.ts` ещё не существовал; остальные 21 файл (132 теста) зелёные — падение точечное, спека — единственный источник красного.

**GREEN** — `pnpm --filter @mymozhem/web test` после реализации (Step 3–4):

```
 Test Files  22 passed (22)
      Tests  145 passed (145)
```

+13 новых тестов (132 → 145), все кейсы Step 1 брифа в спеке:
- лидер-нормировка 1500/1200/900 → 100/80/60 ✅
- прирост отделён: gains {a:300} → fill 80 / gain 20 (сумма 100) ✅
- лидер 0 / все нули → всё 0 ✅
- нулевой gain → gainPct 0 ✅ (+ отсутствующая запись в gains → 0)
- `lastRoundGains` — последний reveal: golden-фикстура `quizMiniGameLog` (два reveal, ожидание `{PLAYER_2: 100}`) + синтетика «два reveal подряд → второй» + «reveal не было → {}» ✅
- `topNWithRest([…7], 4)` → top 4, rest 3 (+ n ≥ len → rest 0, пустой список) ✅
- `myPlace` — плотный desc с делением мест (b и c на 1200 → оба 2, d на 900 → 3), отсутствующий → null ✅

**Гейты**: `pnpm --filter @mymozhem/web typecheck` ✅; `pnpm --filter @mymozhem/web build` ✅ (chunk-size warning — предсуществующий); `pnpm --filter @mymozhem/web lint` ✅ (дополнительно к брифу).

## Files changed

- `apps/web/src/state/race-tracks.ts` (новый, 75 строк)
- `apps/web/src/state/race-tracks.spec.ts` (новый, 145 строк)
- `apps/web/src/components/race-tracks.tsx` (новый, 73 строки)
- `apps/web/src/styles/transitions.css` (+62/−3: блок дорожек + расширение reduced-motion + правка header-комментария)

Commit: `b3a0bf8` — `feat(web): race-tracks — логика дорожек (нормировка к лидеру, прирост из последнего reveal) + компонент RaceTracks` (точный message из брифа; только файлы задачи, леджер progress.md не включён — паттерн коммитов T4/T5).

## Решение по размещению CSS дорожек (п. 4 контекста)

**Выбор: блок в конце `transitions.css`, НЕ отдельный файл.** Обоснование:

1. **Паттерн мокапа.** В каноническом мокапе `component-states-live.html` стили дорожек лежат одной секцией рядом с кнопочной системой и делят с ней ЕДИНЫЙ `@media (prefers-reduced-motion: reduce)` блок. `transitions.css` — порт именно этого листа; дорожки портируются туда же, структура 1:1.
2. **Паттерн репо.** `main.tsx` импортирует три глобальных листа (tokens/base/transitions); per-component CSS-файлов в репо нет — новый файл был бы новым паттерном.
3. **Reduced-motion.** Проверка по п. 4: глобальный блок T4 гасил ТОЛЬКО `.btn` — мои `transition: width var(--t-race)` под него НЕ попадали. Исправлено: блок расширен селекторами `.race-tracks .fill, .race-tracks .gain` (как в мокапе). Header-комментарий файла обновлён («система состояний и контент-анимаций», не только кнопки).

Стоимость ошибки низкая (ruling B-3): при касании T7–T9 блок переедет одной правкой, если ревью/приёмка предпочтут отдельный файл.

## Self-review findings

- Все 7 групп кейсов Step 1 в спеке (см. GREEN-выше); края из п. 6 контекста запинаны дословно.
- Компонент: 5 канонических классов на месте; tabular-nums на `.tr-score` (CSS); контуры переключают ТОЛЬКО полотно/цвета текста, заливка единая; «ещё N» рендерится при rest > 0; highlightId → `.me`.
- Типы строгие, `any` нет; `TrackTotal`/`TrackWidth`/`RaceTrackEntry` экспортированы; `readonly` на входных массивах/записях.
- DOM-тестов нет; тест-аутпут чистый (145/145, без warnings).
- Ноль новых npm-зависимостей; `pnpm install` не запускался.
- Потребителей (T7–T9) пока нет — ожидаемо; `standings.tsx` не тронут (I-4).

## Concerns / расхождения мокапа с брифом (бриф важнее — отмечаю)

1. **Заливка fill.** Мокап `console-reveal-tracks.html` красит fill в `--console-primary`, сцена — в `--track-fill`. Бриф (п. 4): заливка `var(--track-fill)` для обоих контуров. Взял бриф: один токен `--track-fill`. Мокапы между собой расходятся — вероятный кандидат на вопрос визуальной приёмки T13.
2. **Текст «ещё N».** Бриф: «ещё N». Мокапы: `+ ещё 14 участников` (проектор), `ещё 14 — развернуть` (консоль). Взял бриф дословно (`ещё {rest}`) — без плюрализации «участников»; если приёмка захочет мокап-текст, это одна строка в tsx. Класс — `.tr-more` (в мокапах `.pj-more`/`.more`; бриф класс не пинит, выбрал неймспейс `tr-*` за консистентность с tr-top/tr-lane).
3. **`.fill.solo`.** В каноническом мокапе (component-states-live) gain-див рендерится с width:0% без solo; в tracks-мокапах solo есть. Добавил solo (деталь из мокапов, не противоречит брифу): gain-див рендерится всегда (стабильность DOM для transition), fill получает `solo` при gainPct 0.
4. **`--track` vs canvas-токены.** Мокапы используют `var(--track)`/`var(--lane-dark)` для полотна; в tokens.css (T4) этих имён нет — есть `--track-canvas-dark/light`. Маппинг по брифу: scene → dark, console → light. Расхождение имён — мокапное, токены брифа/T4 каноничны.
5. **`myPlace`/`lastRoundGains` компонентом не используются** — они для потребителей T7–T9 (компонент получает готовые `gain` и `highlightId`). Это по Interfaces брифа, не пропуск.
6. **progress.md в worktree модифицирован контроллером** (леджер батча B, запись «Task 6: dispatched (sonnet)») — в коммит задачи не включён, как в T4/T5; консолидация леджера — на контроллере.
