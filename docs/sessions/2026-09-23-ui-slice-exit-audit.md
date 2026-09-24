# Сверка критериев выхода UI-среза (web-клиент первого события)

**Дата:** 2026-09-24
**Тип:** сверка при закрытии среза (код среза — ветка `ui-slice`, 23 коммита, 88 файлов, +6455/−89; HEAD на момент аудита — `7ad6ef2`)
**Основание:** дизайн `2026-09-23-ui-slice-design.md` (утверждён владельцем; §8 — критерии приёмки, §0 — решения владельца) + план `.superpowers/sdd/2026-09-23-ui-slice-implementation-plan/` (17 задач, исполнены батчами 1–5 + Task 16; Task 17 — настоящий аудит).
**Метод:** финревью батчей 1–5 (каждое: Stage 1 spec-compliance → Stage 2 quality, fix-волны `e5caa45`, `2a33aae`+`d71022c`, `e4484c6` — re-review чистые) + сверка критериев §8 с артефактами файл:строка. Протокол конвейера — из отчёта Task 16 (`.superpowers/sdd/2026-09-23-ui-slice-implementation-plan/task-16-report.md`), новых прогонов в рамках аудита не выполнялось (задача документационная).

---

## 1. Критерии приёмки (design §8)

| # | Критерий (design §8) | Вердикт | Покрытие (файл:строка) |
|---|---|---|---|
| 1 | Первое событие целиком через UI: create → editor → configure/activate → ведение → призы → розыгрыш → fulfill/revoke → завершение; ни одного ручного REST-вызова | 🟡 **частично верифицировано, ожидает manual smoke OAuth** | По артефактам и Playwright-смоуку верифицирована вся цепочка, достижимая без реального Google: setup/редактор (`apps/web/src/pages/host/setup-page.tsx`, `quiz-editor.tsx`), консоль ведения (`quiz-controls.tsx`), участники/призы/розыгрыш/вручение (`members-panel.tsx`, `prizes-panel.tsx:138-154`), страницы участника и экрана (`play-page.tsx`, `screen-page.tsx`); happy-path end-to-end — `apps/web/e2e/smoke.spec.ts:54-139` (host → play → screen, reveal-вердикт, финал). **Недостижимая без владельца часть:** полный круг OAuth с реальными Google-кредами (smoke проверяет только 302-шов, `smoke.spec.ts:55-64`; organizer-флоу обходит Google seed-скриптом — интерпретация I-4). Критерий считается закрытым только после строки 1 чеклиста `2026-09-23-ui-slice-smoke-checklist.md`; аудит финализируется ПОСЛЕ него |
| 2 | Участник с телефона: join по ссылке → ответы → табло; обрыв виден и самолечится перефолдом без потери состояния | ✅ | join/ответы/табло: `apps/web/src/pages/play/play-page.tsx` + smoke шаги 2/5/6 (`smoke.spec.ts:97-131`). Обрыв: индикатор `components/connection-banner.tsx:7` (подключён `play-page.tsx:306`); самолечение — reconnect → re-subscribe → свежий snapshot (`realtime/room-connection.ts:18-19,37`) + буфер/перефолд без потери событий (`state/log-store.ts:3-24`); unit — `room-connection.spec.ts`, `log-store.spec.ts`. Сам обрыв на живом устройстве — строка 6.1 чеклиста (ручной уровень, не CI) |
| 3 | Проекторный экран: spectator-view вопрос/табло/итоги без интерактива и без auth-контура | ✅ | `apps/web/src/pages/screen/screen-page.tsx` (spectator-join по коду, read-only); публичная проекция appSettings (`screen-page.tsx:126,195`); smoke шаги 3/4 (`smoke.spec.ts:106-117`) — spectator видит вопрос и финал без форм |
| 4 | `correctAnswers` недоступны ни на одном клиенте (структурно; наследует чит-тест ф.2) | ✅ | Источник инварианта серверный, срез его не ослаблял: `packages/app-quiz/src/quiz-settings.ts:4` (correctAnswers без аннотации → fail-safe module-private, REQ-CORE-008); чит-тест ф.2 жив и зелёный: `apps/server/test/quiz.e2e-spec.ts:325-382` (ни один фрейм/snapshot/replay/ack не несёт correctAnswers, организатор включительно). Клиентский слой структурно не запрашивает и не получает их: комментарии-контракты `quiz-controls.tsx:51`, `screen-page.tsx:126` (проекции строятся только из public-части лога) |
| 5 | Backend-контуры среза: lifecycle/configure по HTTP (organizer-only) и ростер (любому члену; swept-гость displayName=null; лог id-only, REQ-SEC-009) | ✅ | lifecycle: `packages/core/src/transport/rooms-lifecycle.controller.ts:21,29,43,49,55` (configure/activate/complete/cancel, organizer-гейт в сервисе). Ростер: `packages/core/src/transport/members.controller.ts:18-29` (`GET /rooms/:id/members`, `assertMember`, роли lowercase, displayName nullable); swept-гость с null-именем — `packages/core/src/membership/membership.service.int-spec.ts:329-353`. Лог остаётся id-only — PII-ассерты ф.2/ф.3 не тронуты (`quiz-points.e2e-spec.ts`, `lottery.e2e`) |
| 6 | Pre-tasks P1/P2: configure `{}` с defaulted полем принимается (SDK 1.7.0); свипнутый гость вне drawPool | ✅ | P1: `packages/sdk/src/manifest/define-app.ts:102-109` (`z.toJSONSchema` в `io: 'input'`), версия `packages/sdk/package.json:3` = 1.7.0; контрактный тест `define-app.contract.spec.ts:125` (defaulted ключ необязателен в артефакте). P2: фильтр `identity: { deletedAt: null }` — `packages/core/src/membership/membership.service.ts:180-182`; тест `membership.service.int-spec.ts:290-302` |
| 7 | Конвейер зелёный: существующие гейты + web build/lint/typecheck/unit + Playwright smoke + новые boundary-правила с живыми probe'ами | ✅ | Протокол — §2. Boundary: правила `.dependency-cruiser.cjs:19-36` (web→sdk/app-*, no-cross-app, socket.io-client только в `src/realtime`); probe'ы 6–8 `scripts/verify-guardrails.mjs:64-84`. Playwright smoke + CI job `e2e-web`: `.github/workflows/ci.yml:43-87`, `apps/web/e2e/smoke.spec.ts`, `apps/web/e2e/playwright.config.ts:18` (baseURL зашит, не из env — e2e не уйдёт на прод) |

## 2. Протокол конвейера (HEAD среза, по отчёту Task 16 — локальный стенд compose; CI-формы команд — `.github/workflows/ci.yml`)

| Гейт | Команда | Результат |
|---|---|---|
| build | `pnpm run build` | 6/6 successful (web включён: `apps/web/package.json:8`, turbo-таска) |
| typecheck | `pnpm run typecheck` | 10/10 |
| lint | `pnpm run lint` | 6/6 |
| unit | `pnpm run test` | 10/10 пакетов; **web 69/69** — без деградации соседних пакетов |
| int | `pnpm run test:int` | 5/5 |
| boundary-check | `pnpm run boundary-check` | 0 violations (700 модулей) |
| guardrails | `pnpm run guardrails` | все probe'ы живы (вкл. 3 новых web-probe'а) |
| Playwright smoke | `pnpm --filter @mymozhem/web test:e2e` против `docker compose up -d --build` | 5/5 прогонов зелёные (холодный + 3 детерминизма + путь CI с `E2E_REFRESH_TOKEN`) |
| CI job e2e-web | `.github/workflows/ci.yml:43-87` (после `build`) | сконфигурирован: compose-стенд → health-ожидание → seed → smoke → down -v (always); fix `7ad6ef2` (playwright-бинарь через `--filter`) |

## 3. Санкционированные отклонения и интерпретации среза

1. **Интерпретации плана I-1…I-5** (зафиксированы в Self-review плана, подтверждены владельцем): `recordedAt` клиентской проекции — момент приёма; повторный join гостя после протухшей сессии — новая identity без переноса очков; ростер рефетчится событийно + на subscribe (join мгновенно не виден — `apps/web/src/state/roster-refetch.ts:1-4`, `use-room-feed.ts:60-62`); organizer-флоу Playwright обходит Google seed-скриптом (`apps/server/scripts/e2e-web-seed.mjs`); console рисует lottery-панель по пину комнаты (одна комната = одно приложение).
2. **Рулинги финревью батчей:** пин react 18 / react-router 6 (батч 1); fix-волна батча 4 (`2a33aae`: reveal-вердикт из публичного `answer.accepted`, refresh токена при reconnect; `d71022c`: порядок хуков play-page); fix-волна батча 5 (`e4484c6`: OAuth redirect — absolute URL из `window.location.origin` (`landing.tsx:31-38`), фолбэки консоли); fix `7ad6ef2` (CI e2e-web: playwright install через `--filter @mymozhem/web`).
3. **Duplicate-acceptance на клиенте** — принятый риск дизайна §9 (wire без id/seq, REQ-RT-011a); самолечение переподключением; закрытие — seq/cursor, ф.4.

## 4. Открытые вопросы владельцу (не гейтят закрытие среза)

1. **Manual smoke OAuth — действие владельца (блокер критерия 1):** прогнать строку 1 чеклиста (реальные Google-креды: OAuth client + redirect URI `http://<origin>/auth/google/callback`, тройка env all-or-none, allowlist §0.1). Аудит финализируется после него.
2. **LAN по plain HTTP и розыгрыш:** `crypto.randomUUID()` недоступен вне secure context — на `http://<ip>` кнопка «Разыграть» честно отказывает (`prizes-panel.tsx:30-49`). Если первое событие планируется по LAN по plain HTTP, нужно решение владельца ДО события: TLS-терминатор/hostname с сертификатом, либо иной санкционированный источник drawId (текущий констрейнт — только `crypto.randomUUID()`, фолбэк сознательно не заведён).
3. **Протухшая гостевая сессия на живом событии:** повторный join = новая identity, очки не переносятся (I-2, дизайн §5). Продуктово принято для MVP; если сценарий «участник вернулся через сутки за призом» реален — требование на перенос identity отдельным срезом.
4. **e2e/*.ts вне typecheck** (web tsconfig включает только `src`; осознанно — см. concerns отчёта Task 16): при желании строгости — отдельный `tsconfig.e2e.json`, кандидат-задел.

## 5. Вердикт

**UI-срез исполнен; критерии 2–7 закрыты артефактами и зелёным конвейером; критерий 1 верифицирован в части, достижимой без реального Google (вся UI-цепочка + Playwright happy-path), и помечен как ожидающий manual smoke OAuth — действия владельца по строке 1 чеклиста.** Срез НЕ считается полностью принятым до прогона строки 1; настоящий аудит подлежит финализации (снятие 🟡 по критерию 1) сразу после него — изменения кода для этого не требуются, только фиксация результата чеклиста.

**Гейты над срезом не изменились:** юрист (до реальных PII/призов) и первое живое событие — действия вне агента. Мердж `ui-slice` в `main` и push на origin — отдельное решение владельца.
