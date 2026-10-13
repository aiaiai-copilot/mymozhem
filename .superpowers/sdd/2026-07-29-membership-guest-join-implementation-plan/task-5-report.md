# Task 5 report: JoinRateLimiter + MembershipService.join

## Статус: DONE (verified, no new code written)

## Что было сделано

При входе в задачу выяснилось, что Task 5 **уже был реализован и закоммичен** предыдущей попыткой исполнителя, которая умерла на API-таймауте до того, как успела отчитаться. HEAD ветки `phase-1-membership-guest-join` — коммит `a123f0d` с точным сообщением из Step 7 брифа:

```
a123f0d feat(core): guest join flow with entry limits (REQ-ID-002, REQ-ID-003, REQ-ID-006, REQ-ID-013)
```

(Снапшот git status в начале моей сессии показывал HEAD = 47588e3, но он был устаревшим — коммит a123f0d сделан 2026-07-29 21:09 +0300, до запуска этой задачи.)

Я НЕ стал переделывать работу. Вместо этого:

1. Прочитал все файлы из коммита и сверил их с брифом дословно.
2. Проверил все call-site'ы `new MembershipService(` на 4-аргументный конструктор.
3. Прогнал весь набор тестов и гейтов из Steps 1–7 брифа.

## Проверка соответствия брифу

Файлы в коммите a123f0d (8 файлов, +403/-8):

- `packages/core/src/membership/join-rate-limiter.ts` — дословно Step 2 брифа (fixed-window per-IP лимитер, конструктор `(limit, windowMs = 60_000, now = () => Date.now())`, state в поле инстанса, не module-level — REQ-CORE-004).
- `packages/core/src/membership/join-rate-limiter.spec.ts` — дословно Step 1 (3 теста).
- `packages/core/src/membership/membership.errors.ts` — дословно Step 5 (MEMBERSHIP_ERROR_CODES, MembershipError, RoomJoinDeniedError, JoinRateLimitedError, RoomParticipantLimitReachedError). Ошибки core-internal, не SDK — соответствует ограничению.
- `packages/core/src/membership/membership.service.ts` — дословно Step 5: 4-аргументный конструктор `(prisma, identity, joinRateLimiter, @Inject(APP_CONFIG) config)`, `createOrganizerMembership`, `join` с порядком проверок rate-limit → zod-parse → room lookup → deletedAt → terminal status → joinPolicy → participant count → транзакция createGuest+membership.
- `packages/core/src/membership/membership.module.ts` — дословно Step 5 (imports PrismaModule/ConfigModule/IdentityModule, фабрика JoinRateLimiter из `config.JOIN_RATE_LIMIT_IP`).
- `packages/core/src/membership/membership.service.int-spec.ts` — дословно Step 3 (9 `it` + 1 `it.each` на 6 сценариев = 15 тестов).
- Call-site'ы обновлены на 4-аргументный конструктор — `grep -rn "new MembershipService(" packages apps` даёт 5 мест, все проверены с контекстом:
  - `packages/core/src/room/room.service.int-spec.ts:41` и `:564` — 4 аргумента (включая makeService из Task 4, явно указанный в брифе).
  - `packages/core/src/realtime/event-log.int-spec.ts:36` — 4 аргумента (бриф требовал найти все — сделано в коммите).
  - `packages/core/src/membership/membership.service.int-spec.ts:34` и `:48` — собственные фабрики теста.

## Прогоны (все из корня репо, Jest CLI-форма без `--`)

Docker Desktop запущен; интеграционные тесты — против throwaway testcontainer PostgreSQL (изолированный локальный стенд, не прод).

- `pnpm --filter @mymozhem/core test -t "JoinRateLimiter"`
  → `PASS src/membership/join-rate-limiter.spec.ts` — Tests: 3 passed, 80 skipped.
- `pnpm --filter @mymozhem/core test:int -t "MembershipService.join"`
  → `PASS src/membership/membership.service.int-spec.ts` — Tests: 15 passed, 63 skipped. Миграции применились, включая `20260729164500_membership_guest_join`.
- `pnpm --filter @mymozhem/core test:int` (полная лана)
  → Test Suites: 8 passed, 8 total; Tests: 78 passed, 78 total; 39.9s.
- `pnpm --filter @mymozhem/core test` (полная unit-лана)
  → Test Suites: 7 passed, 7 total; Tests: 83 passed, 83 total.
- `pnpm --filter @mymozhem/core lint` → чисто (eslint src, без ошибок).
- `pnpm --filter @mymozhem/core typecheck` → чисто (tsc --noEmit, без ошибок).

## Отклонения от брифа

Нет. Код в коммите дословно совпадает со Steps 1–5; коммит-сообщение — точно Step 7.

Процессное отклонение (вынужденное): RED-фаза TDD не воспроизводилась, т.к. код уже существовал и был закоммичен. Вместо RED → GREEN я выполнил «верификация соответствия брифу → полный зелёный прогон всех гейтов». Это отклонение от процедуры по необходимости, не от результата.

## Self-review

- Порядок проверок в `join` соответствует design §3: лимит по IP ДО lookup комнаты — подтверждается тестом «counts attempts BEFORE the room lookup (brute force accumulates)».
- Все отказные ветки (unknown code / deleted / COMPLETED / CANCELLED / REGISTERED / INVITE_ONLY) свёрнуты в единый ROOM_JOIN_DENIED (REQ-ID-013) — подтверждено 6-сценарным `it.each`.
- `displayNameSchema.parse` до любых записей — подтверждено тестом «rejects an invalid display name before any write» (membership count остаётся 1 — только ORGANIZER).
- ORGANIZER-membership не считается в лимит участников — есть отдельный тест.
- Глобального мутабельного состояния нет: лимитер — поле инстанса провайдера (REQ-CORE-004), in-memory лимитер корректен при одной реплике (REQ-OPS-005).
- Ошибки core-internal (не SDK-контракт) — соблюдено.
- Новых коммитов не делал: работа уже была закоммичена как a123f0d, рабочее дерево чистое (кроме pre-existing untracked AGENTS.md, который я не трогал).

## Concerns

Нет по существу. Одно процессное замечание: handoff-коммит 47588e3 («batch 2: tasks 3-4») не упоминает Task 5, хотя a123f0d идёт следом за ним — при обновлении handoff в конце сессии стоит отметить Task 5 как завершённый.
