# Task 3 report: Миграция membership + код комнаты и политика в RoomService.create

**Commit:** `6ec127747e07f6fbea884cdbdd2e72abd75dc9b4` — `feat(core): membership schema + room code & join policy in create (REQ-ID-013, REQ-ID-002, REQ-ID-011)`

## Что реализовано

1. **Prisma-схема** (`packages/core/prisma/schema.prisma`):
   - `datasource.schemas` → `["identity", "membership", "realtime", "room"]`.
   - `Room`: добавлены `code String @unique`, `joinPolicy RoomJoinPolicy @default(GUESTS)`, релейшн `memberships`.
   - Новый enum `RoomJoinPolicy` (schema `room`, DB-значения lowercase через `@map` — прецедент EventVisibility).
   - `Identity`: добавлены `displayName String?` и релейшн `memberships`.
   - Новые enum `MemberRole` и модель `Membership` (schema `membership`, `@@unique([roomId, identityId])`, FK `onDelete: Restrict`).

2. **Миграция** `packages/core/prisma/migrations/20260729164500_membership_guest_join/migration.sql`: сгенерирована `prisma migrate dev --create-only` против авторинг-контейнера `mm-migrate` (порт 55434, контейнер удалён после применения; `lt-pg` на 5432 не тронут), затем дописана рукописная часть — частичный уникальный индекс `"Membership_single_organizer_key" ON "membership"."Membership" ("roomId") WHERE "role" = 'ORGANIZER'` (REQ-DEV-006). Применена чисто (`migrate deploy`), клиент перегенерирован (`prisma generate`).

3. **`packages/core/src/room/room-code.ts`**: `ROOM_CODE_ALPHABET` (31 символ, без 0/o/1/l/i), `generateRoomCode(length)` на `crypto.randomInt`, `isRoomCodeCollision(e)` (SQLSTATE 23505 + `Room_code_key`).

4. **`RoomService.create(organizerId, joinPolicy = 'guests')`** (`room.service.ts`):
   - zod-валидация политики (`roomJoinPolicySchema.parse`) до обращения к БД.
   - Цикл retry (3 попытки) на коллизию кода — вне транзакции; guarded INSERT вынесен в private `insertRoom` (предикат REQ-ID-005 сохранён verbatim).
   - Конструктор: добавлен `@Inject(APP_CONFIG) private readonly config: AppConfig`; длина кода из `config.ROOM_CODE_MIN_LEN`.
   - `RoomModule` импортирует `ConfigModule`.

5. **Тесты**: `room-code.spec.ts` (3 unit), `membership-schema.int-spec.ts` (5 int: presence-тест индекса, один ORGANIZER на комнату, второй ORGANIZER в другой комнате, unique(roomId,identityId), unique code), новый describe в `room.service.int-spec.ts` (4 int), presence-апгрейд + кросс-kind тест в `identity-schema.int-spec.ts`, обновления `harness.int-spec.ts` (seed с email, code в create), `event-log.int-spec.ts` (TEST_CONFIG), косметика комментария `maxWorkers` в `jest.integration.config.js`.

## Прогоны (фактические)

| Команда | Итог |
|---|---|
| `pnpm --filter @mymozhem/core test -t "generateRoomCode"` (RED, Step 1) | FAIL — `Cannot find module './room-code'` (TS2307), как ожидалось |
| `pnpm --filter @mymozhem/core test:int -t "Membership schema"` (RED, Step 3) | FAIL — компиляция: нет модели `membership`, сигнатура create 1-arg (TS2554), как ожидалось |
| `pnpm --filter @mymozhem/core test -t "generateRoomCode"` (GREEN) | 3 passed |
| `pnpm --filter @mymozhem/core test:int -t "Membership schema"` | 5 passed |
| `pnpm --filter @mymozhem/core test:int -t "room code and join policy"` | 4 passed |
| `pnpm --filter @mymozhem/core test:int -t "partial unique index"` | 8 passed (2 suites) |
| `pnpm --filter @mymozhem/core test:int` (полная лана) | **6 suites, 59 passed, 0 failed** (~35 s) |
| `pnpm --filter @mymozhem/core test` (полный unit) | **6 suites, 71 passed, 0 failed** |
| `pnpm --filter @mymozhem/core lint` | чисто |
| `pnpm --filter @mymozhem/core typecheck` | чисто |

## Отклонения от брифа (все вынужденные, задокументированы)

1. **`prisma migrate dev` в неинтерактивной среде.** Команда из брифа падала с «environment is non-interactive». Прогнал через псевдо-TTY: `(sleep 3; printf 'y\n') | script -q /dev/null pnpm exec prisma migrate dev --name membership_guest_join --create-only` (ранние попытки без задержки/TTY отменялись prompt'ом). Применение сделал `prisma migrate deploy` (неинтерактивный эквивалент повторного `migrate dev` — применяет ожидающие миграции без re-prompt). Результат идентичен: миграция создана `--create-only`, дописана вручную, применена.
2. **`insertRoom` делает re-read через `prisma.room.findUniqueOrThrow` вместо `return rows[0]`.** `$queryRaw` через driver-adapter возвращает сырое DB-значение enum (`'guests'`), а тесты брифа и произведённый интерфейс (`Room.joinPolicy: $Enums.RoomJoinPolicy`) требуют Prisma-имя (`'GUESTS'`). Маппинг `@map` выполняет только клиентский десериализатор. Цена — один дополнительный SELECT на create; в комментарии в коде причина записана. Альтернативы (снять `@map`, ослабить тесты до lowercase) противоречили брифу/схеме.
3. **Ассерт `lower("email")` → `lower(email)`** в identity presence-тесте. Postgres депарсит lowercase-идентификатор без кавычек: миграция пишет `lower("email")`, а `pg_indexes.indexdef` отдаёт `lower(email)`. Замороженную identity-миграцию не трогал; поправил ассерт под фактический депарс (добавил комментарий в тесте).
4. **Два raw-SQL INSERT-теста в `room.service.int-spec.ts`** (CHECK `Room_softdelete_not_active`, FK `Room_organizerId_fkey`) получили колонку `code` в INSERT: новый NOT NULL `code` иначе маскировал ожидаемую ошибку not-null violation'ом. В брифе не перечислены, без правки полная лана красная.
5. **`event-log.int-spec.ts`** также конструирует `new RoomService(` — добавлен тот же `TEST_CONFIG` (бриф предписывал найти все call-site'ы; файл в списке Files не значился).
6. Существующие ассерты identity presence-теста (`/lower/i`, `REGISTERED`, `deletedAt" IS NULL`) сохранены — бриф предписывал добавить два ассерта, а не заменить.

## Concerns

- **Collision-retry не покрыт тестами** — сознательно (бриф, вероятность ~1e-12). `isRoomCodeCollision` опирается на форму ошибки driver-adapter'а (`code: '23505'` + имя индекса в message); если Prisma сменит обёртку raw-ошибок, safety net молча деградирует до «бросить сразу» — поведение останется корректным, просто без retry.
- **`create` теперь делает 2 запроса** (guarded INSERT + re-read) — следствие enum-маппинга, см. отклонение 2. Если Task 4/5 будут оборачивать create в транзакцию (ORGANIZER-membership), re-read естественно уедет в ту же tx.
- TEST_CONFIG дублируется в двух int-spec файлах (room + event-log) — локальная конвенция спеков; если появится третий call-site, имеет смысл вынести в `src/testing/`.

Не запушено. `AGENTS.md` не тронут и не закоммичен. Контейнер `mm-migrate` удалён.

---

## Fix report (review finding, 2026-07-29)

**Finding (Important):** `isRoomCodeCollision` в `room-code.ts` предполагал top-level `err.code === '23505'`, но Prisma 7.8.0 + @prisma/adapter-pg оборачивает любой failed `$queryRaw` в `PrismaClientKnownRequestError` с кодом `P2010` — классификатор всегда возвращал false, retry-loop никогда бы не сработал.

**Верификация против node_modules** (перед правкой):
- `@prisma/client@7.8.0` runtime: `Raw query failed. Code: \`${e.cause.originalCode ?? "N/A"}\`. Message: \`${e.cause.originalMessage ?? ...}\`` → код `"P2010"`, `meta: { driverAdapterError: e }` (где `e.cause` — сконвертированная adapter-ошибка).
- `@prisma/adapter-pg@7.8.0` `convertError`: `23505` → `{ kind: "UniqueConstraintViolation", originalCode: error.code, originalMessage: error.message }`. Имя индекса присутствует в pg `originalMessage` (`duplicate key value violates unique constraint "Room_code_key"`), значит — и в P2010-message.

**Что изменено** (коммит `46363d09b6ac2a5640e3dec9cb1047e7fc05d33b` — `fix(core): match P2010-wrapped 23505 in room code collision classifier (REQ-ID-013)`):
1. `packages/core/src/room/room-code.ts`: классификатор теперь требует `err?.code === 'P2010'` + `'23505'` и `'Room_code_key'` в message. Комментарий переписан под фактическую форму ошибки (со ссылкой на верификацию; отмечен и путь `meta.driverAdapterError.cause.originalCode` как альтернатива).
2. `packages/core/src/room/room-code.spec.ts`: новый describe `isRoomCodeCollision` — 9 тестов: позитивный (P2010 + 23505 + Room_code_key → true); негативные: другой индекс, другой SQLSTATE, не-P2010 код, не-error-shaped входы (null/undefined/Error/string/{}) → false.

**Прогоны:**
- `pnpm --filter @mymozhem/core test -t "RoomCode"` — 12 passed (3 generateRoomCode + 9 isRoomCodeCollision). Примечание: фильтр `-t "room code"` из сообщения координатора не матчит имена describe (camelCase) — 0 тестов; использован `-t "RoomCode"` + прогон файла (`jest room-code`, 12/12).
- `pnpm --filter @mymozhem/core test` (полный unit) — 6 suites, **80 passed, 0 failed**.
- `pnpm --filter @mymozhem/core lint` — чисто; `pnpm --filter @mymozhem/core typecheck` — чисто.

Интеграционная лана не перезапускалась (по указанию координатора): изменение затрагивает только классификатор, который в int-тестах не достижим (коллизия ~1e-12, сознательно не тестируется end-to-end).
