# Task 5 Report: commitAppEvent — цепочка + int-тесты

**Status:** DONE
**Branch:** phase-1-event-commit
**Commit:** `964859c` — `feat(core): commitAppEvent — commit-цепочка app-событий (REQ-RT-012/016, REQ-CTR-008/009, membership-гейт)`

## Что сделано

1. **`packages/core/src/realtime/event-commit.int-spec.ts`** (новый, 10 тестов) — verbatim из брифа, с одной вынужденной правкой (см. «Отклонения»). Фикстурный манифест `test-app@1` с событиями `note.posted` (public, открытая схема) и `secret.recorded` (module-private). Виринг: один общий `AppRegistryService([TEST_APP])` для `EventLogService` и `RoomService`, `EventEmitLimiter(1000)`, TEST_CONFIG.
2. **`packages/core/src/realtime/event-log.service.ts`** — шов Task 4 (`// commitAppEvent добавляется Task 5`) заменён на метод `commitAppEvent` verbatim из брифа. Цепочка из 8 шагов в точном порядке: status-гейт (ACTIVE + пин, REQ-RT-016) → per-actor rate-limit (REQ-RT-014, попытки жгут бюджет, null-актор не ограничен) → размер payload (REQ-RT-012) → реестр (REQ-CTR-008) → схема ajv verdict-only (REQ-CTR-008/REQ-CORE-007) → потолок видимости через `isWithinCeiling` (REQ-CTR-009) → membership-гейт (`tx.membership.findUnique` по compound key `roomId_identityId`, null-актор освобождён) → `appendLocked` с хранимым `type = ${appId}.${name}` и `schemaVersion = pinned manifestVersion`. Все проверки до advisory lock (payload-нейтральность, REQ-RT-007). Импорты: `isWithinCeiling` добавлен в существующий SDK-импорт, 7 классов ошибок из `./realtime.errors`.

## TDD-хронология

- **Red (Step 2):** `pnpm --filter @mymozhem/core test:int -t "commitAppEvent"` → FAIL, TS2339 `Property 'commitAppEvent' does not exist on type 'EventLogService'` — ожидаемый compile-fail; фильтр сматчил новый spec-файл (1 failed suite). Проверка «не 0 тестов» — после green: 10 passed.
- **Green (Step 4):** тот же фильтр → **10 passed** из 10 (88 skipped в других файлах).
- **Full suites:** `pnpm --filter @mymozhem/core test` → 10 suites / **117 passed**; `pnpm --filter @mymozhem/core test:int` → 11 suites / **98 passed** (testcontainers, Docker был запущен).
- **Гейты:** `pnpm lint` → зелёный (3 tasks), `pnpm typecheck` → зелёный (5 tasks), `pnpm build` → зелёный (3 tasks, dist core обновлён — на случай server e2e, резолвящего core из dist).

## Отклонения от брифа

1. **Удалён неиспользуемый импорт `EventEmitRateLimitedError`** из event-commit.int-spec.ts. Верbatim-код брифа импортирует его, но ни один из 10 тестов Task 5 его не использует (rate-limit тесты — Task 6), и `@typescript-eslint/no-unused-vars` ронял `pnpm lint`. Минимальная правка ради lint-гейта; Task 6 вернёт импорт вместе с тестами лимита. Остальной код и тесты — дословно по брифу.

## Проверки среды (до старта)

- Docker Desktop запущен (`docker info` OK) — testcontainers отработал.
- `RoomService(prisma, eventLog, appRegistry, membership, config)`, `activate`/`cancel` — сигнатуры совпали с брифом.
- `Membership @@unique([roomId, identityId])` подтверждён в schema.prisma — compound `findUnique` работает.
- `isWithinCeiling`/`Visibility` экспортируются из `@mymozhem/sdk` (`sdk/src/index.ts` → `visibility/visibility`).
- `IdentityService(prisma)`, `MembershipService(prisma, identity, joinRateLimiter, config)`, `EventEmitLimiter(limit)` — конструкторы совпали.
- `TEST_CONFIG.MAX_EVENT_PAYLOAD_BYTES = 16_384` — тест oversized payload использует именно его.

## Новых зависимостей / миграций / изменений SDK: нет.

## Concerns

- Нет блокирующих. Единственное наблюдение: порядок «размер до реестра» означает, что oversized payload для неизвестного типа вернёт `EVENT_PAYLOAD_TOO_LARGE`, а не `EVENT_TYPE_UNKNOWN` — это зафиксировано брифом и комментарием в коде, не противоречие.
