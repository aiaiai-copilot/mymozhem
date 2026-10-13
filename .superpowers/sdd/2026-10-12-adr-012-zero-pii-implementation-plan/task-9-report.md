# Task 9 report: Web + ops + docs (ADR-012 zero-PII, батч C)

## Что реализовано

- **Endpoints (T9 шаг 1):** `bootstrapOrganizer(c, input)` → `POST /auth/organizer` (auth:false, `tokenResponseSchema`); `joinRoom` перешёл на `joinResponseSchema` / `JoinResponse` (фактический displayName в ответе).
- **Вход организатора (шаг 2):** новая страница `host-login-page.tsx` по скетчу брифа (контролируемая форма, busy-гард, `role="alert"`, токен только в state формы); `anonClient` экспортирован из `host-session.ts` (ruling C-pre.2 — второй клиент не создан); `landing.tsx` — router-Link «Войти по токену организатора» вместо OAuth-ссылки; `App.tsx` += route `/host/login`.
- **Join-form (шаг 3):** имя необязательно — извлечён чистый хелпер `buildJoinRequest` (пустое имя → body без ключа `displayName`); сохраняется `res.displayName`; label «Ваше имя (необязательно)», placeholder «Получите псевдоним, если пусто». Хелпер вынесен потому, что vitest в apps/web — node-environment без DOM-тестирования; паттерн совпадает с prizes-panel (чистые функции + spec).
- **Лотерея v2 в UI (шаг 4):** `setup-page.tsx` — удалены state `drawEligibility` и оба radio, `lotterySettingsSchema.parse({})`; `winners.tsx` — `prizeId === null` → строка без «приз …»; `prizes-panel.tsx` — `DrawAttempt.prizeId: string | null`, новые `startParticipantDrawAttempt`/`tryStartParticipantDrawAttempt` (тот же pending-гард + перехват броска генератора), кнопка «Разыграть участника» (publish `{drawId}` без prizeId) в lottery-комнате, статичное предупреждение о юр. ответственности, `panelErrorText` += `PRIZES_DISABLED` → «Призовой режим выключен на этом сервере.». Призовой publish шлёт ключ `prizeId` только при наличии (null на wire недопустим — `drawRunPayload: uuid optional`).
- **Smoke (шаг 5):** `smoke.spec.ts` — шаг 0 (OAuth 302 probe) и seed-флоу удалены; вход организатора через UI: лендинг → ссылка → `/host/login` → fill password → «Войти» → `waitForURL('**/host/new')`; токен из env `ORGANIZER_SETUP_TOKEN` (fail-fast, если не задан). `apps/server/scripts/e2e-web-seed.mjs` удалён.
- **Ops/docs (шаг 6):** `docker-compose.yml` — OAuth-блок заменён на `ORGANIZER_SETUP_TOKEN` (:?) + `PRIZE_MODE` (:-off); `ci.yml` — seed-шаг удалён, `ORGANIZER_SETUP_TOKEN` добавлен в job-level env e2e-джоба (ruling C-pre.4); чеклист — §0.1 (setup-токен стенда, curl-probe), §1 (вход по setup-токену + негатив), §0.2/§0.3 сохранены (в §0.2 слово «OAuth-логин» → «вход организатора» — фактическая правка), §8.1 «без повторного OAuth-логина» → «без повторного ввода setup-токена», протокол-таблица обновлена; README += quickstart-абзац.

## UX-маппинги (глобальный констрейнт)

- `ORGANIZER_SETUP_INVALID` → «Неверный токен организатора.» — в `host-login-page.tsx` (inline, по скетчу брифа): единственное место, где код структурно возможен (POST /auth/organizer). В `joinErrorText` join-form/screen-page и `submitErrorText` setup-page не добавлялся: join/configure/activate этот код вернуть не могут — мёртвый маппинг.
- `PRIZES_DISABLED` → «Призовой режим выключен на этом сервере.» — в `panelErrorText` (prizes-panel): createPrize (REST) и draw.run с prizeId (publish ack) приезжают сюда. Оба текста — дословно из брифа.

## Прогоны (шаг 7)

- `pnpm --filter @mymozhem/web test` — **75/75 PASS** (11 файлов; += join-form.spec.ts, prizes-panel.spec.ts +4 кейса, api-client.spec.ts обновлён до 15 обёрток).
- `pnpm --filter @mymozhem/web build` / `typecheck` / `lint` — PASS (chunk-size warning — прежний, неблокирующий).
- Compose-стенд: `JWT_SECRET=… ORGANIZER_SETUP_TOKEN='local-smoke-setup-token-…' docker compose up -d --build` — LIVE; curl-probe `POST /auth/organizer` → **200 + `Set-Cookie: mm_refresh`**.
- Playwright: `ORGANIZER_SETUP_TOKEN='local-smoke-setup-token-…' pnpm --filter @mymozhem/web test:e2e` — **1 passed** (host → play → screen полный сценарий: bootstrap через UI → setup квиза → join участника → вопрос/ответ/reveal → финал). Прогон строго против локального compose-стенда (baseURL зашит).
- Стенд погашен: `docker compose down -v`.
- Полные гейты: `pnpm build` (6/6) · `boundary-check` (no violations, 725 modules) · `guardrails` (all alive) · `lint` · `typecheck` · `pnpm test` (10/10) — **все зелёные**.

## Files changed

- Modify: `apps/web/src/api/endpoints.ts`, `apps/web/src/api/api-client.spec.ts`, `apps/web/src/App.tsx`, `apps/web/src/pages/landing.tsx`, `apps/web/src/pages/host/host-session.ts`, `apps/web/src/pages/host/setup-page.tsx`, `apps/web/src/pages/host/prizes-panel.tsx`, `apps/web/src/pages/host/prizes-panel.spec.ts`, `apps/web/src/pages/play/join-form.tsx`, `apps/web/src/components/winners.tsx`, `apps/web/e2e/smoke.spec.ts`, `docker-compose.yml`, `.github/workflows/ci.yml`, `docs/sessions/2026-09-23-ui-slice-smoke-checklist.md`, `README.md`
- Create: `apps/web/src/pages/host/host-login-page.tsx`, `apps/web/src/pages/play/join-form.spec.ts`
- Delete: `apps/server/scripts/e2e-web-seed.mjs`

## Self-review findings

- Скетчи брифа (шаги 1–4) воспроизведены; единственное отступление — `buildJoinRequest` вынесен в экспортируемый хелпер ради тестируемого кейса «пустое имя → body без displayName» (node-env vitest, DOM-тестов в пакете нет). Семантика submit идентична скетчу.
- Тесты проверяют поведение: маппинг 15 обёрток на пути/схемы/auth, тела join/bootstrap, дисциплина drawId (pending-гард, бросок генератора) для обоих видов розыгрыша, отсутствие ключа displayName при пустом имени (`not.toHaveProperty`).
- `runDraw` шлёт `prizeId` условным спредом — null не уходит на wire (zod strict+uuid отклонил бы).
- YAGNI: новых клиентов/сторов не создано (ruling C-pre.2), фолбэк-генератор drawId не заводился, host-gate не тронут (ruling контроллера).

## Issues / concerns

1. **`host-gate.tsx` комментарий устарел** («OAuth-гейт … /auth/google возвращает сюда») — файл заморожен ruling'ом контроллера («host-gate.tsx не меняется»), править не стал; кандидат на точечную правку комментария отдельно.
2. **Чеклист §9 (приз/розыгрыш/fulfill/revoke) предполагает включённый призовой режим** — при дефолтном `PRIZE_MODE=off` ручной прогон §9.1 получит `PRIZES_DISABLED`. В бриф §9 не входил; владельцу стоит решить: пометить §9 «требует PRIZE_MODE=on» при следующей ревизии чеклиста.
3. Протокол-строки старого OAuth-прогона (✅ 2026-09-24) заменены новыми пунктами — историческая запись сохранена ссылкой на git-историю в шапке документа.

---

## Fix round 1 (финальное целобатчевое ревью)

**Что изменено (doc-only, `docs/sessions/2026-09-23-ui-slice-smoke-checklist.md`):**

- **Important #1 (§9):** добавлена пометка в шапку §9 — строки 9.1–9.4 прогоняются при `PRIZE_MODE=on`; при дефолте (`off`) 9.1–9.2 непроходимы (`PRIZES_DISABLED` → «Призовой режим выключен на этом сервере.»), вместо них прогоняется новая строка **9.5 «Разыграть участника»** (победитель без приза — строка без «приз …», prizeId null; остатки не меняются; контроль гейта — попытка создать приз), 9.3–9.4 без приза пропускаются. Протокол-таблица: строка 9.1–9.4 помечена «при `PRIZE_MODE=on`», добавлена строка 9.5.
- **Minor #2 (§0.3):** line-refs `prizes-panel.tsx:30-31` → `:31-32` (актуальное положение `DRAW_ID_GENERATION_FAILED` после правок батча); заодно формулировки кнопки приведены к дефолту («Разыграть участника», «Разыграть» — при `PRIZE_MODE=on`).
- **Оппортунистически (та же находка, соседняя строка):** §8.1 — пример команды «создать приз» при дефолте давал бы `PRIZES_DISABLED` и не упражнял 401→refresh; пример заменён на «Закрыть вопрос». Шапка «Ревизия ADR-012» дополнена упоминанием §9.

**Самопроверка согласованности чеклиста:** §9 перечитан целиком — нумерация 9.1–9.5 последовательна, шапка §9 корректно разводит режимы (on → 9.1–9.4, off → 9.5 + пропуск 9.3–9.4); перекрёстная ссылка §0.3 → «строка 9» валидна для обоих режимов; протокол-таблица покрывает обе ветки (9.1–9.4 и 9.5); тексты ошибок дословно совпадают с UX-маппингом `panelErrorText` («Призовой режим выключен на этом сервере.») и константой `DRAW_ID_GENERATION_FAILED`; line-ref `:31-32` сверен с текущим `prizes-panel.tsx`. Doc-only — прогоны не требовались.
