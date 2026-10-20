# Task 11 brief (батч D, сессия 51) — консоль: розыгрыш, awards, завершение, пустые/ошибки

Модель: sonnet. Диспатч ПОСЛЕ T10 (общий console.css).

- План Task 11 (~:238–252) + дизайн §5.3 (Розыгрыш/Завершение/Пустые), п. 10–11, 14–15, 18.
- Мокапы (read-only, каталог 33682-1792424164): console-draw-winner-larger.html (ключевой — draw + finish + текстовое описание), console-landscape-editor-draw-finish.html, console-empty-long-errors-v2.html.
- Файлы: prizes-panel.tsx, awards-panel.tsx, winners.tsx, console-page.tsx (COMPLETED-ветка); стили — новая секция в конце console.css, только токены (литералы мокапа — по прецеденту с комментарием).

**Розыгрыш:** баннер победителя ВНУТРИ карточки призов: «Розыгрыш завершён» + имя 36px var(--font-display) (крупнейший элемент) + «выигрывает „<приз>“» (безпризовой — без названия). Данные: последний lottery.draw.completed из events (payload — drawCompletedPayload.parse на границе, прецедент lastRoundGains), имя — displayNameOf(names, winnerId) (новый проп names), название приза — из локального prizes (fallback без строки). Разыгранный приз (quantity 0) — тихий статус «Разыграна» вместо disabled-кнопки. Формы/кнопки — .btn-классы, тихие без рамок (п. 15).

**Завершение (COMPLETED):** полный экран вместо строки-примечания: hero «Событие завершено» + подзаголовок («вручите награды» ТОЛЬКО при pendingAwards > 0 — п. 18); первой секцией AwardsPanel (без наград — без блока); «Итоговое табло» RaceTracks console (топ-4 + toggle по образцу quiz-controls); «Вернуться к началу — новое событие» (clearHostRoom + navigate(HOST_NEW_PATH)); QuizControls/приглашения/members/prizes/Winners не рендерить; CANCELLED не трогать; эффект наград расширить на COMPLETED (stale-guard, rewardsEventCount сохранить). REQ-RWD-009.

**Winners:** стилизация консоли БЕЗ регресса сцен (play/screen — обёртки .play-winners/.screen-winners не трогать).

**Пустые/длинные/ошибки:** пустые состояния панелей по мокапу; overflow-wrap для длинных имён; ошибки панелей — единый стиль с console-error-banner; ландшафт-правило не сломать.

- Среда: без install/npx; гейты web test|lint|typecheck|build; база 163/163; существующие спеки не ломать; grep smoke.spec — что задето, зафиксировать (починка — T13).
- Коммит: `feat(web): консоль — розыгрыш (победитель 36px), awards, завершение, пустые/ошибки` + Co-Authored-By.
