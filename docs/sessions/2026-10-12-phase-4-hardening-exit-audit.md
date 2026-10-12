# Exit-аудит: фаза 4 — харднинг-срез (C-8.1, метрики, логи REQ-OPS-004, фиксация REQ-SEC-008)

**Date:** 2026-10-12 (батч D, Task 10 плана)
**Ветка:** `phase-4-hardening` @ `a64a425` (15 коммитов от `a114453`: батч A — 5, батч B — 5, батч C — 5), запушена на origin целиком.
**Входы:** дизайн `2026-09-24-phase-4-hardening-design.md` (§7 — критерии, §0/амендмент — решения владельца), план `2026-09-24-phase-4-hardening-implementation-plan.md` (Task 10), леджер `.superpowers/sdd/2026-09-24-phase-4-hardening-implementation-plan/progress.md`, owner-ноты финревью батча C.

---

## 1. Сверка критериев §7 дизайна

### Критерий 1: `/metrics` отдаёт 4 метрики REQ-OPS-004; gauge активных соединений сходится с реальностью в e2e — ✅

- 4 метрики: `mymozhem_publish_to_deliver_seconds`, `mymozhem_replay_duration_seconds`, `mymozhem_event_commit_errors_total`, `mymozhem_active_connections` — `packages/core/src/observability/metrics.service.ts:13,21,29,36`.
- `GET /metrics` — 200, text format, присутствие всех 4 — `packages/core/src/observability/observability.int-spec.ts:58`; открытость (без авторизации, дизайн §0.3) — там же `:70`.
- Gauge сходится с реальностью в e2e (подключение → серия `=1`, disconnect → серия исчезает poll-циклом): `apps/server/test/realtime.e2e-spec.ts:274–316`.
- Приёмка Task 9: метрики на проводе через реальный bootstrap — `apps/server/test/bootstrap.e2e-spec.ts` + e2e-ассерты инкрементов (shared app, кумулятивные гистограммы — ruling батча C).

### Критерий 2: гонка свипа C-8.1 воспроизводится тестом и закрыта rollback'ом; award по swept-identity → `IDENTITY_ANONYMIZED`, фонд не тратится — ✅

- Re-check откатывает свип (award, закоммиченный между гард-чеком и коммитом): `packages/core/src/identity/guest-sweep.int-spec.ts:247` (describe «окно гонки C-8.1»), сценарий `:338`; warn-лог отката — `guest-sweep.service.ts:89`.
- Award-гарда с **блокирующим чтением** (амендмент 2026-09-25, решение владельца): `SELECT "deletedAt" … FOR NO KEY UPDATE` в той же tx до INSERT — `packages/core/src/rewards/rewards.service.ts:74–84`; отказ типизированный `IDENTITY_ANONYMIZED` (SDK 1.8.0, HTTP 409).
- Сценарии: award по анонимизированному гостю отклонён, фонд и таблица не тронуты — `packages/core/src/rewards/rewards.int-spec.ts:106–115`; **гонка с реальной блокировкой** («свип» держит `FOR NO KEY UPDATE` на identity — гард ждёт его коммита и отклоняет award, фонд цел) — `:131–185`.
- Комментарии о lock-режимах приведены к амендированному механизму (FK-проверка `FOR KEY SHARE` в механизме не участвует) — `guest-sweep.service.ts:34–41`, `rewards.service.ts:74–83` (fix-волна амендмента C-8.1, батч A).

### Критерий 3: логи — JSON с корреляцией requestId (все запросы) и roomId/actorId (операционные точки §2); `authorization`/`cookie` redacted (тест) — ✅ с двумя зафиксированными трактовками

- requestId (uuid) в каждой строке запроса + отражение в `x-request-id`: `packages/core/src/observability/pino-options.spec.ts:57,67` (unit), `observability.int-spec.ts:75–89` (строка лога — JSON, `req.id === x-request-id`), прод-цепочка через реальный `dist/main.js` — `apps/server/test/bootstrap.e2e-spec.ts:48,79,95`.
- redact `authorization`/`cookie` (+ `set-cookie` ответа — fix C-1 финревью батча C): `pino-options.spec.ts:12`; эмпирический негативный контроль — scoped re-review fix-волны (без пути утекает, с путём — `[redacted]`).
- Query (OAuth `code`/`state`) срезан из url и не логируется (fix I-1): `pino-options.spec.ts:24`; кастомный `serializers.req` — `pino-logger.module.ts:72–86`.
- Query (OAuth `state`/`code_challenge`) срезан из `res.headers.location` на 302 authorize (fix финревью батча D, коммит `6f0775a`): `pino-options.spec.ts` (тест «query (state/code_challenge) срезан из res.headers.location»); кастомный `serializers.res` — `pino-logger.module.ts` (зеркало req-фикса).
- Корреляция socketId/actorId/roomId в операционных точках, payload не логируется: `packages/core/src/realtime/realtime.gateway.spec.ts:212–217` (+ тесты 'subscribed' строго после ack; 5 мигрированных точек — filter, guest-sweep, sweep-scheduler, membership, gateway).
- LOG_LEVEL в конфиге: `packages/core/src/config/config.schema.ts` (Task 7), уровень из конфига — `pino-options.spec.ts:8`.

**Трактовка (i) — «все запросы»** (minor M-1 финревью батча C, зафиксировано как норма прочтения): «все запросы» = все запросы **после cors-хука в Nest/fastify-пайплайне**. Два структурных исключения: socket.io-трафик минует pino-http (дизайн §2 — realtime имеет собственные логи с socketId-корреляцией); CORS-preflight short-circuit — механика `@fastify/cors` (OPTIONS обслуживается плагином до request-id/лог-цепочки). Оба — не гэпы покрытия, а границы инструмента.

**Трактовка (ii) — плановое сужение §2** (зафиксировано как решение, не гэп): дизайн §2 допускал child-логеры в точках commit/join/oauth; план сознательно сузил объём до миграции **5 существующих `new Logger` + gateway**. Child-логеры в commit/join/oauth **не созданы**. Точки покрыты достаточно для MVP-диагностики (requestId в HTTP-логе + roomId/actorId/socketId в realtime/gateway); расширение — «миграция остальных consumers по потребности» (дизайн §8).

### Критерий 4: REQ-SEC-008 подтверждён существующими артефактами без нового кода — ✅

Срез кодом SEC-008 не трогал; фиксация по существующим артефактам:

- helmet подключён: `apps/server/src/main.ts:27` (`app.register(fastifyHelmet)`).
- CORS allowlist из конфига, пустой список = заголовки не выдаются: `apps/server/src/main.ts:28–30`; socket.io — тот же конфиг.
- Wildcard в production запрещён fail-closed на уровне конфига: `packages/core/src/config/config.schema.ts:79–85` (superRefine, `CORS wildcard is forbidden in production (REQ-SEC-008)`).
- e2e-ассерты: `apps/server/test/transport.e2e-spec.ts:245` (helmet: ответ join содержит security-заголовки), `:329` (describe CORS).
- Вводный коммит `55afe8f` («wire transport plugins and trustProxy, REQ-SEC-002/008») — ancestor of HEAD.

### Критерий 5: конвейер зелёный (boundary-check, контрактные тесты SDK, lint, type-check) — ✅

Свежий прогон в worktree на HEAD `a64a425` (2026-10-12), полный лог — `/tmp/batch-d-gates/`:

| Гейт | Результат |
|---|---|
| `pnpm build` | 0 |
| `pnpm boundary-check` (depcruise, вкл. probes) | 0 |
| `pnpm guardrails` (verify-guardrails, 10 probes с ассертом сигнала) | 0 |
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm test` (unit + контрактные SDK) | 0 |
| `pnpm test:int` (testcontainers) | 0 |

e2e-сьюты apps/server прогонялись зелёными в батчах B и C (включая bootstrap.e2e-spec прод-бутстрапа); в состав критерия 5 по дизайну не входят.

---

## 2. Материал финревью батча C — решения и фиксация (обязательный разбор Task 10)

1. **Трактовка «все запросы»** — зафиксирована в критерии 3 (трактовка i).
2. **Плановое сужение §2 (child-логеры не созданы)** — зафиксировано как решение в критерии 3 (трактовка ii).
3. **Room-коды в логируемых URL** (`/rooms/:code/join`) — **РЕШЕНИЕ ВЛАДЕЛЬЦА (2026-10-12): принято для MVP.** Обоснование: код полупубличен по дизайну (проецируется организатором на экран), короткоживущ (мёртв после терминации комнаты), логи локальны (одна реплика REQ-OPS-005, stdout на сервере, архивация REQ-RT-008 отложена; читатель логов имеет доступ и к БД, где коды открыты). **Триггер пересмотра:** задача REQ-RT-008 (архивация/отгрузка логов наружу) обязана включить маскирование комнатного кода в логах.
4. **Пин `pino@^9.14.0` в apps/server — load-bearing** для single-instance фикса батча C (`app.get(Logger)` резолвится по идентичности класса; два снапшота pino = падение прод-бутстрапа, невидимое для гейтов). Будущий бамп pino 10 двигать **в обоих пакетах вместе** (packages/observability-цепочка и apps/server). Страж класса дефекта: `apps/server/test/bootstrap.e2e-spec.ts`.
5. **Standing rules (pino-std-serializers v7):** (а) res-сериализатор логирует заголовки ответа по умолчанию — redact-ревью **в обе стороны** при любом новом sensitive-заголовке (req и res); машинные пины обеих сторон: redact `set-cookie` (`pino-options.spec.ts:12`), strip query из `res.headers.location` (тест батча D, `6f0775a`); (б) err-сериализатор копирует все enumerable props — типы логируемых ошибок держать чистыми от request/config.
6. **Финревью батча D (opus, целосрезовое):** фиделити аудита подтверждена, cross-batch композиция чистая, interleaving-матрица C-8.1 разобрана и признана закрытой. Один Important — утечка OAuth `state` через `res.headers.location` на 302 — **исправлен fix-волной батча D** (Ruling D-10.3, коммит `6f0775a`, тест RED→GREEN, build/typecheck/core unit/observability int-spec зелёные). Вердикт после фикса: ready to merge.

---

## 3. Отложенное (зафиксировано)

- **REQ-RT-008 (архивация логов)** — отложен решением владельца (дизайн §0.1) в нагрузочную часть ф.4; при исполнении — включить маскирование room-кодов (§2 п.3).
- **Нагрузочная часть ф.4** (REQ-RT-014/015, REQ-ID-019, REQ-RT-011б, REQ-ID-012, REQ-ID-018, нагрузочный тест, лимиты режимов) — после первого живого события (разрез сессии 15; событие измеряет нагрузочный профиль).
- **REQ-OPS-006 (бэкап-регламент)** — после юриста/реальных PII (разрез сессии 15).
- **Миграция остальных consumers на структурные логи** сверх операционных точек §2 — по потребности (дизайн §8).

---

## 4. Deferred-миноры среза (триаж — все stay-deferred, must-fix ни одного)

Батч A: восстановить 2 lost-rationale комментария при следующем касании `guest-sweep.service.ts` (прецедент отзыва сессий, rationale `deletedAt: null` в updateMany.where); contract-version фикстуры `>=1.x.0` стареют каждый минор (follow-up кандидат).
Батч B: prom-client@15.1.3 registry-deprecated (миграция на @prometheus-io/client/16.x — решение владельца); «ровно 4 метрики» по presence, не exclusivity; гипотетический re-add socketId с другим roomId (недостижим — gateway-гейт); `app.listen(0)` в observability.int-spec избыточен для inject; дублирование spec/int-spec суффиксов в 2 depcruise-правилах (правило трёх).
Батч C: структурный тип buildPinoHttpOptions вместо pino-http Options (дрейф на мажоре); root typecheck без int-спеков (кандидат: включить int-spec в typecheck-конфиг); e2e-stdout шумит per-request логами; у bootstrap-спека нет 'error'-слушателя на spawn; комментарий про remoteAddress (теряется в прод-цепочке — деградация наблюдаемости, не утечка); мягкий пин ветки `delete serialized.query` (url-вектор запинан жёстко); пин pino ^9 (load-bearing — §2 п.4).

---

## 5. Rulings батча D

- **Ruling D-10.1:** имя файла аудита — `2026-10-12-…` по фактической дате финальной сессии (плановый плейсхолдер `2026-09-2X` предполагал сентябрь; сессия состоялась 2026-10-12). Стоимость ошибки: косметическая сортировка имён в docs/sessions.
- **Ruling D-10.2:** документ аудита коммитится в ветку `phase-4-hardening` (часть среза, попадёт в main мерджем); обновление HANDOFF — отдельным коммитом в `main` по стоящей конвенции репозитория (handoff-коммиты между сессиями живут на main; плановый Step 4 объединял оба — разделено, чтобы main-HANDOFF не устаревал до мерджа). Стоимость ошибки: один cherry-pick/повторная правка HANDOFF.
- **Ruling D-10.3:** Important #1 финревью батча D (утечка OAuth `state` через `res.headers.location`) — в fix-волну без эскалации владельцу, по прецеденту Ruling C-F.1: фикс реализует принятую норму дизайна §2 «токены не логируем» и standing rule §2.5(а), не пересматривает её. Выбран вариант (а) ревьюера — кастомный `serializers.res` со strip query (консистентно с I-1, сохраняет диагностическую ценность origin+path). Стоимость ошибки (если утечка была приемлема): один сериализатор с тестом, обратимо.

---

## 6. Вывод

Все 5 критериев §7 подтверждены артефактами; материал финревью батча C разобран и зафиксирован (включая решение владельца по room-кодам); целосрезовое финревью батча D пройдено (вердикт With fixes → fix-волна `6f0775a` → ready to merge); отложенное и deferred-миноры протриажены. **Харднинг-срез фазы 4 закрыт.** Рекомендация: мердж `phase-4-hardening` → `main` (решение владельца). Дальше по траектории: первое живое событие (чеклист `2026-09-23-ui-slice-smoke-checklist.md`, строки 0.2–0.3, 2–12), затем нагрузочная часть ф.4. Гейт 1 (юрист) открыт.
