# Дизайн — Lifecycle-эмит в лог (Event Log фундамент + REQ-RT-010)

**Статус:** одобрен владельцем 2026-07-22 (brainstorm-сессия). Вход для writing-plans.
**Этап:** MVP, фаза 1 (Ядро). Метод — AIDD / Specification-Driven.
**Отношение к другим документам:** реализует часть объёма фазы 1 (§5 нормативного пакета
v1.2: «Event log + Realtime-модуль») с учётом амендмента v1.3. Закрывает шов
«Lifecycle-эмит перехода в лог» из дизайна Room lifecycle
(`2026-07-18-room-lifecycle-design.md`, §10). Строится на словаре core-событий SDK
(`2026-07-16-sdk-contract-core-design.md`, §4.2, §7 «фиксация события» — порядок шагов).

---

## 0. Одно-абзацная рамка

Первый срез домена Realtime — **append-only лог событий комнаты и первый продюсер в него**.
По ADR-005 лог `(roomId, seq, type, payload, actorId, visibility, schemaVersion)` —
единственный канал синхронизации состояния игры; `seq` назначает сервер при фиксации.
Срез строит таблицу лога (схема `realtime`), append-примитив `commitCoreEvent` в форме
будущего event-commit (валидация zod до входа в критическую секцию, advisory lock,
атомарное присвоение `seq` — порядок шагов SDK-дизайна §7) и подключает к нему переходы
жизненного цикла комнаты как `public`-события (REQ-RT-010) **в одной транзакции с
переходом** — fail-closed (REQ-DEV-008) структурно, не проверкой. Read-path (проекции,
replay, транспорт) и цепочка commit для app-событий — отдельные срезы; здесь их нет.

**Два решения brainstorm-сессии 2026-07-22, зафиксированные владельцем:**

1. **Эмит `room.activated` — НЕ в этом срезе.** Payload `core.room.activated` по
   SDK-словарю — пин `{appId, manifestVersion}` (REQ-RT-004), которому неоткуда взяться
   до среза appSettings write path (колонок у Room нет, потока присоединения приложения
   нет). SDK-дизайн §7 и так ставит lifecycle-событие шагом после «пин → заморозка» в
   потоке `DRAFT → ACTIVE`. Эмит `room.activated` ложится в appSettings-срез вместе с
   пином; REQ-RT-010 закрывается полностью после обоих срезов. Здесь эмитятся
   `room.completed` и `room.cancelled`.
2. **Лог живёт в модуле/схеме `realtime`.** ADR-003 фиксирует ядро пятью доменами
   (Identity, Room, Membership, Realtime, App-registry); лог — часть домена Realtime
   (фазовый план §5: «Event log + Realtime-модуль»). Отдельный модуль `event-log`
   плодил бы шестой core-домен сверх перечисления ADR-003. Упоминание схемы `core` в
   §5 пакета уже опровергнуто практикой (identity-срез использовал схему `identity`).

## 1. Объём и карта требований

**Закрывает (headline): REQ-RT-010 (2 из 3 событий)** — переходы жизненного цикла
комнаты эмитируются в лог как события уровня `public`: `core.room.completed` и
`core.room.cancelled`. Эмит `core.room.activated` — зафиксированный шов (§0 п.1).

**Закрывает:**
- **REQ-RT-001** — append-only лог `(roomId, seq, type, payload, actorId, visibility,
  schemaVersion)`; `seq` назначается сервером при фиксации; `unique(roomId, seq)`
  реализовано составным первичным ключом.
- **REQ-RT-007** — стратегия разрешения конкуренции за `seq`: advisory lock на комнату
  (`pg_advisory_xact_lock`), зафиксирована здесь и в SDK-дизайне §7; покрывается
  конкурентным тестом на примитиве (плотность и уникальность seq под гонкой).
  Payload-нейтральность структурна: валидация payload завершается до входа в секцию;
  тест отсутствия payload-смещения с app-payload — в event-commit план (нет app-событий).
- **REQ-DEV-008** — fail-closed: переход и запись в лог — одна транзакция; действие,
  не зафиксированное в логе, откатывается.

**Сопутствующе задействует:**
- REQ-CORE-003 — схема на модуль: таблица лога в PostgreSQL-схеме `realtime`;
  декларативные FK на core-таблицы `room` и `identity` без каскадов (Restrict).
- REQ-CORE-004 — нет глобального мутабельного состояния процесса: сервис stateless
  поверх Prisma; определения типов — иммутабельный словарь SDK.
- REQ-CTR-009 (аналог для core-типов) — `visibility` и `schemaVersion` штампуются из
  определения типа в `CORE_EVENTS`, а не из параметров вызывающего: занизить уровень
  структурно невозможно (параметра нет).
- REQ-OPS-002 — миграция применяется детерминированно (`migrate deploy`).
- REQ-DEV-001 — CI-гейты: lint (+ boundary-check), type-check, unit/integration, сборка.

**Осознанно НЕ строит (швы — §10):**
- Эмит `core.room.activated` + пин `(appId, manifestVersion)` (REQ-RT-004) — appSettings-срез.
- Цепочка commit для app-событий (SDK-дизайн §7, шаги 1–7: запечатывание REQ-RT-016,
  размер payload REQ-RT-012, rate-limit REQ-RT-014, actorId из auth-контекста REQ-RT-009,
  резолв владельца и валидация по реестру REQ-CTR-008) — event-commit план.
- Read-path: проекции по уровням видимости (REQ-CORE-005), replay (REQ-RT-003/011),
  realtime-транспорт (ADR-005a) — realtime read/transport план.
- `actorId ≠ null` для lifecycle-событий — с появлением auth-контекста (сейчас `null` —
  system/lifecycle, что прямо допускает `logEventSchema`).
- DB-уровневый запрет UPDATE/DELETE лога (rule/trigger) — SRE-задел; append-only
  принуждается отсутствием путей записи в коде.

## 2. Модель данных (Prisma, схема `realtime`)

`datasource.schemas` пополняется: `["identity", "realtime", "room"]`. Новая миграция;
после слияния замораживается по установленному правилу (как `room_lifecycle`,
`identity_seam`, `room_organizer_fk`).

```prisma
enum EventVisibility {
  PUBLIC         @map("public")
  ORGANIZER      @map("organizer")
  MODULE_PRIVATE @map("module-private")
  @@schema("realtime")
}

// Append-only лог событий комнаты (REQ-RT-001, ADR-005). Составной PK = unique(roomId, seq).
// seq назначает сервер в критической секции (advisory lock, REQ-RT-007).
// recordedAt — storage-only колонка (отладка/ретеншн); в контракт (logEventSchema) не
// входит и наружу не проецируется.
model LogEvent {
  roomId        String          @db.Uuid
  seq           Int
  type          String          // "core.room.completed" — форма eventTypeSchema
  payload       Json
  actorId       String?         @db.Uuid  // null только для system/lifecycle
  visibility    EventVisibility
  schemaVersion Int
  recordedAt    DateTime        @default(now())
  room          Room            @relation(fields: [roomId], references: [id])
  actor         Identity?       @relation(fields: [actorId], references: [id])

  @@id([roomId, seq])
  @@schema("realtime")
}
```

- Оба FK — на core-таблицы, Restrict, без каскадов (REQ-CORE-003). `Room` и `Identity`
  получают только обратные relation-поля (`logEvents LogEvent[]`) — аддитивно.
- Значения enum маппятся в контрактные строки (`module-private`) через `@map`.
- Индексов сверх PK не вводим: read-path в этом срезе отсутствует; `(roomId, seq)`
  покрывает будущий replay по комнате по возрастанию seq.
- Миграцию проверить на соответствие: значения enum в SQL — mapped-строки; FK без
  `ON DELETE CASCADE`.

## 3. Модуль realtime и append-примитив

```
packages/core/src/realtime/
  realtime.module.ts        — RealtimeModule: provides + exports EventLogService
  event-log.service.ts      — commit-примитив
  event-log.int-spec.ts     — интеграционные тесты примитива и эмита
```

`EventLogService.commitCoreEvent` — единственный публичный метод:

```ts
async commitCoreEvent(
  tx: Prisma.TransactionClient,
  roomId: string,
  name: CoreEventName,          // тип из SDK — несуществующий тип не компилируется
  payload: unknown = {},
  actorId: string | null = null,
): Promise<LogEvent>
```

**Порядок шагов обязателен** (SDK-дизайн §7, шаги 5–8 для core-типов):

1. Определение типа из `CORE_EVENTS` (zod-схема, потолок visibility, version).
2. Валидация payload схемой определения — **до входа в критическую секцию**; промах →
   `ContractError('EVENT_PAYLOAD_INVALID')` из SDK. По факту недостижимо (payload
   конструирует ядро); валидация — точка принуждения контракта, не обработка ввода.
3. `SELECT pg_advisory_xact_lock(hashtextextended(${roomId}::text, 0))` через `tx`.
4. Один атомарный statement: `INSERT … SELECT ${roomId}, COALESCE(MAX(seq),0)+1, …
   FROM realtime."LogEvent" WHERE "roomId" = ${roomId} RETURNING *`; `visibility` и
   `schemaVersion` — литералы из определения типа.

Направление зависимостей: `RoomModule → RealtimeModule → PrismaModule`; цикла нет.
`EventLogService` зависит от Prisma (транзакционный клиент приходит параметром) и SDK
(словарь, схемы, `ContractError`) — тот же внутренний паттерн ядра; boundary-check
(dependency-cruiser) при необходимости пополняется разрешением `room → realtime` в core.

Примитив осознанно имеет форму будущего event-commit: шаги 1–7 для app-событий
(sealing, лимиты, auth-актор, реестр) встают **перед** шагом 3 без изменения шагов 3–4.

## 4. Перестройка RoomService.transition

Сейчас — 3 запроса без транзакции. Становится одной транзакцией (сигнатуры
`transition/activate/complete/cancel` не меняются):

```ts
async transition(roomId: string, to: RoomStatus): Promise<Room> {
  return this.prisma.$transaction(async (tx) => {
    const current = await tx.room.findUnique({ where: { id: roomId } });
    if (!current || current.deletedAt !== null) {
      throw new RoomConflictError(`Room ${roomId} not found or deleted`);
    }
    assertTransition(current.status as RoomStatus, to);
    // Атомарный guarded UPDATE — корректность гонки на WHERE, не на SELECT (как было).
    const res = await tx.room.updateMany({
      where: { id: roomId, status: current.status, deletedAt: null },
      data: { status: to },
    });
    if (res.count === 0) {
      throw new RoomConflictError(`Room ${roomId} changed concurrently`); // → rollback
    }
    const eventName = LIFECYCLE_EVENTS[to]; // частичная таблица, см. ниже
    if (eventName) {
      await this.eventLog.commitCoreEvent(tx, roomId, eventName, {});
    }
    return tx.room.findUniqueOrThrow({ where: { id: roomId } });
  });
}
```

- **Таблица маппинга** — рядом с сервисом, явная и частичная:
  `{ COMPLETED: 'room.completed', CANCELLED: 'room.cancelled' }`. `ACTIVE` в ней
  **отсутствует осознанно** (§0 п.1): в коде — комментарий-шов «activated-emit встаёт
  сюда вместе с пином REQ-RT-004».
- Бросок внутри `$transaction` = rollback: проигравший гонку не оставляет события;
  ошибка INSERT лога откатывает переход (REQ-DEV-008).
- `create` и `softDelete` не меняются и не эмитят: в словаре core-событий только три
  перехода; у DRAFT нет аудитории лога; soft-delete — ортогональный атрибут, не статус.
- Поведение сервиса для вызывающих сохранено: существующие int-тесты
  `room.service.int-spec.ts` должны пройти без правок (добавлен только побочный эмит).

## 5. Обработка ошибок

Новых типов ошибок не вводим.

- `ROOM_TRANSITION_INVALID`, `ROOM_CONFLICT` — как было (core-внутренние, границу не
  пересекают; forward-обязательство REQ-SEC-006 из HANDOFF не активируется — транспорта
  нет).
- Валидационный промах payload в `commitCoreEvent` — `ContractError('EVENT_PAYLOAD_INVALID')`
  из SDK (контрактная таксономия §8 SDK-дизайна; примитив — будущая точка commit,
  поэтому код контрактный, а не доменный).

## 6. Обвязка модуля

- `RealtimeModule` (Nest) предоставляет и экспортирует `EventLogService`, импортирует
  `PrismaModule`.
- `RoomModule` импортирует `RealtimeModule`; `RoomService` получает `EventLogService`
  через конструктор.
- Экспорты из `@mymozhem/core` (`packages/core/src/index.ts`): `RealtimeModule`,
  `EventLogService`. Регистрация в `apps/server/src/app.module.ts` — `RealtimeModule`
  (RoomModule уже зарегистрирован).
- boundary-check остаётся зелёным: `room → realtime` — внутренняя зависимость ядра;
  конфиг dependency-cruiser пополняется при необходимости.

## 7. Стратегия тестов (TDD, RED → GREEN — тесты первыми)

Unit-тестов нет (нет новой чистой логики; таблица маппинга тривиальна и покрывается
интеграционными). Всё — integration на реальной БД через существующий
testcontainer-паттерн (`packages/core/src/testing/postgres.testcontainer.ts`,
cwd = корень, Docker Desktop запущен):

**Эмит переходов (`room.service.int-spec.ts` — пополнение):**
- `complete` → ровно одна строка `LogEvent`: type `core.room.completed`, visibility
  `public`, actorId `null`, payload `{}`, schemaVersion `1`, `seq = 1`;
- `cancel` (из DRAFT и из ACTIVE) → то же с `core.room.cancelled`;
- полный путь DRAFT→ACTIVE→COMPLETED → в логе ровно одна строка (completed, seq=1) —
  фиксирует скоуп-решение §0 п.1 (activation пока не эмитит);
- две комнаты → независимые seq-счётчики (у каждой seq=1);
- нелегальный переход, переход терминальной/удалённой комнаты → лог пуст;
- `create`, `softDelete` → лог пуст.

**Конкуренция:**
- конкурирующие переходы (`activate` vs `cancel` над одной комнатой) — ровно один
  побеждает, в логе ровно одна строка и она от победителя (атомарность эмита);
- **гонка на примитиве (REQ-RT-007)** — N параллельных `commitCoreEvent` на одну
  комнату (каждый в своей транзакции): все завершаются успешно, seq плотные 1..N без
  дублей — сериализация advisory-lock'ом. Тест детерминированного свойства, не
  статистики.

**Миграция:**
- существующий presence/behavioral паттерн миграций (как в identity-срезе): таблица
  `realtime."LogEvent"` существует, PK `(roomId, seq)`, FK Restrict, значения enum —
  контрактные строки.

## 8. Отклонённые альтернативы

- **Эмит после коммита (outbox-подобный)** — отклонено: окно между коммитом перехода и
  записью лога нарушает REQ-DEV-008; второй канал согласования запрещён REQ-RT-010.
- **Триггер БД на изменение `status`** — отклонено: логика прячется в БД; zod-валидация
  и порядок шагов §7 невоспроизводимы; app-событиям всё равно нужен кодовый путь —
  два механизма вместо одного.
- **Эмит `room.activated` сейчас с ослабленным payload (пин опциональным)** — отклонено
  владельцем на brainstorm: правит ревьюированный контракт под порядок исполнения;
  обратное ужесточение (optional → required) — breaking-изменение.
- **Retry по конфликту `unique(roomId, seq)` вместо advisory lock** — REQ-RT-007
  допускает оба, но SDK-дизайн §7 (и дизайн фазы 0 §1.5) уже зафиксировал advisory lock;
  переоткрытие без нового основания не требуется.
- **Отдельный модуль `event-log` со своей схемой** — отклонено владельцем: шестой
  core-домен сверх перечисления ADR-003; лог — часть Realtime.
- **Суррогатный `id` PK + отдельный unique(roomId, seq)** — отклонено: составной PK —
  та же норма REQ-RT-001 без лишней колонки; суррогатный id ничему не служит.

## 9. Критерии выхода среза и ревью

**Критерии выхода:** все тесты §7 зелёные; CI-гейты зелёные (lint + boundary-check,
type-check, unit/integration, сборка — REQ-DEV-001); миграция `realtime` применяется
чисто (`migrate deploy` на пустой и на существующей БД); `RealtimeModule` зарегистрирован
в сервере, экспорты на месте; boot артефакта не сломан.

**Двухстадийное ревью (CLAUDE.md §3):** стадия 1 (спек-комплаенс) сверяется против
перечисленных REQ-* из §1 — headline **REQ-RT-010** (2/3 события + шов), **REQ-RT-001**,
**REQ-RT-007**, **REQ-DEV-008**, сопутствующие REQ-CORE-003/004, REQ-OPS-002,
REQ-DEV-001; стадия 2 — качество кода.

## 10. Швы (отложенное, зафиксированное словами)

| Шов | Требование | Закрывается в |
|---|---|---|
| Эмит `core.room.activated` + пин `(appId, manifestVersion)` + заморозка appSettings | REQ-RT-004, REQ-RT-010 | appSettings write path срез |
| Цепочка commit для app-событий: sealing, размер, rate-limit, auth-актор, реестр схем | REQ-RT-016, REQ-RT-012, REQ-RT-014, REQ-RT-009, REQ-CTR-008/009 | event-commit план |
| Read-path: проекции по уровням, replay, курсор | REQ-CORE-005, REQ-RT-003, REQ-RT-011 | realtime read план |
| Realtime-транспорт (Socket.io за контрактом) | ADR-005a, REQ-RT-006 и др. | realtime transport план |
| `actorId ≠ null` для lifecycle-событий | REQ-RT-009 + auth | план с auth-контекстом |
| DB-уровневый запрет UPDATE/DELETE лога (rule/trigger) | ADR-005 (append-only) | SRE-задел |
| Тест payload-нейтральности с app-payload | REQ-RT-007 | event-commit план |
| Маппинг доменных/контрактных ошибок в транспортный ответ без стектрейса | REQ-SEC-006 | первый транспортный срез |
