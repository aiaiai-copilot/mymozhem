# Task 12 brief (батч D, сессия 51) — live-ростер по member.joined

Модель: sonnet. Диспатч параллельно с T10.

- План Task 12 (~:254–268) + дизайн §9 + Review Focus 3 (join-шторм, дедуп min 2 с).
- Контекст: SDK 2.1.0 `core.member.joined` (public, payload {identityId}, REQ-SEC-009) коммитится ядром в join (гость и spectator), едет live и в snapshot/replay (лишний рефетч безвреден, I-8). Рефетч — существующий GET /rooms/:id/members.
- TDD строго (RED зафиксировать).
- Файлы: state/roster-refetch.ts + .spec.ts, state/use-room-feed.ts; комментарии+wiring play-page.tsx (~:134), screen-page.tsx (~:115); заодно members-panel.spec.ts:13 (тот же класс устаревшего комментария).
- `ROSTER_REFETCH_EVENTS += 'core.member.joined'`; header-комментарии обновить (join теперь эмитит; focus-refetch остаётся независимым триггером — дизайн §9).
- Дедуп: чистая фабрика `createRosterEventRefetcher(refetch, minIntervalMs=2000, now=Date.now)` КОМПОЗИЦИЕЙ над createFocusRefetcher (не дублировать логику). Тесты без DOM по прецеденту focus-refetch.spec: два join в окне → 1 вызов; после окна → снова; дедуп общий не per-type (revealed + joined в одном окне → 1 вызов).
- **Wiring дедупа во всех трёх потребителях** shouldRefetchRoster (use-room-feed, play, screen) — интерпретация контроллера: join-шторм бьёт по всем контурам, play/screen и так трогаются ради комментариев; отметить в отчёте для таск-ревью. Стабильный инстанс — useCallback/useMemo (rules-of-hooks руками, гейта нет). Subscribe-загрузка и focus-refetch по поведению не трогать.
- Коммит: `feat(web): live-ростер по core.member.joined (дедуп 2 с), устаревшие комментарии убраны` + Co-Authored-By.
