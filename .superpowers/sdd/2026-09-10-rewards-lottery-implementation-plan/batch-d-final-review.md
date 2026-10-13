# Финальное ревью батча D (Tasks 10-12) — 8b73978..f5a74e2

Ревьюер: fable (whole-batch). Входы: review-8b73978..f5a74e2.diff, план (Tasks 10-12, Global Constraints), леджер (batch-D секция), дерево HEAD f5a74e2 (read-only верификация швов).

## Вердикт

**Ready to merge: Yes.** Critical: 0. Important: 0. Minor/observations: 5 (все follow-up).

## Что проверялось на уровне всего батча (cross-task)

### 1. Шов quiz@2 effects ↔ AppRuntimeService/RewardsService — СОШЛОСЬ

- Quiz `closeQuestion` (quiz-handlers.ts:121-123) эмитит `{ kind: 'award.points', identityId, points, reason: 'quiz.round' }` с фильтром `points > 0`. Форма совместима с `awardPointsEffectSchema` (sdk/app-runtime/app-effect.ts): uuid, int positive, reason optional — квизовый literal проходит strictObject.
- Диспетчер (app-runtime.service.ts): эффекты валидируются `appEffectSchema` (EVENT_PAYLOAD_INVALID при баге модуля), capability-гейт fail-closed (CAPABILITY_UNAVAILABLE без capability / без handler), исполнение `effectHandler.executeEffects(tx, roomId, mod.appId, effects)` ВНУТРИ outbox.run ДО коммитов событий — сигнатура `RewardsService.executeEffects(tx, roomId, sourceAppId, effects)` совпадает с `AwardEffectHandler` (effects.ts), `implements` добавлен.
- Идемпотентность: повторный `question.closed` гасится ROUND_NOT_OPEN до эффектов (проекция включает question.closed; crash между commit и fold самолечится replay из лога; RoomSerializer сериализует). Асимметрия с award.prize (у points нет DB-level dedupe, у prize — ON CONFLICT DO NOTHING) соответствует дизайну §2/§4: механизм идемпотентности points — модульный гейт, повторного пути исполнения в одной реплике нет. Observation, не находка.
- Лотерея: `drawId`-dedupe на уровне handler (state.draws) + re-emit без эффектов; winner-exclusion — в handler. Дрейфа между quiz/lottery paths нет: оба идут через один executeEffects-цикл.

### 2. Wiring composition root достигает рантайма — ДОКАЗАНО ПОВЕДЕНЧЕСКИ

- `AWARD_EFFECT_HANDLER`: RewardsModule @Global + `{ provide, useExisting: RewardsService }` + export; AppRuntimeService инжектирует `@Optional() @Inject(AWARD_EFFECT_HANDLER)` (app-runtime.service.ts:40). Цикла нет (RewardsModule не импортирует AppRuntimeModule; boundary no-circular зелёный).
- Ключевое: e2e ДОКАЗЫВАЕТ wiring, а не сосуществует с ним. Если бы handler не резолвился, сценарий 1 упал бы на `CAPABILITY_UNAVAILABLE` (fail-closed ветка «not wired in this deployment»). ack `{ok:true}` + строка Award + quantity 0 + `rewards.reward.awarded` у гостя — полный путь publish → диспетчер → executeEffects → коммит событий на проводе.
- Quiz-ветка того же wiring: quiz.e2e (58/58 на HEAD) закрывает вопросы через провод (quiz.e2e-spec.ts:245,259,363) → award.points исполняются реальным handler'ом (иначе CAPABILITY_UNAVAILABLE). Ассертов на строки PointsGrant нет — сходимость ledger↔табло отложена в Task 13 по дизайну (комментарий quiz-handlers.ts «сходимость — e2e Task 13»). План-санкционировано.
- `ANONYMIZATION_GUARDS`: AnonymizationGuardsModule @Global, фабрика `(guard) => [guard]`, inject RewardsAnonymizationGuard. GuestSweepService инжектирует `@Optional() @Inject(ANONYMIZATION_GUARDS)` (guest-sweep.service.ts:19). Фабрика инстанцируется при boot (eager-зависимость GuestSweepService) — резолюция доказана boot'ом AppModule во всех e2e; поведение гарда через РЕАЛЬНЫЙ модуль на проводе не упражнено (свип не тикает: TEST_CONFIG CLEANUP_INTERVAL=3600s >> 180s таймаута), поведение покрыто int-миниатюрой (TestAnonymizationWiringModule, батч C). Observation: фабрика тривиальна, риск минимален.

### 3. Атомарность батча — ПОДТВЕРЖДЕНА

- e8f32b8 трогает только packages/app-quiz (4 файла); промежуточное состояние (quiz.e2e красный на CAPABILITY_UNAVAILABLE) план-санкционировано, и в финальном дереве от него ничего не осталось: quiz.e2e-spec.ts в батче не изменён, workaround'ов/override'ов нет, app.module.ts — verbatim плана.
- Коммиты 10→11→12 последовательно закрывают зависимости (capability → handler wiring → приёмка). Мердж единым блоком корректен; мердж между T10 и T11 был бы красным — план это явно оговаривает.

### 4. Boundary-архитектура rewards-only-through-di-tokens — ПОЛНА

- pathNot-сет полон: grep по packages/core/src показал, что вне `src/rewards/` rewards импортируют ровно barrel `index.ts` и два int-spec (guest-sweep.int-spec.ts:15-17, app-runtime.int-spec.ts:23) — оба покрыты carve-out `[.]int-spec[.]ts$` (ruling C-F.1 исполнен).
- Type-only импорты НЕ являются лазейкой: depcruise конфиг имеет `tsPreCompilationDeps: true` — type-only edges круизятся и флагаются.
- Barrel'ей помимо index.ts нет; новый barrel, реэкспортирующий rewards, был бы пойман (pathNot вырезает только index.ts).
- Остаточная теоретическая лазейка (Minor): core-домен мог бы импортировать rewards-символы ТРАНЗИТИВНО через barrel (`from '../index'`) — ребро domain→index.ts правилом не запрещено. Проверено: ни один файл core так не делает; само-импорта по имени пакета нет (`@mymozhem/core` не в deps core → not-to-unresolvable). Форма правила — verbatim плана (Task 11 Step 3), усиление (символьный запрет) — возможный follow-up, не гейт.
- Dist-эхо вне from.path (src-only) — осознанно, как у socketio-правила; источники истины — исходники.

### 5. Адверсариальный разбор e2e (7 сценариев vs REQ)

| REQ | Покрытие на проводе | Оценка |
|---|---|---|
| REQ-RWD-003 | С2: повтор drawId → typed no-op (`{ok:true}`), award=1, фонд не списан, re-emit идентичен; С5: двойной revoke не возвращает quantity дважды | Достаточно. DB-уровень (ON CONFLICT) на проводе недостижим по построению — покрыт int (батчи B/C) |
| REQ-RWD-004 | С1: REST fulfill → 200 + публичный rewards.reward.fulfilled + DB FULFILLED | Достаточно |
| REQ-RWD-007 | С5: revoke → quantity ровно +1, re-draw другому (winner-exclusion, ruling D-12.2), след в логе | Достаточно |
| REQ-RWD-009 | С6: COMPLETED → listAwards видит AWARDED, fulfill 200 | Достаточно; revoke-after-COMPLETED не упражнён (тот же не-гейтящий code path) — minor #1 |
| REQ-RWD-010 | С3: 2 конкурентных draw на quantity 1 → ровно 1 ok + 1 PRIZE_FUND_EXHAUSTED, quantity 0, awards 1 | Достаточно. Инвариант устойчив и к поломке сериализатора (атомарный декремент + CHECK — страховка БД, покрыта int) |
| REQ-RWD-011 | Не e2e-объект: lint-правило + genuine probe (Task 11, ревьюер воспроизвёл) | Достаточно |
| REQ-RWD-014 | С4: verified-комната, пул={REGISTERED}, winner детерминирован REG; контроль guests_allowed — С1 (гость выигрывает) | Достаточно (ruling D-pre.2: детерминизм сильнее статистики скетча). Открытый вопрос C-9.1 (дефолт через configure) — задокументирован в спеке, остаётся владельцу |
| REQ-SEC-009 | С1: draw.completed без displayName; reward.awarded payload — strictObject с фиксированными ключами (sdk/rewards-events.ts:12-18), PII конструктивно невозможен, но ассерта нет — minor #2 | Достаточно с оговоркой |

Скрытые режимы отказа, которые тесты НЕ отличили бы: (а) partial-commit при отказе эффекта — С3 не ассертит отсутствие второго draw.run в логе; закрыто int-спеками Task 7 (rollback со спаем + реальный handler) и архитектурой (эффекты до коммитов в одной tx); (б) quiz PointsGrant-сходимость — отложена в Task 13 по дизайну. Оба — принятые покрытийные решения, не дыры.

### 6. Что таск-ревью структурно не могли видеть

- Все server e2e (quiz/transport/realtime/oauth/lottery) теперь boot'ят ScheduleModule+IdentitySweepModule: интервал 3600s в TEST_CONFIG — вмешательства в прогоны нет; doesExist-гард (identity-sweep.module.ts) закрывает init-without-listen путь.
- TRUNCATE-листы e2e: quiz.e2e чистит room."Room" CASCADE — PointsGrant (FK на Room, schema.prisma:267) сносится каскадом; lottery.e2e дополнительно перечисляет rewards."Award"/"Prize". Рассинхрона нет.
- readRoomLog — вторая локальная копия (quiz.e2e + lottery.e2e); санкционированное отклонение, drift-риск зафиксирован как observation.
- D-10.1 подтверждён в коде: `drawPool` читается на КАЖДЫЙ dispatch capability-модуля (app-runtime.service.ts:127-129) — горячий answer.submitted квиза грузит membership. Принято ruling'ом; ленивый accessor — задел.
- Дублированной логики между задачами не введено; quiz/lottery эффекты конструируют литералы независимо — общий хелпер не нужен.

## Триаж deferred minors из леджера

| # | Minor | Вердикт |
|---|---|---|
| T10-1 | Комментарий «correct, second» (quiz-handlers.spec.ts) — фактически верен (ранг среди correct), путает с seq; старый «correct, third» в соседнем тесте ещё менее точен | **Follow-up** (комментарии) |
| T10-2 | payload.awarded — untyped unknown | **Follow-up** (pre-existing стиль файла) |
| T11-1 | identity-sweep.module.ts:8-10 — «не импортируется тестами» теперь ложь (AppModule импортирует; противоречит новому комментарию doesExist-гарда) | **Follow-up** (comment-only, тривиален при любом касании; не гейтит) |
| T12-1 | REQ-RWD-009: revoke после COMPLETED не упражнён | **Follow-up** (тот же code path, что fulfill; семантика revoke покрыта С5 + int) |
| T12-2 | REQ-SEC-009: displayName-отсутствие не ассертировано на rewards.reward.awarded | **Follow-up** (payload strictObject фиксированных ключей; однострочный ассерт при касании) |
| T12-3 | replay-чек — новый гость вместо переподключённого | **Follow-up** (косметика; snapshot не зависит от identity подписчика) |
| T12-4 | waitEventWhere/emitAck без внутреннего таймаута | **Follow-up** (прецедент quiz.e2e; jest.setTimeout=180s покрывает) |

## Новые minors этого ревью (все follow-up)

1. Barrel-transitive обход boundary-правила (domain → index.ts → rewards) теоретически возможен; форма правила — verbatim плана; усиление (символьный запрет или запрет self-barrel импортов) — опциональный follow-up.
2. ANONYMIZATION_GUARDS через реальный AnonymizationGuardsModule поведенчески не упражнён (только boot + int-миниатюра); можно закрыть дешёвым e2e/инт кейсом при касании свипа.
3. Асимметрия идемпотентности award.points (нет DB-level dedupe, в отличие от award.prize ON CONFLICT) — соответствует дизайну, но стоит явной строки в дизайн-доке/ADR-следе при фазовом ревью.
4. readRoomLog дублируется в двух e2e — кандидат на экспорт из testing-баррела при третьей копии.
5. drawPool на горячем пути квиза (D-10.1) — уже принято ruling'ом; повторено здесь для полноты фазового следа.

## Эскалации, остающиеся открытыми (не этого батча, для владельца)

- C-9.1: дефолт drawEligibility через REST-configure недостижим (z.toJSONSchema output-режим) — решение владельца до/на фазовом ревью.
- D-12.2: частичный индекс БД (re-award после REVOKE разрешает) vs handler-level winner-exclusion (запрещает) — продуктовое решение.
- Из батча C: свип не трогает membership → TTL-истёкший гость в drawPool; окно гонки гард-чека свипа (ruling C-8.1) — принятый риск MVP, закрытие design-level.
