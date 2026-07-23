# Дизайн — appSettings write path (REQ-RT-004): привязка приложения, запись настроек, заморозка при активации

**Статус:** одобрен владельцем 2026-07-23 (brainstorm-сессия). Вход для writing-plans.
**Этап:** MVP, фаза 1 (Ядро). Метод — AIDD / Specification-Driven.
**Отношение к другим документам:** реализует точки принуждения #2 («Запись appSettings»)
и #3 («DRAFT → ACTIVE») из SDK-дизайна
(`2026-07-16-sdk-contract-core-design.md`, §7). Закрывает шов «Эмит `core.room.activated`
+ пин + заморозка appSettings» из дизайна lifecycle-эмита
(`2026-07-22-realtime-log-lifecycle-emit-design.md`, §10) и тем доводит REQ-RT-010
до полного закрытия (3/3). Строится на app-registry
(`2026-07-18-app-registry-registration-design.md` — boot-time реестр, `getManifest`)
и Room lifecycle (`2026-07-18-room-lifecycle-design.md`).

---

## 0. Одно-абзацная рамка

Комната умеет жить по машине состояний, переходы пишутся в лог — но комната «пустая»:
у неё нет ни привязки к приложению, ни конфигурации механики. Срез строит write path
настроек: колонки `(appId, manifestVersion, appSettings)` на `room."Room"`, валидацию
настроек по JSON Schema из манифеста (ajv, кэш валидаторов по `(appId, manifestVersion)`,
REQ-CORE-007), атомарную запись тройки только в DRAFT и заморозку при активации
(REQ-RT-004) с эмитом `core.room.activated` — `public`-события с payload-пином
(REQ-RT-010 3/3). Read-path (проекции appSettings по уровням видимости), HTTP-поверхность
и валидация app-событий запиненной версией — отдельные срезы; здесь их нет.

**Пять решений владельца, зафиксированные в brainstorm-сессии 2026-07-23:**

1. **Границы среза — доменный сервис, без HTTP.** Миграция + write path + заморозка +
   эмит. REST и маппинг ошибок наружу — план с auth (REQ-SEC-006); `actorId ≠ null` —
   туда же; проекции appSettings — realtime read план.
2. **Версия манифеста выбирается явно при записи**, не резолвится в «latest» при
   активации. Активация не делает скрытого выбора: пара `(appId, manifestVersion)`
   уже лежит в колонках со времени `configure` и лишь закрывается для записи.
   В DRAFT разрешена переконфигурация (смена версии или приложения целиком).
3. **Активация без конфигурации — отказ** (`ROOM_NOT_CONFIGURED`). «Активная комната
   без приложения» невыразима в контракте события: payload `room.activated` — пин.
   Ослабление контракта (пин опциональным) уже отклонено на brainstorm lifecycle-эмита
   (дизайн §0 п.1).
4. **Движок валидации — ajv, дом валидатора — модуль app-registry.** Ajv — стандарт,
   компиляция схем в функции даёт кэш REQ-CORE-007 из коробки. Знание о JSON Schema
   живёт рядом с манифестами: `AppRegistryService.validateSettings(...)`; комната про
   JSON Schema не знает. Event-commit план переиспользует тот же метод для app-событий.
5. **Write-API — один атомарный `configure`** с полной заменой тройки
   `(appId, manifestVersion, appSettings)`. Промежуточного состояния «приложение новое,
   настройки старые» не существует структурно; раздельные setApp/setSettings отклонены.

---

## 1. Объём и карта требований

**Закрывает (headline): REQ-RT-004** — при переводе комнаты в ACTIVE замораживаются
`appSettings` и пара `(appId, manifestVersion)`; изменение конфигурации активной комнаты
запрещено. С оговоркой (§9): вторая половина требования — «валидация app-событий
запиненной версией» — принуждается в event-commit плане; этот срез даёт ей данные
(замороженный пин) и валидатор.

**Закрывает:**

- **REQ-RT-010 (доводит до 3/3)** — `core.room.activated` эмитится в лог как событие
  уровня `public` с payload `{appId, manifestVersion}` (словарь `CORE_EVENTS`, SDK).
  Регрессионный якорь «DRAFT→ACTIVE→COMPLETED = ровно одна строка в логе» обновляется
  на две строки.
- **REQ-CORE-007** — `appSettings` валидируются по JSON Schema из манифеста при каждой
  записи и повторно при `DRAFT → ACTIVE`; скомпилированные валидаторы кэшируются по
  ключу `(appId, manifestVersion)`.

**Сопутствующе задействует:**

- **REQ-DEV-008** — fail-closed сохраняется: перевалидация + заморозка + эмит — одна
  транзакция активации; при отказе перевалидации ни перехода, ни события.
- **REQ-CORE-003** — схема на модуль: миграция меняет таблицу в схеме `room`; после
  слияния миграция замораживается по конвенции репозитория.
- **REQ-CORE-004** — кэш валидаторов после первого обращения read-only, как сам реестр;
  глобального мутабельного состояния процесса не добавляется (кэш — приватное поле
  синглтона Nest).
- **REQ-CTR-005** — пары валид/невалид фикстур настроек у поверхности валидации.

**Осознанно НЕ строит (швы — §9):** HTTP и маппинг ошибок; `actorId ≠ null`; проекцию
appSettings по уровням; валидацию app-событий; персистентный снапшот манифеста.

---

## 2. Модель данных и миграция

Три nullable-колонки на `room."Room"` (одна новая миграция, замораживается после слияния):

```prisma
appId           String?   // slug приложения (appIdSchema), он же неймспейс событий
manifestVersion Int?      // выбирается явно при записи (решение №2)
appSettings     Json?     // настройки, валидированные по схеме манифеста
```

**Инвариант тройки:** колонки меняются только вместе — либо все NULL (черновик без
конфигурации), либо все NOT NULL. Принуждается двумя слоями:

1. структурно — единственный путь записи (`configure`) заменяет тройку целиком;
2. в БД — рукописный `CHECK ((appId IS NULL) = (manifestVersion IS NULL)
   AND (appId IS NULL) = (appSettings IS NULL))` в той же миграции, по практике
   рукописных инвариантов identity-среза (REQ-DEV-006); presence-тест (§7).

Комментарий-шов в `schema.prisma` («appSettings/pin/freeze deferred to a later plan»)
заменяется на актуальный с указанием инварианта тройки.

Отдельная таблица конфигурации отклонена: отношение 1:1, отдельный жизненный цикл не
нужен, лишний join на каждом пути (§8).

---

## 3. Валидация настроек: AppRegistryService + ajv

Новая зависимость `ajv` — только в `packages/core` (SDK остаётся чистым zod; ядро
валидирует). Расширение существующего сервиса:

```ts
validateSettings(appId: string, manifestVersion: number, settings: unknown): unknown
```

Поведение:

- манифест не найден → `AppRegistryError('APP_MANIFEST_UNKNOWN')`;
- `manifest.appSettings` (JSON Schema) компилируется ajv в валидатор; кэш
  `Map<"${appId}@${version}", ValidateFunction>` — приватное поле сервиса, заполняется
  лениво при первом обращении, далее read-only;
- невалидные настройки → `AppRegistryError('APP_SETTINGS_INVALID')` с деталями ajv
  в server-side message (наружу позже — только код, REQ-SEC-006);
- возвращает `settings` (валидированное значение) — для записи как есть; ajv без
  coerce/removeAdditional: вердикт да/нет, трансформаций нет.

**Ошибки — семейство `AppRegistryError`** (новое, в модуле app-registry, по образцу
`RoomError`): коды `APP_MANIFEST_UNKNOWN`, `APP_SETTINGS_INVALID`. Core-внутренние;
маппинг наружу — в плане с auth. Реестр не кидает room-ошибки: RoomService пропускает
эти ошибки сквозь себя без заворачивания.

**Почему ленивая компиляция, а не на буте:** манифестов может быть несколько, комнат с
каждым — ноль или много; компилировать все схемы при старте — платить за неиспользуемое.
REQ-CORE-007 требует кэш, не eager-прогрев.

---

## 4. Write path: RoomService.configure

```ts
async configure(
  roomId: string,
  config: { appId: string; manifestVersion: number; settings: unknown },
): Promise<Room>
```

Порядок (guarded, без check-before-write):

1. **Валидация до БД:** `appRegistry.validateSettings(...)` — невалидно/неизвестно →
   типизированный отказ, БД не тронута.
2. **Guarded UPDATE:** `WHERE id = :roomId AND status = 'DRAFT' AND deletedAt IS NULL`,
   `SET appId, manifestVersion, appSettings` — полная замена тройки. `count = 0` →
   re-read для точности сообщения; код один — `ROOM_SETTINGS_FROZEN` (§6): комната
   отсутствует, удалена или не DRAFT — для вызывающего единый отказ «запись закрыта».
3. Возврат обновлённой строки.

Переконфигурация в DRAFT — тот же вызов; частичного состояния не существует (§2).

**Размещение в `RoomService`:** конфигурация — атрибут агрегата Room; метод ~20 строк.
Отдельный `RoomConfigurationService` плодит границу без второго потребителя.

`RoomService` получает третью зависимость — `AppRegistryService` (через экспорт из
AppRegistryModule; импорт модуля в RoomModule). Правила boundary-check это не нарушают:
запретов на кросс-модульные импорты внутри core нет (прецедент — room уже зависит от
realtime/`EventLogService`); конфиг dependency-cruiser не меняется.

---

## 5. Активация: перевалидация → заморозка → эмит

`RoomService.transition` меняется точечно, только ветка `to === 'ACTIVE'` (порядок шагов
из SDK-дизайна §7: перевалидация → пин/заморозка → lifecycle-событие):

```
$transaction(tx):
  current = tx.room.findUnique(roomId)                    // как сейчас
  assertTransition(DRAFT → ACTIVE)                        // как сейчас
  guarded UPDATE status=ACTIVE WHERE id, status=DRAFT, deletedAt IS NULL
    // как сейчас; count=0 → ROOM_CONFLICT. Для активации это ещё и точка
    // сериализации с configure: updateMany берёт row-lock — конкурентный
    // configure либо уже закоммичен (и виден в re-read ниже), либо ждёт наш
    // коммит и получает ROOM_SETTINGS_FROZEN.
  updated = tx.room.findUniqueOrThrow(roomId)             // re-read ПОСЛЕ row-lock
  if (updated.appId === null) throw RoomNotConfiguredError // предусловие (решение №3)
  appRegistry.validateSettings(updated.appId, updated.manifestVersion,
                               updated.appSettings)        // REQ-CORE-007: повторно
  eventLog.commitCoreEvent(tx, roomId, 'room.activated',
                           { appId, manifestVersion })     // эмит — последним
```

Ключевые точки:

- **Пин и перевалидация — по снимку ПОСЛЕ row-lock, не по `current`.** Псевдокод
  brainstorm-версии читал пин из `current` (до guarded UPDATE): конкурентный
  `configure`, закоммитившийся между чтением и UPDATE, дал бы событию старый пин при
  новой замороженной строке — событие ≠ состояние. Re-read после row-lock делает
  пин в `room.activated` тождественным замороженной тройке при любом расписании.
- **Предусловие `appId === null` — тоже post-lock, единственный авторитетный путь.**
  Отказ откатывает транзакцию: ни перехода, ни события (REQ-DEV-008); цена — пара
  лишних UPDATE/rollback в ошибочном случае, пренебрежимо.
- **Перевалидация — реальный гейт, не no-op.** Реестр boot-time, а строка комнаты
  durable: редеплой мог убрать манифест или изменить схему той же версии (кривой релиз).
  `validateSettings` ловит оба случая: нет манифеста → `APP_MANIFEST_UNKNOWN`; схема
  разошлась → `APP_SETTINGS_INVALID`. При отказе транзакция откатывается — ни перехода,
  ни события (REQ-DEV-008).
- **Эмит последним в транзакции** — конвенция порядка блокировок (advisory lock
  leaf-most; после его захвата `room."Room"` не трогаем) сохраняется: row-lock взят
  guarded UPDATE до advisory lock, как и прежде.
- **Заморозка — не отдельное действие.** Пин уже лежит в колонках со времени `configure`
  (решение №2); активация закрывает запись предикатом `status = 'DRAFT'` в guarded
  UPDATE `configure`. Заморозка принуждается структурно, а не флагом `frozen`.
- **Payload события берётся из re-read строки** (`updated.appId`,
  `updated.manifestVersion`) — той же, что прошла перевалидацию и стала замороженной:
  событие и состояние не могут разъехаться ни на каком расписании.

**Форма таблицы событий.** `LIFECYCLE_EVENTS` остаётся таблицей терминальных переходов
с пустым payload (COMPLETED/CANCELLED); `room.activated` — особая ветка в `transition`,
т.к. его payload — пин из замороженной строки (выбрано в плане по читаемости; инвариант
один: эмит любого lifecycle-события — после guarded UPDATE, в той же транзакции).

---

## 6. Ошибки

| Ситуация | Код | Класс, модуль |
|---|---|---|
| Манифест `(appId, version)` не найден (configure / активация) | `APP_MANIFEST_UNKNOWN` | `AppRegistryError`, app-registry (новое семейство) |
| Настройки невалидны по схеме манифеста | `APP_SETTINGS_INVALID` | `AppRegistryError`, app-registry |
| Активация без конфигурации | `ROOM_NOT_CONFIGURED` | `RoomError`, room (+код в `ROOM_ERROR_CODES`) |
| `configure` по не-DRAFT / удалённой / отсутствующей комнате | `ROOM_SETTINGS_FROZEN` | `RoomError`, room (+код в `ROOM_ERROR_CODES`) |
| Гонка активации (count=0) | `ROOM_CONFLICT` | как сейчас |
| Нелегальный переход по машине состояний | `ROOM_TRANSITION_INVALID` | как сейчас |

**Про `ROOM_SETTINGS_FROZEN`:** строка уже есть в SDK `CONTRACT_ERROR_CODES` — контракт
резервировал код под этот срез. Используем ту же строку в `ROOM_ERROR_CODES`; **SDK не
меняется** (ошибки пока core-внутренние, границу не пересекают). При появлении
транспорта маппинг `code → code` будет тривиальным 1:1. `ContractError` из SDK здесь не
бросаем: семейство `RoomError` уже заявлено источником будущего транспортного маппинга
(комментарий в `room.errors.ts`); смешивать два механизма в одном сервисе незачем.

**Свёртка причин в `ROOM_SETTINGS_FROZEN`** (нет / удалена / не DRAFT) — намеренная,
по образцу `RoomOrganizerNotRegisteredError`: вызывающему — единый отказ, предикат —
инвариант комнаты, не место для рекогносцировки. Точность — в server-side message.

Forward-обязательство REQ-SEC-006 (из HANDOFF) в силе: первый потребитель, отдающий эти
ошибки по HTTP/Socket.io, обязан идти через типизированный код без стектрейса, не
`err.message`.

---

## 7. Тесты (TDD, RED → GREEN)

**Unit (ноль БД) — валидация в AppRegistryService:**

- валидные настройки проходят; невалидные → `APP_SETTINGS_INVALID` (пары фикстур,
  REQ-CTR-005);
- неизвестный `appId` / `manifestVersion` → `APP_MANIFEST_UNKNOWN`;
- кэш: повторная валидация по тому же ключу не перекомпилирует схему (spy на
  `ajv.compile`); разные ключи компилируются раздельно.

**Интеграционные (testcontainer Postgres, паттерн `postgres.testcontainer.ts`):**

- `configure` в DRAFT персистит тройку; повторный `configure` заменяет её целиком
  (включая смену приложения);
- `configure` с невалидными настройками → `APP_SETTINGS_INVALID`, строка не изменилась;
- `configure` на ACTIVE / COMPLETED / CANCELLED / удалённой → `ROOM_SETTINGS_FROZEN`;
- активация без конфигурации → `ROOM_NOT_CONFIGURED`; комната остаётся DRAFT, лог пуст;
- активация сконфигурированной → `room.activated` в логе: тип `core.room.activated`,
  visibility `public`, payload равен пину из колонок, seq = 1 (REQ-RT-010 3/3);
- **регрессионный якорь (обновление):** DRAFT→ACTIVE→COMPLETED = ровно две строки —
  `activated` (seq 1, пин), `completed` (seq 2);
- **перевалидация не декорация:** сконфигурировать валидно → подменить `appSettings`
  напрямую в БД на невалидные (минуя сервис) → активация → `APP_SETTINGS_INVALID`;
  комната остаётся DRAFT, лог пуст (REQ-DEV-008);
- **исчезнувший манифест:** комната запинена на версию, отсутствующую в тестовом
  реестре → активация → `APP_MANIFEST_UNKNOWN`, переход откачен;
- **CHECK тройки (presence):** прямой SQL INSERT/UPDATE с частично-NULL комбинацией →
  отказ БД.

Конкурентный тест двух активаций существует с lifecycle-среза; здесь добавляется
вариант «активация vs configure в DRAFT»: ровно один побеждает — либо configure успел
(комната с новой тройкой активировалась), либо активация (configure получает
`ROOM_SETTINGS_FROZEN`); промежуточных состояний нет.

---

## 8. Отклонённые альтернативы

- **Отдельная таблица конфигурации комнаты.** Отношение 1:1, отдельного жизненного цикла
  нет; лишний join на каждом пути чтения комнаты.
- **Версия резолвится в «latest» при активации.** Скрытый выбор: между записью и
  активацией редеплой мог принести новую версию; семантика «настраивал одно —
  заморозилось другое». Перевалидация лечит симптом, не причину.
- **Активация без приложения.** Невыразима в контракте события (payload — пин);
  ослабление контракта отклонено ещё на brainstorm lifecycle-эмита.
- **Свой мини-валидатор JSON Schema.** Скрытые несовместимости со спекой; манифест
  авторится конверсией zod→JSON Schema (`defineApp`), нужна точная семантика JSON Schema.
- **Раздельные `setApp` / `setSettings`.** Промежуточное состояние «настройки не
  соответствуют приложению» пришлось бы ловить отдельно; потребителя с черновиком
  настроек в MVP нет (REST появится в плане с auth и сможет держать черновик на клиенте).
- **`ContractError('ROOM_SETTINGS_FROZEN')` вместо `RoomError`.** Смешение двух
  механизмов ошибок в одном сервисе; `RoomError` уже заявлен источником транспортного
  маппинга.
- **Eager-компиляция всех валидаторов на буте.** Плата за неиспользуемое; REQ-CORE-007
  требует кэш, не прогрев.

---

## 9. Швы (отложенное, зафиксированное словами)

| Шов | Требование | Закрывается в |
|---|---|---|
| REST-эндпоинты configure/activate + маппинг ошибок наружу без стектрейса | REQ-SEC-006 | план с auth |
| `actorId ≠ null` у lifecycle-событий | REQ-RT-009 + auth | план с auth |
| Проекция `appSettings` по уровням видимости (per-property, `x-visibility`, fail-safe module-private) | REQ-CORE-005/008 | realtime read план |
| Валидация app-событий схемой запиненной версии манифеста | REQ-RT-004 (вторая половина), REQ-CTR-008/009 | event-commit план |
| Персистентный снапшот манифеста (replay комнаты, чью версию убрал редеплой) | REQ-RT-004 durable | задел; триггер — первый редеплой со сменой версий (дизайн app-registry, решение №2) |
| `updateManyAndReturn` — схлопывание запросов в transition/softDelete | — | follow-up из HANDOFF; не разорвать атомарность «UPDATE + лог» |
| Комментарий о конвенции порядка блокировок в `event-log.service.ts` | — | этот план, если трогает файл; иначе ближайший, кто трогает |

**Статус REQ-RT-004 после среза:** механизм заморозки закрыт полностью; требование
считается закрытым в части write path, его вторая половина (валидация app-событий
запиненной версией) принуждается в event-commit плане на данных и валидаторе этого
среза.

---

## 10. Открытые вопросы

Нет. Все развилки brainstorm-сессии закрыты решениями №1–5 (§0). Форму таблицы
`LIFECYCLE_EVENTS` (§5) выбирает план; на инварианты это не влияет.
