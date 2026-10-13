# Task 11 report: /play — участник + shared-компоненты

**Status:** DONE
**Commit:** 924b319 `feat(web): страница участника /play + shared-компоненты (standings/winners/banner)`

## What was implemented

По брифу (Steps 1–5) с учётом controller rulings 1–3:

- **`apps/web/src/components/roster-names.ts`** — `rosterNames(members): Map<identityId, string>` (null → «Гость», swept-гость) + helper `displayNameOf(names, id)` (fallback для актора, которого ещё нет в ростере — рефетч отстаёт от события; используется standings/winners).
- **`apps/web/src/components/standings.tsx`** — `<Standings names totals? standings? />`: таблица место/имя/очки; финальный `standings` (места из payload `game.finished`) имеет приоритет, промежуточный `totals` сортируется desc на клиенте (плотный ранг не нужен — отображение).
- **`apps/web/src/components/winners.tsx`** — `<Winners draws names />` из `LotteryState['draws']`; названий призов на клиенте нет (listPrizes — контур консоли), показываем prizeId.
- **`apps/web/src/components/connection-banner.tsx`** — `<ConnectionBanner state />`: null при `live`, «Подключение…»/«Нет соединения. Переподключаемся…» иначе.
- **`apps/web/src/pages/play/join-form.tsx`** — код (read-only при `:code` в URL) + displayName → `joinRoom` (auth:false, anonClient) → `session.setAccessToken` → `saveGuest` → `onJoined(roomId из decodeAccessClaims)`. UX-маппинг кодов: ROOM_JOIN_DENIED/ROOM_PARTICIPANT_LIMIT_REACHED/RATE_LIMITED, default — текст кода.
- **`apps/web/src/pages/play/play-page.tsx`** — каркас брифа целиком:
  - **Ruling 1:** module-level `anonClient` (TokenProvider → null) с поясняющим комментарием.
  - Авто-вход (дизайн §5): silent refresh → та же identity; TTL протух → повторный join = новая identity + баннер «вы вошли заново, очки не переносятся» (dismissible); авто-вход только если URL-код совпадает с сохранённым; при невалидном сохранённом — clearGuest + форма с ошибкой. StrictMode-страховка ref'ом (двойной join = вторая identity).
  - **Ruling 2:** ConnectionBanner рендерится только в ветке roomId !== null.
  - **Ruling 3:** roster — `listMembers` (SessionStore-backed ApiClient) на subscribe (по roomId) и по событиям `shouldRefetchRoster`; best-effort catch.
  - Ветки дизайна §4: лобби (DRAFT/не ACTIVE), вопрос (options из публичной проекции appSettings — парсится только `questions`, полная `quizSettingsSchema` клиенту структурно недоступна из-за correctAnswers, REQ-CORE-008), publish `quiz.answer.submitted` с локальным ack «Ответ принят» (сброс на смену вопроса) + текст кода при ApiError; reveal (верно/неверно из correctIndex публичного payload, очки из `awarded`, правильный ответ текстом, табло); «ответы закрыты, ждём»; финал (standings из `game.finished` + totals fallback + Winners); CANCELLED; ACTIVE-без-вопроса (+Winners для лотерейной комнаты).
- **`apps/web/src/App.tsx`** — маршрут `/play/:code?` → `<PlayPage />`.

## TDD evidence

- **RED:** `pnpm --filter @mymozhem/web exec vitest run src/components/roster-names.spec.ts` → `Test Files 1 failed (1)`, resolve failure на `./roster-names` (реализации ещё нет — ожидаемо).
- **GREEN:** та же команда после `roster-names.ts` → `Tests 3 passed (3)`.
- Покрытие: маппинг identityId→displayName, null→«Гость», пустой ростер.

## Verification

- `pnpm --filter @mymozhem/web test` — 7 files, 41 tests passed.
- `pnpm --filter @mymozhem/web typecheck` — чисто.
- `pnpm --filter @mymozhem/web lint` — чисто (поймал и убрал eslint-disable на несуществующее правило react-hooks/exhaustive-deps — плагин не сконфигурирован).
- `pnpm --filter @mymozhem/web build` — успех (chunk-size warning >500 kB — известное, не из этой задачи).
- `pnpm boundary-check` — no dependency violations (679 modules); `pnpm guardrails` — все probes живы.

## Self-review findings (diff прочитан целиком)

- Все файлы брифа созданы, маршрут подключён, все ветки §4 + rulings закрыты; correctAnswers нигде не запрашиваются и не отображаются (reveal — только публичный payload).
- Стиль — functional-minimum, комментарии по-русски (почему), новых зависимостей нет.
- Минор (принято, не блокер): `useState` в JoinForm инициализирует код из `:code` один раз — SPA-навигация с `/play/A` на `/play/B` без перезагрузки не обновит поле; для MVP сценарий экзотичен (вход по ссылке = полная загрузка).
- Минор: `Winners` показывает prizeId вместо названия приза — на клиенте участника нет listPrizes; осознанный минимум, зафиксировано комментарием.

## Concerns

Нет блокирующих. Два минора выше — к ревью контроллера на усмотрение.
