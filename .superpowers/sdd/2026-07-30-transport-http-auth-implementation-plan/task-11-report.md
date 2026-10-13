# Task 11 report: Seed-скрипт create-room служебным организатором

**Status:** DONE
**REQ:** REQ-SEC-001 (CLI-путь, токены организатору не выдаются), REQ-ID-005.

## Что сделано

1. **`apps/server/scripts/create-room.mjs`** (новый) — CLI-скрипт по скетчу брифа:
   `loadConfig(process.env)` (валидирует DATABASE_URL + JWT_SECRET единой схемой,
   REQ-OPS-003) → `PrismaService` → ручная сборка `IdentityService` /
   `JoinRateLimiter` / `MembershipService` / `EventLogService` / `AppRegistryService` /
   `RoomService` → findFirst/create служебного REGISTERED-организатора по email →
   `rooms.create(organizer.id, policy)` (живой путь: zod-валидация политики, генерация
   кода с retry на коллизию, атомарная пара room + ORGANIZER-membership, guarded
   INSERT с предикатом REQ-ID-005). Токены нигде не создаются — TokenService не
   импортируется.
2. **`apps/server/package.json`** — `"create-room": "node scripts/create-room.mjs"`.
3. **Корневой `package.json`** — `"create-room": "pnpm --filter @mymozhem/server run create-room"`.

## Фактические сигнатуры конструкторов vs скетч

Скетч совпал с реальностью один в один (сверено с
`packages/core/src/membership/membership.service.int-spec.ts`, строки 24–46, и
исходниками сервисов):

- `new PrismaService()` — без аргументов; DATABASE_URL читает из `process.env` сам
  (`packages/core/src/prisma/prisma.service.ts:8`). `onModuleInit()`/`onModuleDestroy()`
  — как в скетче.
- `new IdentityService(prisma)`.
- `new JoinRateLimiter(config.JOIN_RATE_LIMIT_IP)` — второй/третий аргументы
  (windowMs, now) опциональны.
- `new MembershipService(prisma, identity, joinRateLimiter, config)` — `@Inject(APP_CONFIG)`
  на 4-м параметре не мешает ручной сборке (декоратор — только метаданные).
- `new RoomService(prisma, new EventLogService(), new AppRegistryService([]), membership, config)`
  — EventLogService без конструктора, AppRegistryService принимает массив манифестов
  (`[]` = пустой реестр, для create достаточно — валидация appSettings нужна только
  на configure/activate).
- `rooms.create(organizerId, joinPolicy)` — joinPolicy по умолчанию `'guests'`,
  парсится `roomJoinPolicySchema` (lowercase union из SDK).

Единственное расхождение со скетчем — не сигнатурное: политика в выводе (см.
«Отклонения»).

## Находка про транзитивный testcontainers

**Barrel тянет testcontainers на require-time — подтверждено экспериментально.**
`packages/core/dist/index.js` содержит
`__exportStar(require("./testing/postgres.testcontainer"), exports)` (src/index.ts:33,
осознанное расширение barrel под e2e apps/server, design §9), а
`dist/testing/postgres.testcontainer.js:6` — `require("@testcontainers/postgresql")`
(devDependency core). Проверка require-хуком на `Module._load` из apps/server:

- 8 точечных импортов скрипта → `no testcontainers pulled`;
- `require('@mymozhem/core')` → `PULLED: @testcontainers/postgresql`.

Поэтому скрипт импортирует **не из barrel**, а из конкретных dist-subpaths
(`@mymozhem/core/dist/room/room.service.js` и т.д.; поля `exports` у пакета нет —
subpaths разрешены; output CommonJS, named imports из CJS работают через
cjs-module-lexer). Это снимает зависимость CLI-пути от devDependencies: на
prod-установке без devDeps barrel-импорт упал бы на require, subpath-импорты — нет.
Причина зафиксирована комментарием в шапке скрипта.

## Верификация (эфемерная БД, порт 55435)

```
docker run -d --name mm-seed-check -e POSTGRES_PASSWORD=postgres -p 55435:5432 postgres:17
DATABASE_URL=postgresql://postgres:postgres@localhost:55435/postgres pnpm exec prisma migrate deploy
  → All migrations have been successfully applied. (включая 20260730101037_auth_sessions)
DATABASE_URL=... JWT_SECRET=$(openssl rand -hex 32) pnpm create-room -- --email=org@example.test
```

Прогон 1:
```
Room created: id=de9eb5f3-b909-4379-9e3b-3eb9bdcde73c code=bewp82s5 joinPolicy=GUESTS organizer=1b57abe3-8560-4517-ad3c-1d0526b063ad
```

Прогон 2 (тот же email):
```
Room created: id=9f553f6f-8392-47de-8849-67846280d5f0 code=48cw88n2 joinPolicy=GUESTS organizer=1b57abe3-8560-4517-ad3c-1d0526b063ad
```

Организатор переиспользован (один и тот же id `1b57abe3-…`), второго identity не
создано. Состояние БД после двух прогонов (psql):

- `identity."Identity"`: ровно 1 строка — REGISTERED, org@example.test, deletedAt NULL;
- `room."Room"`: 2 строки, DRAFT, joinPolicy `guests` (сырое DB-значение), разные коды;
- `membership."Membership"`: 2 строки ORGANIZER (по одной на комнату).

Контейнер удалён (`docker rm -f mm-seed-check`). Чужой lt-pg на 5432 не трогал.

Гейты после изменений: `pnpm boundary-check` — no dependency violations (313 modules);
`pnpm guardrails` — all guardrails verified alive. Полные гейты — задача 12.

## Отклонения от брифа

1. **Импорты из dist-subpaths вместо barrel** — причина выше (testcontainers);
   бриф явно допускал такой вариант.
2. **Строка вывода содержит `joinPolicy=GUESTS`, а не `joinPolicy=guests`** из
   примера брифа: `RoomService.create` перечитывает комнату через Prisma-клиент
   (`findUniqueOrThrow`), который применяет `@map`-маппинг enum — в объекте
   `room.joinPolicy` лежит Prisma-имя `GUESTS` (в БД сырое значение — `guests`,
   проверено psql). Печатаю фактическое поле возвращённой комнаты — это честнее
   отражает живой путь; префикс `Room created: id=... code=... joinPolicy=...`
   сохранён.
3. Добавлен комментарий о гонке двух одновременных запусков (частичный уникальный
   индекс `Identity_registered_email_key` её охраняет) — только документация в коде,
   поведение не меняет.

## Self-review

- REQ-SEC-001: CLI-путь без HTTP и без выдачи токенов — TokenService не импортируется,
  Session-строк в БД после прогонов нет (таблица вообще не трогается; видно по
  коду — единственные записи: identity, room, membership).
- REQ-ID-005: организатор создаётся как REGISTERED без deletedAt — guarded INSERT в
  `insertRoom` проходит штатно (проверено двумя успешными созданиями).
- REQ-OPS-003: конфиг валидируется единой схемой — запуск без JWT_SECRET упал бы на
  `loadConfig` до подключения к БД (не проверял отдельным прогоном; очевидно из кода —
  `loadConfig` вызывается до `new PrismaService()`... фактически до `onModuleInit`,
  но `new PrismaService()` идёт после `loadConfig` в скрипте — порядок верный).
- Идемпотентность по email: findFirst → reuse, подтверждено вторым прогоном и psql.
- Lockfile не тронут, зависимостей не добавлено, стиль (комментарии с REQ-ссылками)
  соответствует окружению.
