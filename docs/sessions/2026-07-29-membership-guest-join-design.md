# Дизайн — Membership / guest-join: код комнаты, политика входа, членство, лимиты входа

**Дата:** 2026-07-29
**Статус:** одобрен владельцем по секциям (модель данных; поток join с развилками (а)/(б); сервисы/SDK/ошибки; тесты/швы)
**Предшественники:** Identity minimal seam (2026-07-22), Room lifecycle (2026-07-18), appSettings write path (2026-07-23)

## 0. Одно-абзацная рамка

Срез вводит домен Membership и первый поток, пишущий identity: гость входит
в комнату по коду и имени (REQ-ID-003), код комнаты становится барьером
доступа (REQ-ID-013), политика входа — атрибутом комнаты (REQ-ID-002,
ADR-004), вход защищён лимитом участников и per-IP rate-limit (REQ-ID-006,
слои фазы 1 по амендменту v1.3). Это срез «вход» без «выхода»: исключение
участника и TTL гостя — отдельные срезы (§9).

## 1. Объём и карта требований

**Закрывает:**

- **REQ-ID-002 (MUST)** — политика входа `guests | registered | invite_only`,
  атрибут комнаты, дефолт `guests`. Сама колонка + enforcement ветки `guests`;
  ветки `registered`/`invite_only` дают единообразный отказ (успешный вход под
  них — шов §9).
- **REQ-ID-003 (MUST, частично)** — гость создаётся по коду комнаты и имени.
  Часть «TTL + анонимизация по истечении» — шов §9 (отдельный срез).
- **REQ-ID-006 (MUST, частично)** — анти-накрутка: лимит участников комнаты
  (`room_participant_limit`) и per-IP rate-limit входа (`join_rate_limit_ip`).
  Часть «исключение организатором» — шов §9. Глобальный backoff (REQ-ID-019) —
  фаза 4 по амендменту v1.3.
- **REQ-ID-011 (MUST, частично)** — ролевая модель членства материализуется
  таблицей с `role ∈ {ORGANIZER, MODERATOR, PARTICIPANT, SPECTATOR}`; матрица
  доступа появляется с первым потребителем прав (kick / realtime). MODERATOR в
  MVP не имеет прав сверх PARTICIPANT (амендмент v1.3).
- **REQ-ID-013 (MUST)** — криптослучайный код комнаты ≥ `room_code_min_len`
  безопасного алфавита; единообразный ответ на попытку входа: ветки «неверный
  код» и «верный код + закрытая политика» неотличимы до установления членства.
  Это выходной критерий фазы 1 — тест §7.
- **REQ-OPS-003 (частично)** — три параметра §4 заводятся в конфиг-схему с
  диапазонами: `ROOM_CODE_MIN_LEN`, `ROOM_PARTICIPANT_LIMIT`,
  `JOIN_RATE_LIMIT_IP`.

**Follow-up пакет identity (со среза identity minimal seam):** этот срез и
есть «первый реальный identity-пишущий поток», поэтому забирает: presence-тест
индекса (`UNIQUE` + колонка в indexdef), кросс-kind кейс (GUEST с email живого
REGISTERED — разрешён), косметику `harness.int-spec.ts` (сидит identity без
email) и устаревшего комментария в `jest.integration.config.js`. Пункт про
маппинг malformed non-UUID `organizerId` **не** забирается — он прибит к
boundary-слою первого транспорта (REQ-SEC-006), а этот срез транспорта не
имеет.

**Решения владельца (фиксируются как §0 дизайна):**

1. Объём — join + лимиты входа; kick и TTL — отдельными срезами.
2. `displayName` живёт на `Identity`, не на `Membership`: гостевая identity
   room-scoped (REQ-ID-016), а анонимизация (REQ-ID-014) остаётся
   однотабличной.
3. Membership(ORGANIZER) создаётся при создании комнаты — Membership единый
   источник «кто в комнате и с какой ролью».
4. Rate-limit — in-memory injectable провайдер (поле экземпляра, не
   module-level; eslint-гейт REQ-CORE-004 проходит), по принципу амендмента
   v1.3 «без следов в схеме и контракте».
5. Развилка (а): заполненная комната — отдельный код
   `ROOM_PARTICIPANT_LIMIT_REACHED`, не свёрнутый в единообразный отказ.
6. Развилка (б): гонка count-then-insert на лимите участников — принимаем
   возможный перелёт на единицы; лимит анти-накруточный, не финансовый
   инвариант.

## 2. Модель данных и миграция

Новая PostgreSQL-схема `membership` (схема на домен, ADR-006);
`datasource.schemas` → `["identity", "realtime", "room", "membership"]`.

```prisma
enum MemberRole {
  ORGANIZER
  MODERATOR
  PARTICIPANT
  SPECTATOR
  @@schema("membership")
}

model Membership {
  id         String    @id @default(uuid()) @db.Uuid
  roomId     String    @db.Uuid
  identityId String    @db.Uuid
  role       MemberRole
  joinedAt   DateTime  @default(now())
  room       Room      @relation(fields: [roomId], references: [id], onDelete: Restrict)
  identity   Identity  @relation(fields: [identityId], references: [id], onDelete: Restrict)

  @@unique([roomId, identityId])
  @@schema("membership")
}
```

Рукописный частичный индекс той же миграцией (паттерн REQ-DEV-006, с
автотестом наличия — имя + предикат через `pg_indexes`):

```sql
CREATE UNIQUE INDEX "Membership_single_organizer_key"
  ON "membership"."Membership" ("roomId")
  WHERE "role" = 'ORGANIZER';
```

`@@unique([roomId, identityId])` — не дедупликация человека (повторный join
того же человека создаёт новую гостевую identity — склейка через device-cookie
это шов транспорта, §9), а защита от дубля одной identity в одной комнате.

**Изменения существующих таблиц той же миграцией:**

- `Room`: + `code String` (NOT NULL, unique) и + `joinPolicy` — enum
  `GUESTS | REGISTERED | INVITE_ONLY` с `@map` в lowercase-строки спеки
  (`guests | registered | invite_only`), по прецеденту `EventVisibility`;
  дефолт `guests`. Дев-БД эфемерны — рецепт `prisma migrate reset`
  установлен identity-срезом.
- `Identity`: + `displayName String?`.

**Код комнаты:** генерируется при `RoomService.create` через
`crypto.randomInt` по алфавиту без смешиваемых символов
(`abcdefghjkmnpqrstuvwxyz23456789`, 32 символа), длина из конфига
`ROOM_CODE_MIN_LEN` (дефолт 8, диапазон ≥ 6). Коллизия unique → перегенерация,
до 3 попыток (вероятность коллизии ~10⁻¹²), затем непойманная ошибка —
это отказ инфраструктурного класса, не доменный.

## 3. Поток join

`MembershipService.join({ code, displayName, ip })` — единственная точка
входа. Порядок проверок значим:

1. **Rate-limit по IP — первым, до lookup кода.** Иначе перебор кодов не
   накапливает счётчик. Превышение `JOIN_RATE_LIMIT_IP` (дефолт 20/мин) →
   `JOIN_RATE_LIMITED`. Код отдельный: он про IP, существование комнаты не
   раскрывает (REQ-SEC-007 — свой лимит на чувствительный эндпоинт).
2. **Lookup комнаты по коду.** Не найдена или `deletedAt` → `ROOM_JOIN_DENIED`.
3. **Статус.** Join допустим в `DRAFT` и `ACTIVE` (late-join — норма фазы 1,
   ADR-005). `COMPLETED` / `CANCELLED` → тот же `ROOM_JOIN_DENIED`: лог
   запечатан (REQ-RT-016), а разведка «комната существует, но завершена» по
   коду не нужна.
4. **Политика.** `guests` → продолжаем. `registered` / `invite_only` → тот же
   `ROOM_JOIN_DENIED`: успешный вход под `registered` требует
   аутентифицированного контекста (токены — шов §9), invite-механизм спекой
   не определён. Это ровно ветка REQ-ID-013.
5. **Лимит участников.** `count(Membership WHERE roomId AND role = 'PARTICIPANT')`
   ≥ `ROOM_PARTICIPANT_LIMIT` → `ROOM_PARTICIPANT_LIMIT_REACHED` (развилка (а),
   решение 5). Организаторский membership не считается. Гонка count-then-insert
   принята (развилка (б), решение 6): возможный перелёт на единицы, per-IP лимит
   душит массовый заход, глобальный слой — фаза 4.
6. **Создание** — одной транзакцией: `IdentityService.createGuest(displayName)`
   (kind=GUEST) + вставка `Membership(role=PARTICIPANT)`.

**Единообразный отказ** — один типизированный код `ROOM_JOIN_DENIED` на ветки
2–4, без различий в форме: не раскрывает ни существование комнаты, ни её
политику, ни статус. Тест — §7, это выходной критерий REQ-ID-013.

**Эмит в лог отсутствует.** Membership — CRUD-домен (ADR-005: полный event
sourcing отклонён для комнат, членства, реестра). Распространение присутствия
(join-уведомления) решит срез realtime read — не молча здесь.

## 4. Сервисы и конфиг

**`IdentityService` (новый, `core/src/identity/`)** — identity-срез оставил
его швом по правилу «первый поток заведёт сервис сам»; guest-join — этот
поток. Один метод: `createGuest(displayName)` → `Identity { kind: GUEST,
displayName }`. Валидация имени — zod-схемой из SDK (§5). Читателей и других
создателей (REGISTERED) не заводим — нет потребителя.

**`MembershipService` (новый, `core/src/membership/`)** — `join(...)` (§3) +
внутренний `createOrganizerMembership(roomId, identityId)` для вызова из
`RoomService.create`. Читателей (список участников) не заводим — нет
потребителя (YAGNI).

**`RoomService.create(organizerId, joinPolicy = 'guests')`** — существующий
guarded INSERT (предикат `WHERE EXISTS` на REGISTERED не меняется) дополняется
колонками `code` (генерация + retry, §2) и `joinPolicy`. После вставки комнаты
— `MembershipService.createOrganizerMembership` **в той же транзакции**:
нарушение `Membership_single_organizer_key` откатывает и комнату. Появляется
зависимость room → membership — отражается в конфиге boundary-check
(dependency-cruiser).

**`JoinRateLimiter`** — injectable провайдер membership-модуля: fixed window
60 с, счётчики в `Map` — поле экземпляра провайдера, не module-level значение
(буква eslint-гейта REQ-CORE-004 соблюдена; одна реплика REQ-OPS-005 делает
in-memory корректным; рестарт обнуляет окно 20/мин — приемлемо). В фазе 4 за
этим же интерфейсом встанет глобальный слой (REQ-ID-019).

**Конфиг** (`config.schema.ts`, REQ-OPS-003), диапазоны из §4 пакета:
`ROOM_CODE_MIN_LEN` (дефолт 8, ≥ 6), `ROOM_PARTICIPANT_LIMIT` (дефолт 500,
1…100 000), `JOIN_RATE_LIMIT_IP` (дефолт 20, ≥ 1).

## 5. SDK-поверхность

По домашнему стилю (фикстуры + контрактные тесты, REQ-CTR-005):

- `roomJoinPolicySchema = z.enum(['guests', 'registered', 'invite_only'])`
  (REQ-ID-002) — значения lowercase, как в спеке; DB-enum маппится через
  `@map` (§2).
- `displayNameSchema` — trim, 1…40 символов.
- `memberRoleSchema` — уже есть, не меняется; появляется потребитель.

## 6. Ошибки

`membership.errors.ts` рядом с сервисом, по образцу `room.errors.ts`:

- `ROOM_JOIN_DENIED` — единообразный отказ веток 2–4 (§3);
- `JOIN_RATE_LIMITED` — превышение per-IP лимита;
- `ROOM_PARTICIPANT_LIMIT_REACHED` — комната заполнена (развилка (а)).

Все коды core-внутренние. Forward-обязательство не меняется: первый
потребитель, отдающий их по HTTP/Socket.io, обязан идти через типизированный
код без стектрейса (REQ-SEC-006) — маппинг на boundary-слое первого
транспорта, не здесь.

## 7. Тесты (TDD, RED → GREEN)

**Контрактные (SDK, по фикстурам):** обе новые схемы принимают валидное,
отклоняют невалидное (`'GUESTS'` верхним регистром, пустая строка, displayName
из одних пробелов, 41 символ).

**Интеграционные** (Testcontainers-лана, паттерн `postgres.testcontainer.ts`,
cwd = корень репозитория, `test:int -t "..."` без `--`):

- **create:** комната получает код длиной `ROOM_CODE_MIN_LEN` из безопасного
  алфавита; коды двух комнат различны; дефолт политики — `guests`;
  Membership(ORGANIZER) существует сразу после create; presence-тест
  `Membership_single_organizer_key` (имя + предикат в `pg_indexes`,
  REQ-DEV-006); вторая ORGANIZER-вставка в ту же комнату в обход сервиса →
  unique-нарушение.
- **join happy path:** guests-политика, комната в `DRAFT` и в `ACTIVE` →
  GUEST-identity с displayName + Membership(PARTICIPANT), атомарно (падение
  вставки membership не оставляет identity — и наоборот).
- **Единообразие (выходной критерий REQ-ID-013):** несуществующий код ≡
  `registered`-политика ≡ `invite_only` ≡ `COMPLETED` ≡ `CANCELLED` — один код
  `ROOM_JOIN_DENIED`, без различий в форме ошибки.
- **Лимит участников:** сервис, сконструированный с малым лимитом (конфиг
  инжектируется), на лимите → `ROOM_PARTICIPANT_LIMIT_REACHED`;
  организаторский membership не считается.
- **Rate-limit:** (limit+1)-я попытка с одного IP → `JOIN_RATE_LIMITED`;
  лимитер срабатывает до lookup (неверные коды тоже считаются); другой IP не
  затронут; смена окна (инжектимые часы или малое окно в тесте) сбрасывает
  счётчик.
- **Follow-up identity:** presence-тест email-индекса (`UNIQUE` + колонка в
  indexdef); кросс-kind кейс — GUEST с email живого REGISTERED разрешён.

## 8. Отклонённые альтернативы

- **Всё в `room`-модуле** (`RoomService.join`, membership-таблица под опекой
  room) — размывает доменную карту REQ-CORE-002; следующие срезы (kick,
  presence) раздували бы RoomService.
- **ORGANIZER-membership вставляет RoomService напрямую через Prisma** —
  кросс-доменная запись в чужую таблицу; против духа ADR-002. Вместо этого
  RoomService вызывает MembershipService в общей транзакции.
- **`displayName` на Membership** — имя как атрибут участия в комнате. Ни один
  REQ не требует per-room ников; гостевая identity room-scoped (REQ-ID-016);
  анонимизация (REQ-ID-014) стала бы двухтабличной.
- **Счётчик rate-limit в БД** — лишняя миграция, запись на каждую попытку
  входа, накопление строк без cleanup-job (его нет до TTL-среза). Принцип
  амендмента v1.3 — «без следов в схеме и контракте».
- **Advisory lock комнаты на join** (точность лимита участников) — join
  человеческая операция, лимит анти-накруточный; сериализация ничего ценного
  не защищает (развилка (б)).
- **Свёртка `ROOM_PARTICIPANT_LIMIT_REACHED` в `ROOM_JOIN_DENIED`** —
  fail-safe, но «комната заполнена» неотладимо для организатора на живом
  событии; утечка существования возможна лишь для угадавшего валидный код
  (~10⁻¹²), уже закрытого rate-limit (развилка (а)).
- **Завести читателя списка участников / REGISTERED-создателя identity** —
  нет потребителя (YAGNI).

## 9. Швы (отложенное, зафиксированное словами)

- **Исключение участника организатором** (REQ-ID-006 ч.3) + немедленный отзыв
  подписок (REQ-SEC-003) — со срезом realtime; device-cookie + IP блокировка
  повторного входа — там же (device-cookie — транспортная сущность).
- **TTL гостя и анонимизация-поток** (REQ-ID-003 ч.2, REQ-ID-014) — отдельный
  срез с регламентным job (`cleanup_interval`).
- **Токены** (REQ-ID-016: room-scoped гостевой JWT), **device-cookie склейка**
  повторных входов (сейчас повторный join того же человека создаёт новую
  гостевую identity), **извлечение реального IP** и **маппинг ошибок наружу**
  (REQ-SEC-006, включая отложенный malformed-UUID `organizerId`) — срез
  транспорта.
- **Успешный вход под политикой `registered`** — нужен аутентифицированный
  контекст; ветка появится с токенами.
- **Invite-механизм `invite_only`** — спекой не определён; до его появления
  политика даёт единообразный отказ всем.
- **SPECTATOR-вход** — фаза 2 (квиз, зритель). Вместе с ним пересматривается,
  входят ли зрители в лимит участников (§3 считает только PARTICIPANT — при
  отсутствии SPECTATOR-входа вопрос не стоит).
- **Распространение присутствия** (join-уведомления участникам) — срез
  realtime read; эмит в лог этим срезом не вводится (§3).

## 10. Долгоживущие ограничения, вводимые срезом

- Новая миграция (схема `membership` + колонки `Room.code`/`Room.joinPolicy` +
  `Identity.displayName`) **замораживается** после слияния; изменение — только
  новой миграцией.
- Изменение веток join (2–4, §3) — только с пересмотром теста единообразия
  REQ-ID-013; ветки обязаны оставаться неотличимыми.
- Параметры кода комнаты (алфавит, длина) и лимитов — только из конфига
  (REQ-OPS-003), не литералами в коде.
- `JoinRateLimiter` — поле экземпляра провайдера; запрет module-level
  мутабельных значений (REQ-CORE-004) распространяется и на будущие лимитеры.
- Порядок блокировок не меняется: join advisory lock не берёт (развилка (б)),
  конвенция «advisory lock — всегда leaf-most» не трогается.
