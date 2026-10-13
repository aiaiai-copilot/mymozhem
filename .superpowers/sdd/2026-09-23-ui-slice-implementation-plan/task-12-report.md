# Task 12 report: /screen — проектор

## What was implemented

**`apps/web/src/pages/screen/screen-page.tsx`** (new) — проекторный экран по дизайну §4/§8:
- Автоматический spectator-join по коду из `:code` (`displayName: 'Экран'`, `role: 'spectator'`) — одноразовый effect с ref-защитой от StrictMode-дубля (паттерн play-page).
- `anonClient` с null-TokenProvider для join/refresh (ruling 1) — как в play-page.
- `SessionStore` используется только как in-memory TokenProvider; `saveGuest` НЕ вызывается (ruling 2): play-страница хранит гостя под тем же ключом localStorage, spectator-сессия не должна его затирать. Перезагрузка проектора = новый join. Причина пояснена комментарием.
- До join (roomId===null) ConnectionBanner не рендерится (ruling 3) — нейтральное «Подключаем экран…» или ошибка join с UX-маппингом как в play (ROOM_JOIN_DENIED → «проверьте код», ROOM_PARTICIPANT_LIMIT_REACHED → «нет мест», RATE_LIMITED → «подождите», неизвестный → «обновите страницу», сетевая — «проверьте соединение»).
- Ростер: listMembers на subscribe + рефетч по shouldRefetchRoster (ruling 4) — как в play-page.
- Views (read-only, без форм/кнопок/publish):
  - finished/COMPLETED → итоговое `<Standings>` (места из game.finished, fallback — totals) + `<Winners>`;
  - CANCELLED / не ACTIVE → сообщения ожидания;
  - вопрос открыт → текст вопроса КРУПНО (`.screen-question`) + варианты списком без кнопок;
  - reveal → «Правильный ответ: …» (только из payload question.revealed; correctAnswers структурно недоступны) + `<Standings>`;
  - закрыт без reveal → «ждём результатов»; ACTIVE без вопроса → «ждём вопрос» + `<Winners>` (лотерейная комната).

**`apps/web/src/App.tsx`** — placeholder `/screen/:code` заменён на `<ScreenPage>` (ruling 5).

**`apps/web/src/styles.css`** — минимальные проекторные стили: `.screen-question` (clamp 2–4rem), `.screen-options` (крупный кегль, без маркеров).

## Verification (worktree .worktrees/ui-slice)

- `pnpm --filter @mymozhem/web typecheck` → зелёный (tsc --noEmit, без вывода ошибок).
- `pnpm --filter @mymozhem/web build` → зелёный (`✓ built in 95ms`; chunk-size warning — предсуществующий, не от этой задачи).
- `pnpm --filter @mymozhem/web lint` → зелёный (eslint src, чисто).
- `pnpm --filter @mymozhem/web test` → зелёный: 7 файлов, 41 тест passed (без новых тестов — регрессий нет).
- `pnpm boundary-check` (depcruise apps+packages) → зелёный: 0 violations (680 modules).

## Files changed

- `apps/web/src/pages/screen/screen-page.tsx` (new, 218 строк)
- `apps/web/src/App.tsx` (route)
- `apps/web/src/styles.css` (проекторные классы)

## Commit

- `fa030a9` — `feat(web): проекторный экран /screen (spectator-join, read-only)`

## Self-review findings

- Все 5 controller-rulings учтены (пронумерованы в коде комментариями).
- Смена `:code` без перезагрузки не перезапускает join (одноразовый ref) — сознательно как в play-page (autoJoinStarted); для проектора перезагрузка = новый join, приемлемо.
- Reveal-view без распарсенных questions показывает только табло (correctOption undefined → без заголовка) — graceful degradation, не ошибка.
- Дублирование roster/reveal-логики с play-page осознанно: извлечение общего хука — расширение объёма сверх брифа (functional-minimum); кандидат на рефактор при появлении третьего потребителя (host-консоль в батче D).

## Concerns

- Нет. Серверный вопрос «применяется ли ROOM_PARTICIPANT_LIMIT_REACHED к spectator» — вне клиентского среза; код замаплен на всякий случай.
