# Exit-аудит среза ADR-012 — zero-PII MVP

**Дата:** 2026-10-12 (сессия 35, финал батча C)
**Ветка:** `adr-012-zero-pii` (worktree `.worktrees/adr-012-zero-pii`)
**Диапазон среза:** `b5729c7..9891b65` — 12 коммитов в трёх батчах (A: b5729c7, 351d14a, 5743300, 9565e97; B: e2c4ffc, 0f16856, b9cf868, b05ba77; C: e0b65c8, 5e837c1, c577c8e, 9891b65)
**Вход:** `docs/adr/adr-012-zero-pii-mvp.md` (принят), `docs/sessions/2026-10-12-adr-012-zero-pii-design.md` (§0 — решения владельца), `docs/sessions/2026-10-12-adr-012-zero-pii-implementation-plan.md` (9 задач, батчи A–C)
**Леджер исполнения:** `.superpowers/sdd/2026-10-12-adr-012-zero-pii-implementation-plan/progress.md` (в worktree, не в git) — все rulings и триажи deferred-миноров.

Сверка по 6 критериям выхода §10 дизайна. Каждый критерий подтверждён артефактами файл:строка и тестовыми прогонами.

---

## §1. Сверка критериев выхода

### Критерий 1: Grep не находит oauth-следов в коде и конфиге; CI-гейты зелёные ✅

- **Grep** (`packages/core/src`, `packages/sdk/src`, `apps/server/src`, `apps/server/test`, `apps/web/src`, сессия 35 на `9891b65`): живых обращений нет — ни `packages/core/src/oauth` (удалён в `e2c4ffc`), ни `OAUTH_*`/`GOOGLE_*` ключей конфига (`config.schema.ts`), ни `mm_oauth_*` кук, ни oauth-эндпоинтов. Остатки — только исторические комментарии, санкционированные ruling'ами батчей A/B: `transport/authenticate.ts:5`, `transport/http-exception.filter.ts:87`, `auth/token.service.ts:37`, `testing/seed-identity.ts:5`, `realtime/realtime.gateway.ts:128`, `sdk/errors/error-codes.ts:16`, `apps/web/src/pages/landing.tsx:6`, `apps/web/src/pages/host/host-gate.tsx:6` (файл заморожен дизайном §9 — deferred).
- **CI-гейты на `9891b65`** (прогон сессии 35): `pnpm build` ✅ (6 пакетов), `pnpm boundary-check` ✅ (725 модулей, 2267 зависимостей, 0 нарушений), `pnpm guardrails` ✅ (10/10 probes живы), `pnpm lint` ✅, `pnpm typecheck` ✅, `pnpm test` (unit) ✅ — включая sdk 327+, app-lottery 39/39, app-quiz, core unit, web vitest 75/75.
- **int/e2e на `9891b65`** (прогон сессии 35): `pnpm --filter @mymozhem/core test:int` ✅ (23 suites, 220/220), `pnpm --filter @mymozhem/server test` ✅ (9 suites, 65/65; см. примечание о шуме ниже §3).
- **Playwright smoke** (T9, `c577c8e`): 1/1 против локального compose-стенда — bootstrap через UI → квиз полный круг.

### Критерий 2: Bootstrap — одна REGISTERED-identity, 401, 429, e2e ✅

- **Частичный уникальный индекс** «один живой REGISTERED»: миграция `packages/core/prisma/migrations/20261012202423_drop_identity_provider/migration.sql:8` — `CREATE UNIQUE INDEX "Identity_single_registered_key" ... WHERE kind='REGISTERED' AND "deletedAt" IS NULL`; автотест наличия — `packages/core/src/identity/organizer-schema.int-spec.ts` (REQ-DEV-006, SQL-миграция без preview `partialIndexes`).
- **Race:** `IdentityService.findOrCreateOrganizer()` (`identity.service.ts:32`) — findFirst → create вне `$transaction` → catch P2002 → re-read победителя; int-тест 5 параллельных bootstrap → ровно 1 REGISTERED (T5, `0f16856`).
- **Неверный токен → 401 `ORGANIZER_SETUP_INVALID`:** `transport/auth.controller.ts` (digest-compare sha256 + timingSafeEqual, длина не утекает); наружу ровно `{code}` (REQ-SEC-006); отказы warn-логируются фильтром (`http-exception.filter.ts:87` — security-сигнал брутфорса, фикс-волна `b05ba77`).
- **Лимитер → 429:** per-IP `ORGANIZER_BOOTSTRAP_RATE_LIMITER` срабатывает ДО проверки токена (нет оракула), e2e-кейс в `apps/server/test/organizer-bootstrap.e2e-spec.ts`.
- **e2e «setup-токен → создание комнаты»:** `organizer-bootstrap.e2e-spec.ts:135` — полный путь организатора без OAuth.

### Критерий 3: Серверный псевдоним гостя без имени ✅

- **Генератор:** `packages/core/src/membership/pseudonym.ts` — 50 русских существительных + число (5×«Слово-NN» 10–99 → 5×NNN 100–999 → детерминированный скан), `crypto.randomInt` (не Math.random — дух REQ-RWD-011), сигнатура с инжектированным rnd для детерминированных unit-тестов.
- **Точка подключения:** `MembershipService.join` — `displayName` необязателен; генерация ВНУТРИ `$transaction` с чтением активного ростера (null-имена swept-гостей фильтруются — освобождённые имена снова доступны); заданное имя — прежний путь с `displayNameSchema`-валидацией (свободный ввод сохранён).
- **Видимость:** join-ответ несёт фактический `displayName` (SDK 2.0.0 `joinResponseSchema`); ростер показывает псевдоним.
- **Пины:** unit генератора (детерминизм, retry при коллизии, расширение диапазона, исчерпание без хардкода словаря — ruling B-pre.2), int join без имени, 6 e2e-потребителей переведены на `joinResponseSchema` (T6, `b9cf868`). Уникальность — вероятностная (best-effort, §0.1 дизайна), зафиксировано как принятый UX-риск.

### Критерий 4: prize_mode=off → PRIZES_DISABLED; безпризовой draw; fulfill/revoke работают ✅

- **Гейты (решение §0.3):** `rewards.service.ts:78` (`awardPrize` — effect-путь) и `:128` (`createPrize`) — первая строка, до `findFirst` (интерпретация I-3: при off всегда `PRIZES_DISABLED`, не `PRIZE_UNKNOWN` — запинано RF3 e2e с произвольным uuid). `PrizesDisabledError extends ContractError` (`rewards.errors.ts:36-42`), wire `PRIZES_DISABLED`, 403 в `STATUS_BY_WIRE_CODE` (`http-exception.filter.ts:42`).
- **Не гейтятся:** `fulfill`/`revoke`/`listAwards`/`listPrizes` — урегулирование существующих awards (REQ-RWD-009), пин-кейс в `rewards.int-spec.ts` (describe `prize_mode`).
- **Безпризовой draw (REQ-RWD-002b):** `draw.run` payload `prizeId?` optional, `draw.completed` несёт `prizeId: string | null` (`lottery-events.ts`); эффект `award.prize` — только при реальном prizeId (`lottery-handlers.ts`); победитель фиксируется без создания award.
- **Winner-exclusion по null-ключу (§0.4):** прежние победители безпризовых розыгрышей вне пула следующих безпризовых; безпризовые и призовые пулы не пересекаются — 4 unit-кейса + e2e (два розыгрыша, разные победители).
- **Verified-ветка удалена (§0.6):** `lotterySettingsSchema = z.strictObject({})`, `draw_eligibility` отклоняется strict (пин-кейсы), `LOTTERY_MANIFEST_VERSION = 2` (`lottery-manifest.ts:6`); принятый эффект редеплоя lottery@1 зафиксирован в дизайне §7 и амендменте v1.5.
- **Тесты:** app-lottery 39/39 (unit + contract), rewards.int-spec describe `prize_mode` (off/on), lottery.e2e 8/8 (безпризовой сценарий + RF3 с отдельным boot при off — ruling C-pre.1).
- **RF3 (Review Focus 3):** `draw.run` с prizeId при off → ack `PRIZES_DISABLED`, в логе нет ни `draw.run`, ни `draw.completed`, award не создан — откат всего dispatch (эффект до коммитов).

### Критерий 5: Свип обнуляет joinIp и удаляет Exclusion; живой контур не ослаблен ✅

- **Реализация:** `guest-sweep.service.ts:74-83` — `membership.updateMany({ joinIp: null })` + `exclusion.deleteMany(...)` по свипнутым identity ВНУТРИ tx анонимизации, после отзыва сессий, ДО re-check C-8.1 (гоночный award откатывает и IP-очистку).
- **Инвариант-тест:** describe «ADR-012 §3: IP не живёт дольше события + guest_ttl» в `guest-sweep.int-spec.ts` — после свипа joinIp=null и Exclusion=0; **приостановка гардой** (открытый award, REQ-RWD-013) пропускает identity целиком — joinIp и Exclusion на месте до следующего свипа (полный цикл: suspend → retain → resolve → cleanup).
- **Живой контур (REQ-ID-006):** контрольная группа — свежий гость сохраняет joinIp после свипа; join/exclude-пути не тронуты; rejoin-блок для живых Exclusion по `{roomId, ip}` работает (верифицировано финревьюм батча C, `membership.service.ts:229`).
- **Синхронизация симуляции:** `membership.service.int-spec.ts` (describe `listActiveParticipantPool`) — ручная симуляция свипа дополнена обнулением joinIp/удалением Exclusion (выбор шага 4 зафиксирован в коммите `5e837c1`).

### Критерий 6: Амендмент v1.5 + чеклист слиты; compose без GOOGLE_*/OAUTH_* ✅

- **Амендмент:** `docs/spec/amendment-v1.5-zero-pii.md` (`b5729c7`) — приостановки REQ-ID-004/009/015/017 и verified-ветки REQ-RWD-014, уточнение REQ-ID-003, параметры §4 `organizer_setup_token`/`prize_mode`, принятый эффект редеплоя lottery@1, маркеры REQ-ID-012/014.
- **Compose:** `docker-compose.yml` — OAuth-блок удалён; `ORGANIZER_SETUP_TOKEN: ${ORGANIZER_SETUP_TOKEN:?...}` (fail-closed) + `PRIZE_MODE: ${PRIZE_MODE:-off}`. Подъём без GOOGLE_*/OAUTH_* доказан: playwright smoke 1/1 против compose-стенда (T9) + CI e2e-джоб сам поднимает compose с job-env (ci.yml: `ORGANIZER_SETUP_TOKEN` рядом с `JWT_SECRET`, seed-шаг удалён — ruling C-pre.4).
- **Чеклист:** `docs/sessions/2026-09-23-ui-slice-smoke-checklist.md` — §0.1 (setup-токен стенда, curl-probe bootstrap → 200 + `Set-Cookie: mm_refresh`), §1 (вход организатора по setup-токену через UI + негатив «Неверный токен организатора.»), §0.2/§0.3 сохранены; §9 размечен по PRIZE_MODE (шапка «Режим прогона»: 9.1–9.4 при on, при дефолте — строка 9.5 безпризового розыгрыша; фикс-волна `9891b65` по Important #1 финревью).
- **README:** quickstart-абзац self-hosted (`ORGANIZER_SETUP_TOKEN=… docker compose up -d --build`, вход по токену, `PRIZE_MODE=off` по умолчанию).

**Итог: все 6 критериев §10 подтверждены — срез ADR-012 ЗАКРЫТ.**

---

## §2. Ход исполнения и ревью

Исполнение subagent-driven (свежий имплементер + таск-ревью на задачу, целобатчевое финревью + фикс-волна на батч). Все 9 задач — ревью чистые (spec ✅, quality Approved). Финревью: батч A «with fixes» (1 Important — каскад эпохи 2.0.0, фикс-волна `9565e97`), батч B «with fixes» (2 Important — create-room.mjs удалён, warn-лог bootstrap; фикс-волна `b05ba77`), батч C «with fixes» (1 Important — чеклист §9 под PRIZE_MODE; фикс-волна `9891b65`). Все ре-ревью фикс-волн чистые.

**Rulings среза** (подробности и цена ошибки — леджер): батч A: pre-flight 1 (санкционированное красное дерево вместо «гейты зелёные каждую задачу», I-1), pre-flight 2 (исторические oauth-комментарии — не гейт), T2.1 (красный join.controller.ts — спроектированное промежуточное состояние). Батч B: B-pre.1 (IdentityModule в imports TransportModule), B-pre.2 (тест исчерпания псевдонимов без хардкода словаря), B-pre.3 (web-красное до T9), B-F.1 (create-room.mjs удалён), B-F.2 (warn-лог отказов bootstrap), B-F.3 (инвариант-комментарии выровнены). Батч C: C-pre.1 (blast radius PRIZE_MODE — существующие призовые тесты на 'on', гейт-кейсы на 'off'; уточнён по факту guest-sweep.int-spec), C-pre.2 (экспорт anonClient из host-session), C-pre.3 (якоря T8 сместились), C-pre.4 (CI: seed-шаг удалён, ORGANIZER_SETUP_TOKEN в job env), C-F.1 (чеклист §9 — fix в срезе, не follow-up).

## §3. Deferred-миноры (триаж финревью батчей — все stay-deferred)

- Батч A (6): blanket-клауза ADR-012:74 не verbatim; словесная коллизия REQ-RWD-014; рассинхрон брифа z.string() vs min(1); join-response без extra-key пина; stale имя теста config-defaults; (carry решён в B).
- Батч B (6): email-rejection тесты стреляют по kind-индексу (inherent ADR-012); асимметрия delete/it.skip (восстановимо из git); shared per-IP лимитер в happy-path e2e; catch любого P2002 в findOrCreateOrganizer; ветка детерминированного скана псевдонимов без теста; вероятностная уникальность псевдонимов (§0.1).
- Батч C (7+2): гейт createPrize до assertOrganizer (plan-mandated I-3); дублирование bootstrap off-describes (+15 c); преувеличенное обоснование в комментарии membership.service.int-spec.ts:325-330; симуляция P2 без session.updateMany/email:null; host-gate.tsx OAuth-комментарий (файл заморожен §9); .trim() в host-login-page (plan-mandated); протокол-строка 0.3 «"Разыграть"» vs «Разыграть участника» (косметика); цитата ошибки LAN без финальной точки (предсуществовало).
- **Наблюдение гейт-прогона сессии 35:** в кэш-реплее app-lottery:test виден stack-trace ajv из `lottery-manifest.contract.spec.ts:87` при ПРОХОДЯЩЕЙ сьюте (39/39) — шум в выводе теста, не падение; кандидат на чистку вывода при касании.

## §4. Действия владельца после мерджа (не часть среза)

1. **Отозвать Google OAuth-клиента в Google Cloud** и убрать Google-креды из `.env` (решение §0.7, интерпретация I-6) — терминальная точка удаления OAuth-контура.
2. **Мердж `adr-012-zero-pii` → main** и push (main впереди origin на 5 коммитов ещё до среза) — решение владельца.
3. Снятие `origin/phase-4-hardening` и решение по worktree `.worktrees/rewards-lottery` — отложенные решения (см. HANDOFF).
4. Кандидат при ревизии чеклиста/следующем касании: host-gate.tsx OAuth-комментарий (снять «заморозку» §9 точечной правкой).

**Принятые эффекты (не дефекты):** lottery@1 ACTIVE-комнаты после редеплоя недостижимы сервисным путём (дизайн §7 + амендмент v1.5); rejoin-блок по IP снимается свипом вместе с Exclusion (ADR §3); уникальность псевдонимов вероятностная (§0.1).
