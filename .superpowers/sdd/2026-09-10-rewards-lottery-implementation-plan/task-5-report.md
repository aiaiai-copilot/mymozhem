# Task 5 — отчёт исполнителя

**Статус:** DONE
**Коммит:** `1219013` — `feat(core): RewardsService — эффекты награждения в транзакции коммита, автомат AWARDED→FULFILLED|REVOKED, commitRewardsEvent` (ветка rewards-lottery, worktree `.worktrees/rewards-lottery`, push не выполнялся)

## Что сделано

1. **`packages/core/src/rewards/rewards.errors.ts`** (новый) — `PrizeUnknownError` (PRIZE_UNKNOWN), `PrizeFundExhaustedError` (PRIZE_FUND_EXHAUSTED), `AwardUnknownError` (AWARD_UNKNOWN), `RewardAlreadyResolvedError` (REWARD_ALREADY_RESOLVED); все `extends ContractError` из `@mymozhem/sdk`.
2. **`packages/core/src/rewards/rewards.service.ts`** (новый) — `RewardsService`:
   - `executeEffects(tx, roomId, sourceAppId, effects)` — tx параметром (вложенный `outbox.run` запрещён); диспетчер по `effect.kind`: `award.prize` → `awardPrize`, `award.points` → insert в `pointsGrant` (reason ?? null, без события).
   - `awardPrize`: findFirst приза по (id, roomId) → `PrizeUnknownError`; insert Award → P2002 на частичном индексе = типизированный no-op БЕЗ списания фонда; guarded decrement `$executeRaw ... WHERE quantity >= 1` → 0 строк = `PrizeFundExhaustedError` (откатывает insert); затем `commitRewardsEvent('reward.awarded', {awardId, prizeId, winnerId, sourceAppId})` — payload только id (REQ-SEC-009). Всё в tx вызывающего.
   - REST-вход: `createPrize` (assertOrganizer + гейт не-терминальной комнаты DRAFT/ACTIVE → `RoomNotActiveError` из realtime.errors), `listAwards` (assertOrganizer, без гейта статуса — REQ-RWD-009), `fulfill`/`revoke` — свои `outbox.run`, assertOrganizer внутри колбэка, guarded UPDATE по `status = 'AWARDED'`, идемпотентные no-op при повторе, cross-переход → `RewardAlreadyResolvedError`; revoke возвращает quantity ровно один раз и только при prizeId !== null.
   - `assertOrganizer(roomId, actorId)` — **одноклиентный** (рулинг контроллера): параметр tx из скетча брифа удалён полностью (включая `void tx`); `findActiveMembership` читает своим клиентом вне транзакции (прецедент `MembershipService.exclude`).
3. **`packages/core/src/rewards/rewards.module.ts`** (новый) — imports Prisma/Membership/Realtime, providers+exports RewardsService. Без контроллера (Task 6) и handler-провайдера/@Global (Task 11).
4. **`packages/core/src/realtime/event-log.service.ts`** (модифицирован) — refactor к общему пути: тело `commitCoreEvent` заменено делегированием в новый приватный `commitStaticEvent(tx, roomId, type, definition, payload, actorId)` (схема реестра → `appendLocked`), поведение 1:1 (та же ContractError EVENT_PAYLOAD_INVALID с тем же текстом, тот же порядок аргументов appendLocked). Добавлен публичный `commitRewardsEvent(tx, roomId, name: RewardsEventName, payload = {}, actorId = null)` — делегирует в тот же `commitStaticEvent` с `rewardsEventType(name)`/`REWARDS_EVENTS[name]`.
5. **`packages/core/src/index.ts`** — barrel += `./rewards/rewards.errors`, `./rewards/rewards.service`, `./rewards/rewards.module` (коллизий имён с membership/realtime star-exports нет — имена ошибок rewards уникальны).
6. **Тесты:**
   - `packages/core/src/rewards/rewards.int-spec.ts` (новый, 7 тестов) — все сценарии брифа.
   - `packages/core/src/realtime/event-log.int-spec.ts` — добавлен вложенный `describe('commitRewardsEvent')` (2 кейса: контрактная форма `rewards.reward.awarded` + отказ EVENT_PAYLOAD_INVALID без записи), переиспользует существующий контейнер/сервисы внешнего describe.

## RED/GREEN — свидетельства

- **RED (Step 2):** `pnpm --filter @mymozhem/core test:int -- rewards.int-spec` → FAIL на компиляции: `TS2307: Cannot find module './rewards.module' / './rewards.service' / './rewards.errors'` (Test Suites: 1 failed, Tests: 0). Причина ровно та, что ожидал бриф.
- **GREEN (Step 4):** `pnpm --filter @mymozhem/sdk build` (ok) && `pnpm --filter @mymozhem/core test:int -- rewards` → **PASS, 18 suites / 174 tests** (фильтр фактически прогнал весь int-лайн — см. «Замечания»; `PASS src/rewards/rewards.int-spec.ts` в выводе явно, rewards-schema и event-log тоже зелёные).
- Регрессионные лайны: `pnpm build` (turbo, 4/4 ok) · `pnpm --filter @mymozhem/core test` (unit: 18 suites / 216 tests, PASS) · `pnpm --filter @mymozhem/core lint` (чисто) · `pnpm --filter @mymozhem/core typecheck` (чисто) · `pnpm boundary-check` (no violations, 564 modules) · `pnpm guardrails` (все гардрейлы живы).

## Отклонения от брифа (все — по верификации реальных интерфейсов)

1. **`assertOrganizer` одноклиентный** — санкционировано рулингом контроллера в задании: tx-параметр удалён полностью, `void tx` не оставлял. В fulfill/revoke вызов `this.assertOrganizer(roomId, actorId)` внутри `outbox.run`-колбэка.
2. **Бутстрап int-спека:** добавлен `AppRuntimeModule.register([])` в imports — без него DI не собирается: `RealtimeGateway` (провайдер RealtimeModule) разрешает `AppRuntimeService` через global-провайдер (комментарий в app-runtime.module.ts:15-20 это прямо описывает). Также `.overrideProvider(APP_CONFIG).useValue(TEST_CONFIG)` — фабрика ConfigModule делает `loadConfig(process.env)`, что в int-лайне упало бы на валидации env. Плюс `await moduleRef.init()` для lifecycle (onModuleInit PrismaService). Порядок важен: `startTestDb()` ДО `compile()` — DI-PrismaService читает DATABASE_URL при конструировании.
3. **`seedPrize` создаёт ORGANIZER-membership** для org (`db.prisma.membership.create`): без строки membership `fulfill`/`revoke` не прошли бы `findActiveMembership` — бриф этого не учитывал (его же примечание разрешало сверку хелперов с реальными интерфейсами).
4. **`guest()` без `displayName`** (рулинг контроллера): `seedIdentity` принимает только {id?, kind?, email?, deletedAt?}; гости сеются с `kind: 'GUEST'`, email null; org — с уникальным email `org-${randomUUID()}@example.test`.
5. `randomUUID` импортируется из `node:crypto` (прецедент rewards-schema.int-spec.ts), вместо глобального `crypto`.

## Замечания / concerns

- **Jest-фильтр:** `pnpm --filter @mymozhem/core test:int -- rewards` прогнал все 18 int-сьютов (вывод: «Ran all test suites matching /rewards/i», но 18/18), тогда как `-- rewards.int-spec` на RED фильтровал корректно (1 сьюта). На результат не влияет — полный лайн зелёный, что даже сильнее требуемого; но если контроллер ожидал узкий прогон, фильтр стоит проверить.
- **TOCTOU-окно assertOrganizer (известное, по прецеденту):** проверка роли читает вне транзакции fulfill/revoke — теоретическая гонка «exclude организатора между проверкой и UPDATE». Тот же паттерн, что в `MembershipService.exclude`; рулинг контроллера это санкционировал. Смена роли ORGANIZER→другое в MVP невозможна, так что окно практически сведено к soft-delete комнаты/membership.
- **`RoomNotActiveError` в createPrize** — extends RealtimeError (не ContractError), как и предупреждало задание; wire-маппинг — Task 6.
- События `reward.fulfilled`/`reward.revoked` в int-спеке не читаются из лога напрямую (покрыты косвенно кейсом commitRewardsEvent в event-log.int-spec.ts и контрактными спеками SDK); прямая проверка seq/состава лога по REST-переходам — естественная зона Task 6 (REST-контур).
