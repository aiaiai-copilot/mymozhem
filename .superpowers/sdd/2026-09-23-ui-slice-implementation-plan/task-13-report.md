# Task 13 — отчёт исполнителя

Лендинг, OAuth-гейт организатора, создание комнаты, setup (редактор квиза / настройки лотереи).

## Что построено

| Файл | Содержимое |
|---|---|
| `apps/web/src/pages/landing.tsx` | Лендинг: «Я организатор» → `<a href={'/auth/google?redirect=' + encodeURIComponent('/host')}>` (полная перезагрузка, backend владеет /auth); «У меня есть код» → ввод → `navigate('/play/<code>')` (кнопка disabled на пустом коде). |
| `apps/web/src/pages/host/host-session.ts` | Module-level `hostSession` (SessionStore) + `hostClient` (ApiClient поверх него) — один экземпляр на host-флоу: gate ставит токен после refresh, setup/console расходуют его. Паттерн anonClient — как в play-page. Комментарий объясняет, почему это не нарушение REQ-CORE-004 (состояние области /host в браузере, не процесса сервера). |
| `apps/web/src/pages/host/host-gate.tsx` | `useEffect` (одноразовый через ref — refresh-токен ротируется, StrictMode-дубль опасен) → `hostSession.refresh()` → claims `kind === 'REGISTERED'` иначе `navigate('/')` → `loadHostRoomId()` ? `/host/console` : `/host/new`. Ошибка refresh → `navigate('/')`. Все навигации `replace: true`. |
| `apps/web/src/pages/host/setup-page.tsx` | Без access-токена → возврат на `/host` (прямая перезагрузка /host/new). Комната: сохранённый `loadHostRoomId()` переиспользуется, иначе `createRoom(client, { joinPolicy: 'guests' })` → `saveHostRoomId` (ref-страж против StrictMode-дубля createRoom). Выбор приложения quiz|lottery; quiz → `<QuizEditor>`; lottery → радио `drawEligibility` (дефолт guests_allowed), settings шлётся явно выбранным значением через `lotterySettingsSchema.parse`. Submit → `configureRoom` → `activateRoom` → `/host/console`. Маппинг ошибок по реальным кодам ядра (REQUEST_INVALID / ROOM_TRANSITION_INVALID / ACTOR_NOT_ORGANIZER), неизвестный код показывается честно. |
| `apps/web/src/pages/host/quiz-editor.tsx` | `buildQuizSettings(form: QuizFormState): unknown` — чистая функция (trim, строки→числа, `correctAnswers` из `correctIndex` радио); валидации в ней нет — её делает `quizSettingsSchema` у вызывающего (та же схема, что серверная). Компонент: вопросы (текст, 2–6 вариантов, радио «правильный», add/remove вопроса и варианта с коррекцией correctIndex при удалении), scoring base/step, minAnswerIntervalMs; submit → `safeParse` → onSubmit(settings) или человекочитаемая ошибка. |
| `apps/web/src/App.tsx` | `/` → LandingPage, `/host` → HostGate, `/host/new` → SetupPage, `/host/console` → `<p>tbd</p>` (Task 14), `/play`, `/screen` — без изменений. |
| `apps/web/src/pages/host/quiz-editor.spec.ts` | 4 теста buildQuizSettings (ниже). |

## TDD-доказательства

1. **Red**: тест написан до реализации, прогон — 1 failed / 7 passed (модуль `./quiz-editor` не существует).
2. **Green** после `quiz-editor.tsx`: `pnpm --filter @mymozhem/web test` → **8 files, 53 tests passed** (было 49; +4 новых):
   - maps form rows to quiz settings (correctAnswers из отмеченных радио)
   - trim текстов и вариантов перед сборкой
   - reject пустого текста/варианта (quizSettingsSchema.safeParse fail)
   - reject: один вариант, нецелый/неположительный scoring, нечисловой ввод (NaN/дробь)
3. **Остальные гейты** (из корня worktree):
   - `pnpm --filter @mymozhem/web typecheck` — чисто.
   - `pnpm --filter @mymozhem/web build` — built in 89ms (warning о chunk >500 kB — существующий, не от этой задачи).
   - `pnpm --filter @mymozhem/web lint` — чисто.
   - `pnpm boundary-check` — no dependency violations (686 modules).
   - `pnpm guardrails` — All guardrails verified alive.

## Коммит

`df16c3a feat(web): лендинг, OAuth-гейт организатора, setup комнаты (редактор квиза / лотерея)` — 7 файлов, +596/−4.

## Отклонения от брифа

- **Лотерея шлёт `{ drawEligibility }` явно**, а не `{}` для дефолта: семантически эквивалентно (дефолт схемы guests_allowed), но прозрачнее и проходит через тот же `lotterySettingsSchema.parse`. Бриф допускал оба варианта («settings {} или { drawEligibility }»).
- **Setup без токена редиректит на `/host`**, а не падает с 401: бриф флоу прямого захода на /host/new не описывал; выбран безопасный вариант (гейт сделает refresh и вернёт).
- Верхняя граница вариантов (6) — UX-рамка редактора, не из схемы (схема задаёт только min 2); зафиксировано комментарием в коде.

## Саморевью

- Порядок хуков: во всех четырёх компонентах хуки безусловны и идут до любых ранних return (SetupPage: два useEffect/useRef/все useState — до `if (roomError)` / `if (!roomId)`).
- Новых зависимостей нет; react 18.3.1 / react-router-dom 6.30.6 не тронуты.
- apps/web импортирует только @mymozhem/sdk и @mymozhem/app-* — boundary-check подтверждает.
- Все доступные решения — на сервере: decodeAccessClaims используется только для маршрутизации (комментарий в host-gate).
- Ошибки UI показывают только безопасные коды/тексты (REQ-SEC-006 по духу).

## Замечания для Task 14

- Потребляет `hostSession`/`hostClient` из `pages/host/host-session.ts` и `SessionStore.loadHostRoomId()` — токен и roomId уже будут на месте после gate/setup.
- `/host/console` в App.tsx — placeholder `<p>tbd</p>`, Task 14 заменяет его сам.
