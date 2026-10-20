# Task 11 report (имплементер sonnet) + таск-ревью (sonnet) — CLEAN

## Имплементер — коммит `0d51756` (6 файлов: prizes-panel.tsx + .spec.ts (+3 теста TDD), awards-panel.tsx, winners.tsx, console-page.tsx, console.css +122 строки)

- **Баннер победителя** внутри карточки призов: `lastCompletedDraw(events)` — чистая экспортируемая функция, payload через drawCompletedPayload.parse (прецедент lastRoundGains); имя displayNameOf(names, winnerId) (новый проп names); название приза из локального prizes по prizeId (fallback без строки «выигрывает…»). 36px var(--font-display), ландшафт ≤400px → 32px. Разыгранный приз — тихий статус «Разыграна/Разыграны».
- **COMPLETED** — полная render-ветка: hero + подзаголовок («· вручите награды» только при pendingAwards > 0); AwardsPanel первой секцией (только при наградах > 0); «Итоговое табло» RaceTracks console топ-4 + toggle; «Вернуться к началу — новое событие» (clearHostRoom + HOST_NEW_PATH). QuizControls/приглашения/members/prizes/Winners не рендерятся; CANCELLED не тронута. Эффект наград: `awardsNeeded = quizFinishedLive || COMPLETED`; state поднят до полного списка, pendingAwards — derive.
- **Winners**: опциональный className-проп; сцены проп не передают — регресса нет.
- **Пустые/ошибки**: .console-empty-note (muted); ошибки панелей console-error-banner console-panel-alert; overflow-wrap anywhere на именах/дорожках консоли.
- Кнопки: «Вручить» btn-primary, «Разыграть»/«+ Добавить приз»/«Разыграть участника» btn-secondary, «Отозвать» btn-quiet; .console-mini для малых строк-кнопок.
- Гейты: web 166/166 (+3), lint, typecheck, build.

### Отклонения (disclosed)
1. Итоговое табло COMPLETED по finalEntries-образцу (standings из payload game.finished, fallback quiz.totals, gain 0), НЕ trackEntries с lastRoundGains — консистентно с quiz-controls:145-147 («прирост — атрибут reveal-момента») и finish-мокапом. **Флаг.**
2. Подзаголовок «участников: N» вместо мокапного «N участников» (нет plural-helper, форма грамотна при любом N).
3. «Разыграны» при quantityTotal > 1 (мокап — только ед. ч.).
4. Тексты пустых состояний репозиторные, не мокапные (бриф предписывал стили, не тексты).
5. AwardsPanel показывает сырой prizeId (названий на контуре нет, listPrizes не дублирован). **Флаг.**
- Smoke: T11 не трогает селекторы smoke.spec; но smoke УЖЕ расходится с консолью после T9/T10 (heading «Консоль ведущего», «Код комнаты:», .room-code strong) — pre-existing, починка T13.

## Таск-ревью (sonnet) — CLEAN

- Объём ровно 6 файлов; гейты свежие 166/166, lint, typecheck.
- Флаг 1: подтверждён — сборка идентична quiz-controls.tsx:149-163; finish-мокап дельт не показывает; раскол не усугубляется (норма установлена T9; выравнивание консоль/сцены — отложенный кандидат T13).
- Флаг 2: приемлемый обход плюрализации, согласован с carry «не размножать формы»; текст дизайн-дока форму не фиксирует. Не находка.
- Флаг 3: pre-existing ограничение данных (норма задокументирована winners.tsx:14-16 ещё с functional-minimum); Minor cosmetic, не fix-волна.
- Флаг 4: грамотное расширение; замена disabled-кнопки статусом безопасна (isDrawable = quantity > 0 единственный гард).
- Флаг 5: pre-existing подтверждён git-историей (smoke.spec не тронут с c577c8e, разметка ушла в T9 3efda3d); дифф T11 селекторов не касается.
- TDD: 3 теста с зубами (реальный drawCompletedPayload.parse strictObject; пустой лог, призовой/безпризовой, «последний в порядке лога» в обоих порядках). Minor-наблюдение (не находка): derive drawPrizeName инлайн, отдельно не покрыт (тривиальный find ?? null).
- Winners/сцены без регресса; кнопки по п. 15; CSS только токены, ландшафт-правило не тронуто.
