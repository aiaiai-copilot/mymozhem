### Task 17: Smoke-чеклист первого события + exit-аудит среза

**Files:**
- Create: `docs/sessions/2026-09-23-ui-slice-smoke-checklist.md`
- Create: `docs/sessions/2026-09-23-ui-slice-exit-audit.md`
- Modify: `HANDOFF.md` (навык handoff)

- [ ] **Step 1: Чеклист** — ручной прогон перед событием: OAuth с реальными Google-кредами (действие владельца — шаги), create→editor→configure→activate, два телефона-участника, экран, обрыв Wi-Fi у участника (перефолд), приз+розыгрыш+fulfill/revoke, завершение; каждая строка — наблюдаемый результат.
- [ ] **Step 2: Exit-аудит** — сверка критериев §8 дизайна (1–7) с артефактами файл:строка; протокол конвейера; открытые вопросы владельцу, если вскрылись.
- [ ] **Step 3: HANDOFF** — навык handoff; мердж/push — решение владельца.
- [ ] **Step 4: Commit** — `docs(sessions): smoke-чеклист + exit-аудит UI-среза`

---

## Self-review

**1. Spec coverage:** §0 решения — 1: объём (Tasks 11–15) ✓; 2: гости-only (Task 11, JoinController не тронут) ✓; 3: same-origin (Task 6) ✓; 4: функц. минимум (все страницы) ✓; 5: форма редактора (Task 13) ✓; 6: экран (Task 12) ✓; 7: подход A временный (Tasks 7–10 слои без React вне хуков) ✓; 8: Playwright (Task 16) ✓; 9: lifecycle-контур (Task 5) ✓; 10: ростер (Tasks 4–5) ✓. Pre-tasks P1/P2 — Tasks 1–2 ✓. §8 критерии — Task 17 сверка ✓. `GET /rooms/:id/prizes` — Task 5 ✓.

**2. Placeholder scan:** каркас play-page в Task 11 — намеренно скелет с явным перечнем веток (React-разметка по дизайну §4, не «TBD»); остальные кодовые блоки полные.

**3. Type consistency:** `ApiClient.call`, `TokenProvider`, `SocketLike`, `RoomConnection`, `LogStore`, `projectQuiz/projectLottery/deriveRoomStatus/shouldRefetchRoster`, `SessionStore`, `rosterNames`, `buildQuizSettings`, `answersCount` — имена/сигнатуры согласованы между задачами (Interfaces-блоки).

**4. Review Focus:** все 5 строк имеют тесты в названных задачах (1→Task 10, 2→Task 9, 3→Task 9, 4→Task 7, 5→Task 6).

**Известные интерпретации (зафиксированы для ревью владельцем):**
- **I-1:** `recordedAt` клиентской проекции — момент приёма события (wire его не несёт); влияет только на отображение, не на баллы.
- **I-2:** повторный join гостя после протухшей сессии создаёт новую identity (очки не переносятся) — принято в дизайне §5.
- **I-3:** ростер рефетчится событийно (reveal/finish/draw.completed) + на subscribe; join не виден мгновенно — Review Focus 2.
- **I-4:** organizer-флоу Playwright обходит Google OAuth seed-скриптом (выдача refresh вне Google) — OAuth smoke остаётся ручным действием владельца (Task 17 чеклист).
- **I-5:** console рисует lottery-панель по пину комнаты (одна комната = одно приложение, ф.3).
