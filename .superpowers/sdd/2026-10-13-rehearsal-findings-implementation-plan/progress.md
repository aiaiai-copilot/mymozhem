# SDD ledger — plan: docs/sessions/2026-10-13-rehearsal-findings-implementation-plan.md

Батч A (задачи T1–T2), сессия 39. Worktree `.worktrees/rehearsal-fixes-a`, ветка `rehearsal-fixes-batch-a` от local main `346d275`.
Spec: `docs/sessions/2026-10-13-rehearsal-findings-design.md` (§0 решения владельца №2/№7, §2, §8.1) — читал контроллер; план аргументирует из неё.

Baseline (до T1): core 20 suites / 225 tests PASS; server typecheck PASS; bootstrap e2e 2/2 PASS (docker+testcontainers живы). Worktree setup: `pnpm install` → `pnpm build` (SDK dist) → `pnpm --filter @mymozhem/core prisma:generate` (postinstall выключен — известное поведение репо).

## Pre-flight scan (перед T1)

| Пара/задача | Что производит → что потребляет | Находка |
|---|---|---|
| T1 → T2 | T1 += `TEST_CONFIG.COOKIE_SECURE: 'auto'` → T2 конструирует сервисы с TEST_CONFIG | Аддитивно, конфликта нет; общих файлов нет (T1 — core+compose, T2 — только server test) |
| T1 внутри | создаёт refresh-cookie.spec.ts; правит config.schema.ts / refresh-cookie.ts / test-config.ts / config.schema.spec.ts / docker-compose.yml | Согласовано. FakeReply структурно совместим с ReplyLike (методная бивариантность). Вставка после блока TRUST_PROXY (config.schema.ts:48-52) — место существует. Плановый `base` внутри `it` затеняет файловый `base` config.schema.spec.ts — допустимо, стиль файла сохранить |
| T2 внутри | создаёт apps/server/test/xff-forwarded-for.e2e-spec.ts целиком | Конструкция сервисов = transport.e2e-spec.ts:119-141 (верифицировано: EventOutbox 3-arg, EventLogService 4-arg, MembershipService 5-arg с JoinRateLimiter(1000), TokenService 2-arg, seedIdentity {id, email}). Маршрут exclude — exclude.controller.ts:20. jest-env-setup даёт ORGANIZER_SETUP_TOKEN. TRUNCATE-список = transport.e2e:153 |
| T2 vs Global Constraints | прогон `-- xff-forwarded-for` — уникальное имя файла | Урок Quiz-среза (testPathPattern матчит путь, включая имя worktree `.worktrees/rehearsal-fixes-a`) соблюдён: ни 'rehearsal', ни 'xff' не матчат другие спеки |

Ruling: конфликтов план↔план и план↔код не найдено; скан чист.
Ruling: ветка переименована rehearsal-fixes-batch-a → rehearsal-fixes — ритуал репо: одна ветка на пакет, батчи копятся в ней, мердж no-ff после батча C (финальная приёмка плана). Цена ошибки: косметика имени, переименовать обратно — одна команда.
Ruling: вложенный `.superpowers/sdd/.gitignore` (`*`, создаётся скриптами навыка) снят — решение владельца 329a942: леджеры В git. Цена ошибки: scaffolding-файл снова появится при следующем прогоне sdd-скриптов — снимать при консолидации леджера.

## Ход исполнения

Task 1: minor (deferred): stray пробел в комментарии refresh-cookie.spec.ts:4 (« Secure-атрибут» — verbatim из плана).
Task 1: minor (deferred): test-local `base` в config.schema.spec.ts:60 затеняет файловый (plan-mandated, прецедент соответствия стилю).
Task 1: complete (commits 346d275..151dbf6, review clean — spec ✅, quality approved; ⚠️-пункты ревью закрыты контроллером: зелень полной core-сьюты 21/230 в отчёте покрывает cookie-потребителей, compose-дефолт `:-auto` подтверждён прогоном `docker compose config`).

Task 2: complete (commits 151dbf6..8dec889, review clean — spec ✅, quality approved; ruling I-1 подтверждён: сьют зелёный сразу, эмпирика XFF-цепочки записана фактом в комментарий (leftmost/client адрес — req.ip)).
Task 2: minor (deferred): `.sort()` на паре статусов лексикографический (корректно для 3-значных кодов; при смешанной длине понадобится компаратор).
Task 2: observation (deferred, кандидат владельцу): server `lint` покрывает только `src`, `test/` не линтуется — для этого диффа не важно (typecheck+jest гейтают), поднимать если хотим lint тестов как постоянный гейт.

## Финальное целобатчевое ревью (fable, range 346d275..8dec889)

Вердикт: **Ready to merge — Yes**. Critical/Important — нет. Spec-compliance по REQ-разметке подтверждён эмпирически ревьюером (полные core/server сьюты, compose-дефолт, boundary-check, guardrails). Невакуумность XFF-сьюта подтверждена статически (регрессия в shared-bucket красит конкретные ассерты).
Финревью: minor (deferred): refresh-cookie.spec — FakeReply сужает options до {secure}; атрибуты REQ-ID-008 (httpOnly/sameSite/path/maxAge) нигде не запинаны — кандидат ride-along при следующем касании файла (рекомендация: батч B/C).
Финревью: minor (deferred): имя теста xff :239 «fail-closed пин main.ts» преувеличивает — main.ts:21 сьюютом не покрывается (честно раскрыто в шапке файла); пин wiring — уровень bootstrap.e2e, отдельный кандидат владельцу.
Триаж deferred-миноров финревьюм: все 4 stay-deferred (пробел в комментарии; shadowing base; лексикографический sort; lint только src — кандидат владельцу как tooling-решение).

---

Батч B (задачи T3–T5), сессия 40. Тот же worktree `.worktrees/rehearsal-fixes-a`, ветка `rehearsal-fixes` (HEAD батча A = `1cfbcce`). Леджер общий на пакет — дописывается.
Spec: тот же дизайн (§4 single-flight, §5 автоперезаход, §7 joinError-подложка) — читал контроллер; Review Focus 1/2/5 — про T3–T5.

Baseline (до T3): web 12 suites / 82 tests PASS; web lint PASS; web typecheck PASS (worktree setup батча A действует).

## Pre-flight scan (перед T3)

| Пара/задача | Что производит → что потребляет | Находка |
|---|---|---|
| T3 → T5 | T3 правит session.ts (refresh single-flight + clearHostRoom); T5 читает из session.ts decodeAccessClaims/GuestSession/loadGuest/clearGuest — НЕ тронуты T3 | Конфликта нет; файлового пересечения нет (T5 создаёт guest-rejoin.*) |
| T4 → T5 | T4 производит `useRoomBinding(roomId, tokens, opts?)` + `joinError` и 4-й параметр RoomConnection `onSessionDead` → T5 единственный потребитель opts.onSessionDead | Последовательная зависимость, порядок T4→T5 обязателен; файлы не пересекаются (play/screen вызывают хук — компиляционная связь, typecheck-гейт T5 ловит) |
| T3 внутри | 4 новых кейса в session.spec.ts против inFlightRefresh + clearHostRoom в session.ts | Согласовано. Верифицировано по коду: constructor refreshFn (session.ts:36), HOST_ROOM_KEY/HOST_ROOM_CODE_KEY (:18/:24), refresh() (:47-49) — цель замены verbatim; describe('SessionStore') с 4 кейсами существует |
| T4 внутри | тесты onSessionDead против room-connection.ts; joinErrorCode против use-room-binding.ts | Согласовано. Гард `if (!this.joined || this.refreshAttempted || !this.refreshAccessToken) return;` (room-connection.ts:67) и заменяемый catch (:69) — verbatim как в плане. FakeSocket/programAck/SNAPSHOT/flushMicrotasks/triggerConnectError в спеке есть (:16/:25/:74/:71/:58); ConnectionState импортирован (:10). use-room-binding.ts:66 `.catch(() => setConnectionState('disconnected'))` — verbatim цель; deps [roomId, tokens] (:74) — план их сохраняет (I-2) |
| T5 внутри | guest-rejoin.* новые; play-page mount-effect catch → rejoin; screen-page joinStarted → joinInFlight + joinSpectator | Согласовано. play-page: autoJoinStarted :63, inline joinRoom catch :86-99, binding :106 — как описано; screen-page: joinStarted :59, effect :62-85, binding :87 — как описано. joinRoom(client, {code, displayName, role?}) — сигнатура подтверждена обоими потребителями |
| T3–T5 vs Global Constraints | тест первым; wire/SDK не тронуты; новых зависимостей нет; все спеки в src/** (vitest include) | Соблюдено планом; e2e-суффикс-ловушка T8 батча B не касается |

Ruling: конфликтов план↔план и план↔код не найдено; скан чист. Review Focus 1/2/5 покрыты шагами T5.4 / T3.1-кейс-3 / T4.1-кейс-2 соответственно.

## Ход исполнения (батч B)

Task 3: minor (deferred): тест single-flight полагается на неявную однократность присваивания resolveFn (форма дана планом; читается, не дефект).
Task 3: minor (deferred): теоретическое микро-окно — refresh() синхронно между resolve refreshFn и .finally поделит settle'нувшийся промис (результат корректен: токен уже присвоен).
Task 3: complete (commits 1cfbcce..972efed, review clean — spec ✅, quality approved; RED-форма честно зафиксирована: таймаут вместо calls===3, механика объяснена в отчёте).
Task 4: complete (commits 972efed..98d900c, review clean — spec ✅, quality approved; ⚠️-пункт ревью «потребители onSessionDead/joinError — T5/T6» закрыт контроллером: это структура плана, T5 исполняется следом в этом же батче).
Task 4: minor (deferred): setJoinError(null) стоит после guard `if (!roomId) return` — при roomId→null joinError стейл до следующего effect; практически безвредно (экран размонтирован), при T6 подтвердить, что потребитель гейтит по roomId.
Task 4: minor (deferred, plan-mandated): wiring joinError/opts внутри хука покрыт только typecheck (нет @testing-library/react — известный deferred T10 UI-среза); ручная приёмка — строка 12.2 чеклиста.
Task 5: complete (commits 98d900c..ad70448, review clean — spec ✅, quality approved; ⚠️-пункт «RED/гейты только в отчёте» закрывается эмпирикой финревью батча — прецедент батча A; санкционированное отклонение: типизация vi.fn generic'ом вместо verbatim-каста — TS2352, семантика теста неизменна, задокументировано в отчёте).
Task 5: minor (deferred, plan-mandated): вспышка JoinForm на один тик при onSessionDead (прямое следствие механики Review Focus 1) — приёмка строкой 12.2 чеклиста.
Task 5: minor (deferred): избыточный каст `as [string, RequestInit]` в guest-rejoin.spec.ts после типизации vi.fn — косметика.
Task 5: minor (deferred, plan-mandated): wiring onSessionDead→rejoin покрыт только typecheck (I-3, нет @testing-library/react) — приёмка 12.2.

## Финальное целобатчевое ревью батча B (fable, range 1cfbcce..ad70448)

Вердикт: **Ready to merge — Yes**. Critical/Important — нет. Сквозной сценарий refresh→onSessionDead→rejoin→rebind прослежен по коду (стерильность петель: refreshAttempted на экземпляр conn + rejoinInFlight на страницу + терминальный fail-путь); обратная совместимость (2/3-аргументные вызовы) и strict-ротация не задеты; арифметика тестов сходится (82→92, дельта ровно плановая). Эмпирика ревьюера: web lint/typecheck/test PASS (14/92), guardrails 10/10, boundary-check 0/735.
Финревью: minor (deferred): RF5-негативный тест конструирует conn БЕЗ refresh-хука; сильнее — хук есть (resolving), но пришёл только disconnect (room-connection.spec.ts:317-331). Не блокер: onSessionDead лексически существует только в .catch refresh'а. Кандидат при следующем касании файла.
Триаж deferred-миноров финревьюм: все 7 stay-deferred (2×T3, 2×T4, 3×T5). Условие леджера по T4-минору («при T6 подтвердить гейт по roomId») снято досрочно: console-page никогда не обнуляет roomId за жизнь страницы (useState initial-only, console-page.tsx:32) — joinError переходит null→код однократно.
Recommendations финревью (не гейтят): T6 — помнить однократность перехода joinError в консоли; строку 12.2 чеклиста прогнать с вниманием к вспышке JoinForm и баннеру «вы вошли заново» (единственное немашинное место батча).
Опыт сессии: watchdog-смертей субагентов не было; имплементеры haiku (T3/T4, транскрипция полного кода плана) и sonnet (T5, интеграция в хуки) — диспозиция моделей окупилась; таск-ревью sonnet, финревью fable — оба детальны.
