# Сверка критериев выхода фазы 3 (Rewards + Lottery + TTL-свип + квиз-начисления)

**Дата:** 2026-09-23
**Тип:** сверка при закрытии среза (код среза — ветка `rewards-lottery`, `0fddb16..37b13ac`, 18 коммитов, 81 файл, +4003/−138)
**Основание:** §5 пакета v1.2 («Фаза 3 — Rewards + Lottery», критерии выхода) + дизайн `2026-09-10-rewards-lottery-design.md` (утверждён владельцем; §7 — критерии выхода) + план `2026-09-10-rewards-lottery-implementation-plan.md` (13 задач, исполнены батчами A–E).
**Метод:** финальное целосрезовое двухстадийное ревью диапазона батчей A–E (Stage 1 spec-compliance: **confirmed** по всем 21 REQ группам; Stage 2 quality: 0 Critical / 0 Important; триаж всех deferred-миноров леджера — ни одного must-fix; вердикт «Ready to close phase 3: Yes»). Полный конвейер на HEAD (`37b13ac`): build 5/5 → lint → boundary-check → guardrails (5 пробников живы, вкл. rewards-boundary и Math.random) → unit (sdk 313 / core 223 / app-lottery 34 / app-quiz 86) → e2e apps/server (7 сьютов, 67/67) → int (188/188) — **зелёный**, exit 0.

---

## 1. Критерии выхода (design §7 ↔ §5 пакета)

| # | Критерий (design §7) | Вердикт | Покрытие |
|---|---|---|---|
| 1 | e2e лотереи (полный цикл, REST, публичность live+replay) | ✅ | `lottery.e2e-spec.ts` сценарий 1 (полный цикл: гости → приз REST → draw.run → draw.completed из пула → AWARDED → fulfill; публичность live и replay) |
| 2 | Конкурентный дубль; K>quantity; повторное вручение; двойной отзыв; revoke освобождает/fulfill нет | ✅ | `rewards.int-spec.ts:105-170` (K>quantity → ровно quantity успехов без минуса REQ-RWD-010; конкурентный дубль → один победитель, quantity −1 ровно раз, tx после no-op жива REQ-RWD-003; повторное вручение — no-op, cross-переход → REWARD_ALREADY_RESOLVED REQ-RWD-007; двойной отзыв возвращает quantity один раз) + `lottery.e2e` сценарии 2, 3, 5 + `rewards-schema.int-spec.ts` (частичный индекс) |
| 3 | Непредсказуемость: randomInt над node:crypto, границы, sanity | ✅ | `app-runtime.service.ts:2,126` (единственный источник — node:crypto); lint-запрет `Math.random` в `packages/app-*` + живой probe guardrails; `app-runtime.int-spec.ts` «ctx.randomInt» (границы/покрытие множества; равномерность не ассертится — deferred, не гейт) |
| 4 | Eligibility verified/guests_allowed (REQ-RWD-014) | ✅ (с открытым отклонением C-9.1 — владельцу) | `lottery-handlers.ts:45-47` (фильтр пула), `lottery.e2e` сценарий 4 (verified → детерминированно REGISTERED; guests_allowed — контроль сценарием 1). **Отклонение:** дефолт `guests_allowed` по проводу недостижим (клиент обязан передать settings явно) — см. §6 |
| 5 | Приостановка TTL при открытой AWARDED (REQ-RWD-013) | ✅ | `guest-sweep.int-spec.ts` 4 кейса (анонимизация + отзыв сессий; REGISTERED не тронут; без гардов приостановки нет — REQ-RWD-001; открытая AWARDED → не анонимизируется, после fulfill/revoke — следующим проходом) |
| 6 | REQ-RWD-009 (AWARDED при COMPLETED, fulfill/revoke после завершения) | ✅ | `lottery.e2e` сценарий 6 (COMPLETED → список AWARDED → fulfill 200) + `rewards.controller.int-spec.ts`; revoke после COMPLETED — тот же код-путь (deferred, не гейт) |
| 7 | Границы и контракт: boundary, capability-гейт, visibility ceiling, PII, автотест индекса | ✅ | boundary `rewards-only-through-di-tokens` + probe (Task 11); `app-runtime.int-spec.ts:538-565` (эффекты без capability / без исполнителя → CAPABILITY_UNAVAILABLE); `lottery.e2e` сценарий 7 (publish-гейты); PII-ассерты `quiz-points.e2e-spec.ts` (весь лог), `lottery.e2e` сценарий 1, `rewards.int-spec.ts:102`; автотест частичного индекса `rewards-schema.int-spec.ts:19-86` (REQ-DEV-006) |
| 8 | Квиз-начисления: ledger сходится с табло; v1-гейт | ✅ (строка скорректирована по ruling E-13.1) | `quiz-points.e2e-spec.ts` тест 1 (3 гранта, суммы ledger ≡ суммы awarded из reveal, идемпотентность ROUND_NOT_OPEN, PII); **v1-гейт:** тест 2 — configure с пином quiz@1 отклоняется `APP_MANIFEST_UNKNOWN` (fail-closed REQ-CORE-007; цель «v1 не получает новое поведение» достигнута на более раннем гейте, чем скетч плана); MODULE_UNAVAILABLE на publish покрыт `app-runtime.int-spec.ts:339` кейсом 4 |

## 2. Объём ф.3 по строке §5 пакета

| Пункт | Вердикт | Артефакт |
|---|---|---|
| Модуль rewards: призы и начисления (REQ-RWD-001…005, 007, 009…014) | ✅ | `packages/core/src/rewards/` (Prize/Award/PointsGrant, схема `rewards`); REST-контур организатора; эффекты в tx коммита; ядро независимо от rewards — DI-токены + boundary |
| Очное вручение и отзыв (автомат AWARDED → FULFILLED \| REVOKED) | ✅ | условные UPDATE `rewards.service.ts:130-156`; идемпотентные переходы; CLAIMED отсутствует (ADR-007) |
| Лотерея с CSPRNG-розыгрышем и eligibility | ✅ | `packages/app-lottery` (draw.run/draw.completed, randomInt из ctx, пул PARTICIPANT, verified-фильтр); e2e 7 сценариев |
| Перевод квиза на начисления rewards | ✅ | quiz@2 (`QUIZ_MANIFEST_VERSION = 2`, capability rewards, эффекты award.points при question.closed); сходимость — критерий 8 |
| Догоняющий TTL-свип гостей с приостановкой | ✅ | `GuestSweepService` + `IdentitySweepModule` в composition root; гард `RewardsAnonymizationGuard`; REQ-ID-003/014 |
| Заочные награды / верифицируемый розыгрыш (REQ-RWD-006/008/012) | ➖ | Отложенная фаза (ADR-007/010) — вне объёма; схема данных им не препятствует |

## 3. Требования из Global Constraints плана (сверка Stage 1 финального ревью)

Полная таблица с file:line-доказательствами — в отчёте финального ревью (леджер `batch-e-final-review`). Итог: **confirmed** по всем группам — REQ-RWD-001/002a/002b/003/004/005/007/009/010/011/013/014, REQ-ID-003/014, REQ-CTR-002 (расширенная трактовка randomInt/drawPool — санкционирована дизайном §2/§8, не дрейф), REQ-CTR-004/005, REQ-CORE-004, REQ-SEC-009, REQ-RT-004, REQ-DEV-006, REQ-OPS-005. Поперечные швы подтверждены end-to-end: effects flow (эффекты ДО коммитов в одной `outbox.run`, отказ эффекта откатывает события), core-independence (boundary + probe, импортёры rewards — только barrel и 2 int-спека), сходимость табло↔ledger (один источник `awarded` в `quiz-handlers.ts:111-128` + e2e-сверка), DB-инварианты (CHECK + ограниченный декремент; частичный индекс + ON CONFLICT DO NOTHING без отравления tx).

## 4. Санкционированные отклонения среза (все прошли ревью; полный журнал — леджер SDD)

1. **10 интерпретаций плана** (зафиксированы в его Self-review при написании, подтверждены владельцем) — включая re-emit прежнего `draw.completed` на повтор `drawId`, uppercase `AwardStatus` без `@map`, порядок insert→декремент в awardPrize, cross-переход → REWARD_ALREADY_RESOLVED, отсутствие события у `award.points`, гард-чек приостановки внутри tx свипа.
2. **Rulings батча C:** C-8.1 (окно гонки свипа — принятый риск MVP, честный комментарий `guest-sweep.service.ts:22-29`); C-F.1 (carve-out int-spec из boundary-правила — спеки миниатюры composition root); C-9.1 эскалирован владельцу (§6).
3. **Rulings батча D:** D-10.1 (drawPool на горячем пути answer.submitted — принято осознанно); D-pre.2 (e2e verified — один детерминированный розыгрыш); D-12.1 (registered-участник сидится на уровне БД — HTTP registered-join отсутствует); D-12.2 эскалирован владельцу (§6).
4. **Rulings батча E:** E-pre.1 (TRUNCATE e2e явно += rewards."Award"/"Prize"/"PointsGrant"); **E-13.1** (скетч теста 2 «publish → MODULE_UNAVAILABLE на quiz@1-пине» недостижим — configure/activate fail-closed, REQ-CORE-007; заменён ассертом `APP_MANIFEST_UNKNOWN` на configure; MODULE_UNAVAILABLE покрыт int-кейсом 4; строка критерия 8 скорректирована).
5. **Fix-wave батча B** (`c886013`): no-op дубля награды переведён на `INSERT … ON CONFLICT … DO NOTHING` — catch unique-violation внутри tx отравлял её (Postgres aborted-tx ловушка F1).

## 5. Deferred minors (триаж финального целосрезового ревью)

**Must-fix-before-phase-close: ни одного.** Все deferred-миноры батчей A–E (28 строк леджера) — stay-deferred: косметика, покрытие nice-to-have с компенсацией на другом уровне, или вопросы уровня владельца. Два пункта закрыты по ходу среза (B/T6-1 — fix-wave батча B; C/T9-h — lint-правило Math.random подтверждено Task 11). Полная таблица триажа с обоснованиями — в отчёте финального ревью (леджер). Кандидаты-заделы для будущих фаз: ленивый accessor drawPool (C/T7-b), батчинг выборки свипа (C/T8-d), статистическая равномерность randomInt (по духу §7.3), guest-scope гард транспорта RewardsController (B/T6-2, defense-in-depth).

## 6. Открытые вопросы владельцу (эскалированы срезом, НЕ решены — не гейтят закрытие фазы, желательны до/на старте ф.4)

1. **C-9.1 (REQ-RWD-014):** defaulted-поле appSettings недостижимо через configure — `z.toJSONSchema` в output-режиме делает defaulted ключ required в JSON Schema-артефакте, гейт verdict-only → `{}` отклоняется. Fail-closed, безопасно, но «значение по умолчанию guests_allowed» по проводу = «клиент обязан передать явно». Развилки: `io: 'input'` в toRegisteredSchema (SDK) ИЛИ применение дефолтов ядром — обе задевают принятый контракт SDK 1.6.0.
2. **Свипнутый гость остаётся в drawPool:** `listActiveParticipantPool` не фильтрует `identity.deletedAt` → TTL-истёкший гость может выиграть (окно: розыгрыш >25ч после join; фонд восстановим revoke'ом).
3. **D-12.2 (revoke vs winner-exclusion):** частичный индекс разрешает re-award после REVOKE, но редьюсер лотереи не забывает draw.completed → отозванный победитель навсегда вне пула этого приза. Текущее поведение fail-safe (двойной выигрыш одного лица невозможен) — подтвердить продуктово.
4. **Окно гонки свипа (C-8.1, принятый риск MVP):** award, закоммиченный между гард-чеком и коммитом свипа, не увиден (гард читает вне tx). Закрытие — design-level (tx-aware гард / serializable+retry), кандидат на ф.4.
5. **Шов registered-join по HTTP отсутствует (D-12.1):** JoinController игнорирует Authorization и всегда создаёт GUEST — продуктовый вопрос (как registered играют в MVP); e2e registered-сценарии сидят membership на уровне БД.

## 7. Вердикт

**Фаза 3 (Rewards + Lottery + TTL-свип + квиз-начисления) закрыта.** Все 8 критериев выхода design §7 (= строке §5 пакета) подтверждены артефактами; объёмная строка закрыта (заочные награды — отложенная фаза по ADR-007/010); Stage 1/Stage 2 финального целосрезового ревью чистые (0 Critical / 0 Important, must-fix нет); конвейер зелёный. Открытые вопросы §6 — решения владельца, не код-дефекты; все текущие поведения fail-closed/fail-safe и запинаны тестами.

**Гейты над фазами не изменились:** юрист (до реальных PII/призов) и первое живое событие — действия вне агента. Push на origin — отдельное решение владельца.
