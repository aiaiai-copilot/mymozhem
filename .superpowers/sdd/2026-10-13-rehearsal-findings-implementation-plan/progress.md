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

---

Батч C (задачи T6–T8), сессия 41. Тот же worktree `.worktrees/rehearsal-fixes-a`, ветка `rehearsal-fixes` (HEAD батча B = `718f93a`). Леджер общий на пакет — дописывается.
Spec: тот же дизайн (§6 рефетч, §7 стейл-roomId, §3+§8.2 LAN-автоматика) — читал контроллер; REQ-разметка §10.

Baseline (до T6): web lint PASS; web typecheck PASS; web 14 suites / 92 tests PASS. Worktree setup батчей A/B действует.

## Pre-flight scan (перед T6)

| Пара/задача | Что производит → что потребляет | Находка |
|---|---|---|
| T3/T4 → T6 | `SessionStore.clearHostRoom()` (session.ts:102) и `binding.joinError` (use-room-binding.ts:29,96) → потребители T6 | На месте. console-page.tsx:96-103 — комментарий «Все хуки выше» + ветка `if (!roomId)` verbatim как в плане (roomGone-ветка сразу после); roomId — useState initial-only (:32), joinError переходит null→код однократно (условие леджера батча B, снятое досрочно финревьюм) — эффект T6 сработает ровно раз. useEffect/useState импортированы (:1) |
| T7 внутри | members-panel.tsx exclude (:41-49) — verbatim цель замены; excludeErrorText (:10), excludingId/setError/disabled/onChanged — на месте; `listMembers` экспортирован (endpoints.ts:70); type-only импорт RosterEntry уже есть (:2) | Согласовано. Плановое тело exclude структурно совпадает с существующим (guard/finally идентичны — замена касается только оркестрации) |
| T7 → use-room-feed | `refetchMembers` — useCallback, стабилен (:32-39) → deps [roomId, refetchMembers] фокус-эффекта корректны; место вставки — после событийного эффекта (:58-62) | Согласовано. Тестируется чистая фабрика (node-environment vitest, DOM не нужен); wiring — typecheck/lint + ручная приёмка 11.1 (I-3-паттерн) |
| T8 внутри | vite.config.ts include (:17) — verbatim цель; playwright.config.ts БЕЗ testMatch сейчас (добавляется в оба конфига); e2e/ содержит ровно smoke.spec.ts + playwright.config.ts; checklist §0.3 кончается :33, §1 начинается :35 — блок 0.4 после 0.3; таблица протокола с :153 | Согласовано. Суффикс .vitest.spec.ts + testMatch 'smoke.spec.ts' устраняют пересечение vitest/playwright двумя ходами, как в плане |
| T6–T8 vs Global Constraints | тест первым в каждой задаче; wire/SDK не тронуты; новых зависимостей нет; vitest include правит только T8 (санкционировано планом) | Соблюдено планом |

Ruling: конфликтов план↔план и план↔код не найдено; скан чист.
Ride-along кандидаты (refresh-cookie pin, RF5-усиление) НЕ берутся: задачи батча C не касаются refresh-cookie.spec.ts / room-connection.spec.ts — нет естественного касания файлов. Остаются кандидатами владельцу.

## Ход исполнения (батч C)
Task 6: complete (commits 718f93a..9091d01, review clean — spec ✅, quality approved, findings нет, ⚠️ нет; санкционированное отклонение: += Co-Authored-By строка в коммите, раскрыто в отчёте).
Task 7: complete (commits 9091d01..c04af02, review clean — spec ✅, quality approved; санкционированное отклонение: мок-параметры `_roomId`/`_identityId` опущены из-за eslint no-unused-vars без argsIgnorePattern — покрытие неизменно, ревьюер подтвердил).
Task 7: minor (deferred): моки не захватывают аргументы — wrong-id форвардинг тестом не ловится (унаследовано от брифа; кандидат на усиление, не запрошено).
Task 8: complete (commits c04af02..9d2ad16, review clean — spec ✅, quality approved; оба concern'а разрешены ревьюером: порядок protocol-before-host соответствует запинанному брифом юнит-спеку (нарратив шага 4 брифа внутренне противоречив — отказ fail-closed в любом случае); dummy ORGANIZER_SETUP_TOKEN для --list — pre-existing top-level throw smoke.spec.ts:7-10, диффом не внесён).
Task 8: minor (deferred): маркер 'URL' в кейсе 'not-a-url' слабый — каждое сообщение функции начинается с 'LAN_BASE_URL' (содержит подстроку URL), ветка parse-ошибки специфически не ассертится (унаследовано verbatim от брифа).
Task 8: minor (deferred, косметика): строка протокола 0.4 добавлена в конец таблицы (после 12.1–12.2), не в числовую позицию — бриф пинил текст, не позицию.

## Финальное целобранчевое ревью пакета (fable, range 346d275..9d2ad16, 10 коммитов)

Вердикт: **Ready to merge — Yes**. Стадия 1 (spec-compliance по §10): все 9 строк ✅ с артефактами файл:строка; все 6 находок закрыты способом дизайна (№2/№4/№5/№6/№3 код+пин, №7 регламент). Стадия 2: Critical нет, Important 1 процессный (консолидация леджера батча C — исполняется этим коммитом), Minor новых нет.
Эмпирика ревьюера: web 18/111 PASS, core 21/230 PASS, server lint/typecheck PASS, guardrails 10/10, boundary 0 нарушений (742 modules), XFF e2e 4/4 живьём (testcontainers), compose-дефолт COOKIE_SECURE=auto подтверждён, LAN fail-closed подтверждён обоими --list.
Сквозной сценарий refresh→onSessionDead→rejoin→rebind прослежен ревьюером: петля стерильна (refreshAttempted/conn + rejoinInFlight/страница + терминальные fail-пути), Review Focus 1 закрыт промежуточным setRoomId(null), обратная совместимость 2/3-аргументных вызовов сохранена.
Триаж deferred-миноров: все 14 stay-deferred (A: 4, B: 7, C: 3 — обоснования в вердикте ревьюера). Ride-along кандидаты владельцу (вне объёма пакета): пин полного набора атрибутов refresh-куки (REQ-ID-008); усиление RF5-негативного теста resolving-хуком (room-connection.spec.ts:317-331).
Финревью: Important (процесс) — вложенный .superpowers/sdd/.gitignore (*) снова создан sdd-скриптами и игнорирует артефакты батча C → снят, леджер коммитится (прецедент 1cfbcce/718f93a, решение владельца 329a942).

## Батч D (приёмочные находки 2026-10-14): Tasks 9–10 — сессия 2026-10-14

Происхождение: ручная приёмка пакета 2026-10-14 (сырой протокол `docs/sessions/2026-10-14-acceptance-raw-notes.md`, коммит 53ff10f): строки 0.4/7.1/11.1/12.2 ✅, находки A (404-ссылка T6 — чинить до мерджа) и №8 (WebKit reconnect — решение владельца: чинить в этом же пакете). Дизайн — bounded brainstorm в чате, одобрен владельцем. Мелочи: оговорка §0.4 — внесена; дубли в ростере — оставлены записью в протоколе (без действий).

Task 9: complete (commit 9b36613). routes.ts — HOST_NEW_PATH единый источник (роутер + ссылка), пин-спека wire-значения. RED: module not found → GREEN.
Task 10: complete (commit c10bcb4 + fix-волна cf3cefc). SocketLike += isConnected/kickReconnect (`io._close()` + `connect()`), RoomConnection.wakeUp (гард joined && !connected), wiring useRoomBinding (visibilitychange/focus/pageshow через createFocusRefetcher-дедуп). RED: `conn.wakeUp is not a function` ×3 → GREEN.

Таск-ревью (sonnet, 53ff10f..c10bcb4): вердикт needs-fix (узкий объём). Critical нет.
- **Important #1 (принят, fix-волна cf3cefc):** первичная модель №8 («WebKit выбрасывает backoff-таймер») опровергнута исходниками 4.8.3 для наблюдавшегося пути: CONNECT_ERROR терминален (Socket.destroy → Manager._close(skipReconnect=true)) — retry не планируется никогда, ни в одном браузере; ветка «refresh успешен» не имела триггера повтора (foreground-обрыв на границе TTL → вечный баннер без сна вкладки). Фикс: `.then(() => kickReconnect())` после успешного refresh (официальный паттерн), пин kickCount===0 на провале refresh; комментарии обоих файлов переписаны под фактический механизм (оба застрявших состояния). Модель заморозки таймера остаётся верной для транспортного обрыва — wakeUp-кик её покрывает.
- Minor #2 (принят, cf3cefc): '/host/new' имел третьего литерального потребителя (host-gate-flow.ts) + '/host/console' три потребителя — переведены на константы routes.ts, HostGateTarget типизирован от констант; '/' осознанно литералом (корень не 404-able). Пин HOST_CONSOLE_PATH в routes.spec (RED: missing export → GREEN).
- Minor #3 (принят, cf3cefc): FakeSocket держит инвариант connected сам (triggerConnect/triggerDisconnect); wakeUp-тесты ставят поле вручную сознательно (triggerConnect после join дёргал бы re-subscribe без ack — комментарий в фейке).

Эмпирика после fix-волны: web 19 файлов/117 тестов PASS (+2: кик после refresh, пин HOST_CONSOLE_PATH), lint/typecheck web PASS, boundary 0/744, guardrails alive. Таск-ревьюер независимо прогнал: vitest 115/115 (до fix-волны), eslint, tsc, depcruise — зелёные.

Формализация (commit aff840d + правка аддендума fix-волной): таблица протокола чеклиста — 0.4/7.1/11.1/12.2 ✅ (комментарии из сырого протокола, прежние ❌ сохранены историей), новая строка 8.2 (WebKit-регресс №8, ⬜ до повторной приёмки на Safari/iOS), оговорка §0.4 п.8 (не исключать localhost-участников на bare-run), аддендум плана — батч D.

Опыт сессии: (1) таск-ревью со сверкой по исходникам node_modules опровергло правдоподобную, но неверную модель дефекта (замороженный таймер) и нашло residual-дыру в «прежнем пути» refresh — ревью ДО мерджа снова окупилось; (2) официальный паттерн socket.io (ручной connect() из connect_error после обновления auth) — канон, которому код теперь следует; (3) CONNECT_ERROR-teardown объясняет задним числом и «Chrome не пострадал»: его reconnect'ы просто не пересекали TTL (transport-drop path с skipReconnect=false работает везде на переднем плане).

Осталось до мерджа: ручной прогон строки 8.2 владельцем (Safari/iOS сон > TTL → reconnect без reload) + финальное ревью пакета батча D → мердж no-ff по ритуалу.
