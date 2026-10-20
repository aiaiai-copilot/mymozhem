# Task 12 report (имплементер sonnet) + таск-ревью (sonnet) — CLEAN

## Имплементер — коммит `ddcf869` (6 файлов: roster-refetch.ts, roster-refetch.spec.ts, use-room-feed.ts, play-page.tsx, screen-page.tsx, members-panel.spec.ts)

- ROSTER_REFETCH_EVENTS += 'core.member.joined'; `createRosterEventRefetcher` — композиция над createFocusRefetcher (логика min-interval не дублируется); header обновлён (REQ-SEC-009, дизайн §9).
- Спек: true-кейс member.joined; 3 теста дедупа без DOM (два join в окне → 1; после окна → снова; общий не per-type: revealed+joined → 1); негатив (событие вне списка → 0).
- Wiring во всех трёх потребителях: use-room-feed (useMemo над стабильным refetchMembers), play/screen (новый useCallback refetchRoster + useMemo). Subscribe-загрузка и focus-refetch по поведению не тронуты.
- Комментарии «join не эмитит событий» переписаны во всех 5 местах + members-panel.spec.ts:13 (заодно, отмечено).
- RED: 4 падения (shouldRefetchRoster false + createRosterEventRefetcher is not a function ×3), 157 passed. GREEN: 163 passed, lint/typecheck чисто.

### Флаги
1. Чужие незакоммиченные правки T10 в дереве во время сессии — НЕ закоммичены (коммит ровно 6 файлов). Счётчик 163 = 157 + 4 T12 + 2 T10.
2. Первый вызов после монтирования проходит всегда (last = -Infinity) — snapshot-рефетч сохранён.
3. Дедуп общий на вызывающего — reveal сразу после join не даёт второго рефетча в пределах 2 с (осознанно, бриф).

## Таск-ревью (sonnet) — CLEAN

- Соответствие брифу/плану подтверждено построчно (roster-refetch.ts:9,26-30; use-room-feed.ts:63-71; play-page.tsx:156-169; screen-page.tsx:137-150).
- Флаг 2: семантически приемлемо — join-рефетч в t=0 уже дал свежий ростер; остаточный риск (провалившийся join-рефетч не ретраится на reveal < 2 с) — best-effort по принятой дисциплине, закомментировано.
- Rules-of-hooks проверены руками: безусловность, стабильные deps, фабрика не пересоздаётся каждый рендер; смена roomId честно сбрасывает окно.
- REQ-SEC-009: payload не читается вообще (только last.type); wire-схема strictObject({identityId: uuid}).
- Тесты с зубами (граница окна t=1000→2000→3500, toHaveBeenCalledTimes).
- Гейты свежие: web 163/163, lint, typecheck.
- **Замечание (pre-existing, не находка):** событийный рефетч без stale-гарда (в отличие от subscribe-загрузки) — гонка существовала до коммита, не расширена; кандидат «при касании».
