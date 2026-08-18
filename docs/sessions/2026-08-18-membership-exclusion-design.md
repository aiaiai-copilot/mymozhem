# Дизайн: срез исключения (membership removal)

**Дата:** 2026-08-18
**Статус:** утверждён владельцем по секциям (объём/REQ-карта/модель данных, механика ядра, контракт/endpoint/тесты)
**Предшественники:** membership-guest-join (шов §9: «исключение организатором + rejoin-блок»), realtime read/handshake (готов `RealtimeGateway.revokeRoomAccess` + `SubscriptionRegistry`, шов §9: «срез исключения ОБЯЗАН вызвать hook»), transport-http-auth (`TokenService`, guard-паттерн Bearer)

---

## §0. Решения владельца, зашитые в дизайн (не переоткрывать при исполнении)

1. **Rejoin-блок — по IP, без device-cookie.** Новая таблица `Exclusion`; `join` проверяет `(roomId, ip)`. Device-cookie как инфраструктуры не существует; признак добавляется аддитивно (колонка в `Exclusion` + ветка проверки), когда cookie-инфраструктуру возьмёт свой срез. REQ-ID-006 ч.3 закрывается частично — остаток зафиксирован.
2. **Refresh-сессии исключённого отзываются, если его kind = GUEST** (`Session.revokedAt`). Гостевая identity однокомнатная — сессия вне комнаты ей бесполезна; отзыв закрывает «исключённый перевыпускает access до конца guest-TTL». REGISTERED (появится с OAuth-среза) сессии сохраняет — его доступ режут membership-гейты.
3. **События исключения в логе нет.** Таблица `Exclusion` — достаточная аудит-запись для MVP; log-event появится аддитивно (minor-версия контракта), когда будет потребитель (экран ведущего, откат исключения ф.4 по REQ-ID-018).
4. **Повторное исключение — типизированный no-op** (200, `{excluded: false}`; прецедент идемпотентности REQ-RWD-007). **Роль ORGANIZER неисключаема** (типизированный отказ; организатор в комнате ровно один — частичный индекс `Membership_single_organizer_key` — исключение сломало бы комнату). **Исключение в терминальном статусе комнаты разрешено** (безвредно: подписки могут быть ещё живы).
5. **Принуждение вызова `revokeRoomAccess` — пост-коммит hook по паттерну RealtimeBus (подход A).** Оркестрация в контроллере (B) отвергнута: обязанность держалась бы на соглашении, и следующий вызывающий (модератор ф.4) мог бы забыть второй вызов — класс эрозии, против которого построен проект. forwardRef-цикл модулей (C) отвергнут как запах.
6. **Endpoint — `POST /rooms/:roomId/members/:identityId/exclude` с телом `{reason?}`** (подход A, в стиле `POST /rooms/join`). `DELETE` (B) отвергнут: тело DELETE — шероховатость, а `reason` — задел под обязательное «основание» аудита REQ-ID-018 (ф.4).
7. **M-3 (stale registry window) закрывается в этом срезе** — зафиксировано handoff'ом realtime-среза: когерентность реестра здесь load-bearing.

## §1. Скоуп и закрываемые нормы

**Закрываемые REQ-\*:**

- **REQ-SEC-003** — отзыв членства немедленно завершает активные подписки (полный путь: membership-revocation → hook → разрыв); проверки членства учитывают мягкое удаление участия (`findActiveMembership`).
- **REQ-ID-006 ч.3 (частично)** — исключение участника организатором; блок повторного входа по IP. Осознанный остаток: device-cookie-признак (§0.1).
- **REQ-ID-011 (частично)** — первая материализация матрицы доступа: действие «исключение» доступно только роли ORGANIZER. MODERATOR прав сверх PARTICIPANT не имеет (amendment v1.3) — контроли REQ-ID-018 придут в ф.4 вместе с правом.
- **REQ-ID-013** — rejoin-блок свёрнут в `ROOM_JOIN_DENIED`: исключённому факт исключения не раскрывается (ответ неотличим от «неверного кода»).
- **REQ-SEC-006** — наружу ровно `{code}`, причины — в серверный лог.
- **REQ-RT-009 по духу HTTP** — actorId только из access JWT, не из payload.
- **REQ-CTR-005** — контрактные фикстуры новых схем SDK.

**Критерий выхода ф.1, закрываемый срезом:** тест немедленного отзыва подписки при исключении (REQ-SEC-003) — целиком, полным путём REST → разрыв сокета (hook сам по себе e2e-проверен realtime-срезом).

**Не входит (явно):** device-cookie-инфраструктура и склейка повторных входов; очистка `Exclusion` регламентным job (REQ-ID-010 — TTL-срез); право исключения MODERATOR + контроли REQ-ID-018 (ф.4); откат исключения организатором (ф.4); событие исключения в логе (§0.3); REST read-path участников (web-client срез).

## §2. Модель данных (одна новая миграция; замороженные не трогаем)

```prisma
model Membership {
  // ...существующие поля без изменений
  deletedAt DateTime?   // мягкое удаление участия (REQ-SEC-003)
  joinIp    String      // IP на входе — источник rejoin-блока (REQ-ID-006)
}

model Exclusion {
  id         String    @id @default(uuid()) @db.Uuid
  room       Room      @relation(fields: [roomId], references: [id], onDelete: Restrict)
  roomId     String    @db.Uuid
  identity   Identity  @relation(fields: [identityId], references: [id], onDelete: Restrict)
  identityId String    @db.Uuid
  ip         String                 // копия membership.joinIp на момент исключения
  excludedBy String    @db.Uuid     // identity организатора (FK → identity, Restrict)
  reason     String?                // задел под аудит REQ-ID-018 (ф.4)
  createdAt  DateTime  @default(now())

  @@unique([roomId, identityId])    // одна запись на пару — опора no-op повтора
  @@index([roomId, ip])             // проверка при join
  @@schema("membership")
}
```

- `joinIp` NOT NULL: дев-БД эфемерны, рецепт `prisma migrate reset` (прецедент `Room.code` в миграции membership-guest-join).
- `join()` начинает сохранять `params.ip` в `membership.joinIp` (сейчас IP уходит только в rate-limiter).
- FK `excludedBy → Identity` с `onDelete: Restrict` — по конвенции доменных FK ядра (REQ-CORE-003 по духу).
- Очистка `Exclusion` — регламентный job REQ-ID-010; схема ему не препятствует (шов §9).

## §3. `MembershipService.exclude` — механика

Сигнатура: `exclude({ roomId, targetIdentityId, actorId, reason? }): Promise<{ excluded: boolean }>`. Порядок проверок значим:

1. **Гейт актора:** `findActiveMembership(roomId, actorId)` — членства нет → `ActorNotMemberError`; роль ≠ `ORGANIZER` → `ActorNotOrganizerError` (первая строка матрицы доступа, REQ-ID-011).
2. **Гейт цели:** membership цели по `(roomId, targetIdentityId)`:
   - не найдена → `TargetNotMemberError`;
   - `deletedAt != null` → **no-op**: возврат `{ excluded: false }`, без транзакции и без hook (подписки порваны первым исключением);
   - роль цели `ORGANIZER` → `TargetNotExcludableError` (защита от самоблокировки).
3. **Транзакция (одна):** soft-delete membership (`deletedAt = now()`) → insert `Exclusion` (`ip ← membership.joinIp`, `excludedBy = actorId`, `reason`) → если kind цели `GUEST`: `updateMany Session { revokedAt: now() } where { identityId, revokedAt: null }`.
4. **Пост-коммит:** синхронный вызов зарегистрированных обработчиков отзыва доступа с `(targetIdentityId, roomId)` (§4).

Новые типизированные core-ошибки в `membership.errors.ts` (по существующему прецеденту): `ActorNotMemberError`, `ActorNotOrganizerError`, `TargetNotMemberError`, `TargetNotExcludableError` — не часть SDK-контракта, маппинг наружу — дело транспорта (REQ-SEC-006).

**`findActiveMembership`:** добавляется `membership.deletedAt !== null → null`; комментарий-шов снимается. Этой одной правкой все чтения (subscribe, publish, будущий REST read-path) мгновенно гаснут для исключённого — «проверка непрерывна» (REQ-SEC-003).

## §4. Hook отзыва доступа (принуждение REQ-SEC-003)

- `MembershipService` несёт реестр обработчиков полем экземпляса (in-memory легален: одна реплика, REQ-OPS-005; состояние — не глобальное, REQ-CORE-004) и метод `onAccessRevoked(handler: (identityId, roomId) => void)`.
- Realtime-модуль при инициализации подписывает `RealtimeGateway.revokeRoomAccess` — паттерн `bus.subscribe` в `afterInit`. Зависимость модулей остаётся однонаправленной (realtime → membership, как сейчас); цикла нет.
- `exclude` вызывает обработчики **после коммита транзакции**, синхронно. Бросок обработчика изолируется per-handler и логируется (прецедент `fanOut`): не валит запрос после коммита.
- С этого среза любой вызывающий `exclude` (включая модератора ф.4) получает разрыв подписок структурно.

## §5. Rejoin-блок в `join`

Ветка в `MembershipService.join` после проверки политики, до лимита участников: `exclusion.findFirst({ where: { roomId, ip } })` → `RoomJoinDeniedError` (server-side message точный — «excluded»; наружу — тот же код, что «неверный код», REQ-ID-013). Обход сменой сети — задокументированный лимит REQ-ID-006; штатный ответ спеки для комнат, где это критично, — политика `registered`/`invite_only`. Порядок относительно других denial-веток снаружи неразличим (единый код); внутри — rate-limiter остаётся первым (перебор накапливает счётчик до lookup).

## §6. Контракт SDK (minor 1.2.0 → 1.3.0, аддитивно, REQ-CTR-004) и endpoint

- `excludeRequestSchema = z.strictObject({ reason: z.string().trim().min(1).max(500).optional() })`.
- `ExcludeResponse = { excluded: boolean }` — `false` = типизированный no-op повтора.
- Новые коды в `CONTRACT_ERROR_CODES`: `ACTOR_NOT_ORGANIZER`, `TARGET_NOT_MEMBER`, `TARGET_NOT_EXCLUDABLE` (`ACTOR_NOT_MEMBER` существует с realtime-среза). Exhaustive-спек кодов пополняется; таблица маппинга core→contract — compile-time exhaustive, компилятор сам укажет на пропуск.
- Фикстуры новых схем (REQ-CTR-005).

**Endpoint:** `POST /rooms/:roomId/members/:identityId/exclude`, Bearer access JWT. Актор — только из claims (REQ-RT-009 по духу HTTP); zod-валидация тела; контроллер статусов не знает — маппинг в `HttpExceptionFilter`:

| core-ошибка | wire-код | HTTP |
|---|---|---|
| актор не член комнаты | `ACTOR_NOT_MEMBER` | 403 |
| актор не ORGANIZER | `ACTOR_NOT_ORGANIZER` | 403 |
| цель никогда не была членом | `TARGET_NOT_MEMBER` | 404 |
| цель — ORGANIZER | `TARGET_NOT_EXCLUDABLE` | 409 |
| повторное исключение | — | 200, `{excluded: false}` |
| rejoin исключённого | `ROOM_JOIN_DENIED` | 403 (неотличим от «неверного кода») |

`HttpExceptionFilter.STATUS_BY_WIRE_CODE` пополняется тремя кодами; маппинг `MembershipError` расширяется новыми подклассами.

## §7. M-3: stale registry entry при disconnect внутри subscribe

Окно гонки: disconnect прилетает, пока `handleSubscribe` между `registry.add` и завершением — слушатель disconnect делает `remove(socketId)` no-op'ом (записи ещё нет), subscribe затем добавляет запись мёртвого сокета; запись протухшая до конца жизни процесса (bounded, self-healing при reconnect, но когерентность реестра в этом срезе load-bearing).

**Фикс:** после последней await-точки subscribe, до `ack` — проверка `socket.connected`; разорван → cleanup реестра и обоих каналов (тот же путь, что catch-ветка). Окно схлопывается: disconnect до проверки ловится ей, после — штатным слушателем.

## §8. Тесты (TDD: тесты первыми)

1. **Контрактные (SDK):** `excludeRequestSchema`/ответ — валидные фикстуры + strictObject-негативы; exhaustiveness кодов пополнен.
2. **Int (MembershipService, testcontainers):** happy path (membership soft-deleted, `Exclusion` вставлена с ip/excludedBy/reason, guest-сессии `revokedAt != null`); REGISTERED-цель сохраняет сессии (фабрика identity `kind=REGISTERED`); гейты: актор-не-член, актор-не-ORGANIZER, цель-не-член, цель-ORGANIZER; повтор — no-op без второго insert; `join` после исключения с тем же IP → `ROOM_JOIN_DENIED`, с другого IP — входит (документированный обход); `findActiveMembership` → null после исключения; `joinIp` сохраняется при join.
3. **Unit hook:** обработчик вызван пост-коммит с `(identityId, roomId)`; бросок обработчика изолирован и залогирован, ответ не падает; на no-op не вызывается.
4. **M-3 регрессионный (unit):** disconnect внутри subscribe не оставляет записи реестра.
5. **e2e (apps/server, socket.io-client) — критерий ф.1 целиком:** участник подписан → организатор исключает по REST → сокет участника разорван (`disconnect`); переподписка старым access-токеном → `ACTOR_NOT_MEMBER`; refresh → `SESSION_INVALID`; rejoin с тем же IP → 403 `ROOM_JOIN_DENIED`.

**Гейты на мердж:** build / lint / typecheck / test / test:int / e2e / boundary-check / guardrails. После мерджа — LOC-снапшот по `docs/stats/loc-snapshots.md`.

## §9. Швы после среза

- **Device-cookie:** колонка в `Exclusion` + выдача cookie при join + ветка проверки — когда cookie-инфраструктуру возьмёт свой срез; тогда же склейка повторных входов. REQ-ID-006 ч.3 до тех пор закрыт частично (только IP).
- **Очистка `Exclusion`** — регламентный job REQ-ID-010 вместе с TTL-гостя срезом (`cleanup_interval`).
- **MODERATOR-исключение + REQ-ID-018** (аудит с основанием, rate-limit исключений, окно арбитража, откат организатором) — ф.4; `Exclusion.reason` и `excludedBy` уже на месте.
- **Событие исключения в лог** — аддитивно при появлении потребителя (экран ведущего / откат ф.4).
- **OAuth-срез:** REGISTERED-ветка `exclude` уже корректна (сессии сохраняются); `POST /rooms` создаст организатора — потребителя endpoint'а исключения извне тестовых фабрик.
- Deferred-миноры прошлых срезов не входят; пакет косметики realtime (invalid-uuid литералы, M-5 fail-closed `asLogEvent`, M-2 мёртвая инжекция config) — по-прежнему отдельный follow-up.

## §10. Риски и принятые trade-offs

- **IP как единственный признак rejoin-блока** — обходимо сменой сети; осознанно (REQ-ID-006 сам декларирует ограничение; штатный ответ — закрытые политики входа). NAT-ошибка в обратную сторону (другой человек с того же IP не войдёт) для живого события маловероятна: участники в одном зале, но входят с своих устройств/сетей; риск принят.
- **Хранение IP в `Membership.joinIp` / `Exclusion.ip`** — техничесая PII; гостевые данные эфемерны (guest-TTL), очистка `Exclusion` привязана к регламентному job (§9). Юридический гейт PII открыт и не сдвигается этим срезом.
- **No-op повтора без hook** — если первое исключение по какой-то причине не порвало подписки (бросок обработчика), повтор не поможет; изоляция ошибок hook логируется — сигнал в логе есть. Принято.
- **Исключение в терминальном статусе разрешено** — подписки могут быть живы после COMPLETED (лог запечатан, сокеты не рвутся); исключение остаётся осмысленным действием.
