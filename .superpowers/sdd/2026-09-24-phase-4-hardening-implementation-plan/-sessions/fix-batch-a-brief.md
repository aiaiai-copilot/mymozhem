# Fix-волна батча A (ф.4 харднинг) — бриф

**Контекст:** батч A ф.4 исполнен (Tasks 1–3), финревью вскрыло остаточную гонку C-8.1 и фактическую ошибку lock-режимов в дизайне §4. Владелец принял вариант (а) — амендмент дизайна с блокирующим чтением. Этот бриф — твои требования; первоисточник — амендмент в конце `docs/sessions/2026-09-24-phase-4-hardening-design.md` (раздел «Амендмент 2026-09-25», читать целиком, включая пункты «Что вскрыла реализация»).

**Рабочая директория:** worktree `.worktrees/phase-4-hardening` (ветка `phase-4-hardening`, HEAD `3b6e190`). `.env` и prisma client на месте. Все команды — из корня worktree.

**Env:** docker.sock починен владельцем (commit `fc90555` на main) — override `DOCKER_HOST` больше НЕ нужен. Только если testcontainers упадёт с «Could not find a working container runtime strategy» — fallback `DOCKER_HOST=unix:///Users/alexanderlapygin/.orbstack/run/docker.sock`.

## Состав fix-волны (4 пункта)

### 1. Гард в `awardPrize` → блокирующее чтение (TDD: RED сперва)

Файл: `packages/core/src/rewards/rewards.service.ts` (сейчас строки ~74–81: `tx.identity.findUnique({ where: { id: winnerId }, select: { deletedAt: true } })` + throw `IdentityAnonymizedError`).

Заменить неблокирующее чтение на блокирующее **в той же tx, до INSERT**:

```sql
SELECT "deletedAt" FROM identity."Identity" WHERE id = $1 FOR NO KEY UPDATE
```

через `tx.$queryRaw` (template-literal форма Prisma: `` tx.$queryRaw<…>`SELECT "deletedAt" FROM identity."Identity" WHERE id = ${winnerId} FOR NO KEY UPDATE` ``). Результат — массив из 0 или 1 строки; семантика та же, что у findUnique: строка не найдена или `deletedAt !== null` → `IdentityAnonymizedError(winnerId)`. Поведение отказа и HTTP-маппинг (409) не меняются.

Порядок TDD: сначала пункт 2 (новый тест — RED на старом коде), потом этот фикс → GREEN.

### 2. Детерминированный тест interleaving'а в `packages/core/src/rewards/rewards.int-spec.ts`

Новый `it` в существующем describe (рядом с тестом на строке 105). Сценарий (без sleep'ов — барьеры на промисах):

1. Поднять гостя, комнату, приз (существующие хелперы файла: `guest()`, `prizeEffect(...)` — см. тест на строке 105 как образец).
2. **tx-«свип»**: открыть `db.prisma.$transaction(async (tx) => { … })`, внутри выполнить `tx.identity.update` (или `updateMany`) — выставить `deletedAt` гостю (анонимизация), затем ждать барьер (deferred-промис, который тест разрешит позже) — tx держит блокировку `FOR NO KEY UPDATE` на строке identity.
3. Дождаться, что tx-«свип» дошёл до барьера (второй deferred/флаг), затем запустить параллельно **реальный** `executeEffects(award.prize)` через `outbox.run` — по образцу строки 112. Он должен заблокироваться на блокирующем чтении гарды.
4. Разрешить барьер → «свип» коммитится.
5. Ассерты: `executeEffects` rejects с `{ code: 'IDENTITY_ANONYMIZED' }`; количество `Award` не изменилось; `prize.quantity` не изменился (фонд не списан).

**Критично:** на старом коде (неблокирующий findUnique) тест обязан быть RED — гард прочитает `deletedAt NULL` до коммита «свипа», insert пройдёт. Проверь RED **до** применения пункта 1 (временно, затем фикс → GREEN). Если тест случайно зелёный на старом коде — он не воспроизводит гонку, переделай синхронизацию (гарда должна читать до коммита «свипа»: на неблокирующем чтении она проходит сразу, пока «свип» на барьере).

Внимание на порядок: «свип» держит блокировку с момента `update`, так что блокирующая гарда будет ждать — убедись, что тест не дедлочится навечно (jest-таймаут покрывает; при зависании ищи ошибку в синхронизации).

### 3. Поправка lock-режимов в комментариях (фактический механизм)

- `packages/core/src/identity/guest-sweep.service.ts` — блок C-8.1 (~строки 32–36): сейчас говорит, что FK-проверка Award берёт `FOR KEY SHARE` и конфликтует с `updateMany` свипа. **Это неверно** (FOR KEY SHARE конфликтует только с FOR UPDATE). Переписать на фактический механизм: сериализацию обеспечивает блокирующее чтение award-гарды (`FOR NO KEY UPDATE` ≡ режим `updateMany` свипа — режим конфликтует сам с собой на строке identity; кто первым взял блокировку, тот выиграл). FK-проверка в механизме не участвует.
- `packages/core/src/rewards/rewards.service.ts` — комментарий у гарды (~строки 74–78): то же — убрать «FK-проверка берёт FOR KEY SHARE и конфликтует», описать фактический механизм (блокирующее чтение FOR NO KEY UPDATE, конфликт режима с самим собой, READ COMMITTED EPQ перечитывает строку после ожидания).

Тон комментариев — как в окружающем коде (русский, rationale-стиль).

### 4. Восстановить 2 rationale-комментария в `guest-sweep.service.ts` (must-fix триажа)

Выпали при правках Task 2; код не менять, только мотивировка:

- **(а)** Прецедент отзыва сессий: в блоке про отзыв живых сессий внутри tx свипа — указать прецедент `membership.service.ts:118-123` (отзыв сессий при исключении) и rationale: кап сессии приостановленного гостя.
- **(б)** Rationale `deletedAt: null` в `updateMany.where` (~строка 56): вторая линия защиты от гонки с ручным исключением (concurrent exclusion мог успеть soft-delete'нуть между выборкой кандидатов и updateMany).

Если точная формулировка прецедента не очевидна — прочти `packages/core/src/membership/membership.service.ts:110-130` и перескажи корректно.

## Глобальные констрейнты (обязательны)

- **TDD:** пункт 2 первым (RED на старом коде — подтверди красноту), затем пункт 1 (GREEN). Пункты 3–4 — комментарии, тестами не гоняются, но прогони лану после всех правок.
- **Дедуп `INSERT ... ON CONFLICT DO NOTHING` (REQ-RWD-003) не трогать** — гард остаётся до INSERT; сетевой повтор по-прежнему no-op до декремента.
- **`award.points` остаётся сознательно вне гарды** — не добавляй.
- **Serializable не вводить.** Горячий путь dispatch меняется только этим одним SELECT'ом.
- **In-tx catch ловушка (25P02):** не лови исключения внутри транзакции — aborted-tx отравляет все последующие операторы.
- **Prisma 7.8 adapter-pg:** `$queryRaw` не десериализует void-выражения (не наш случай, но помни); `$queryRaw` возвращает сырые DB-значения.
- **После правок SDK — `pnpm --filter @mymozhem/sdk build`** (здесь SDK не трогаем, не нужно).
- SDK, схема БД, миграции — не менять.

## Гейты (прогнать и показать вывод)

1. `pnpm --filter @mymozhem/core test:int -- rewards.int-spec` — зелёно (включая новый гоночный тест; прогони 3–5 раз для стабильности).
2. `pnpm --filter @mymozhem/core test:int -- guest-sweep.int-spec` — зелёно (комментарии не сломали, поведение не менялось).
3. `pnpm --filter @mymozhem/core build` и `pnpm --filter @mymozhem/core lint` (или общий линт, если так настроено) — зелёно.
4. Type-check затронутых пакетов.

## Отчёт

Пиши полный отчёт в файл: `/Users/alexanderlapygin/Projects/mymozhem/.superpowers/sdd/2026-09-24-phase-4-hardening-implementation-plan/-sessions/fix-batch-a-report.md`

В отчёте: что изменено по каждому из 4 пунктов (файл:строки), подтверждение RED→GREEN (вывод красного прогона на старом коде и зелёного после), вывод всех гейтов, сколько раз прогнан гоночный тест, любые отклонения от брифа и почему.

Верни кратко: статус (DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT), список коммитов, однострочный итог тестов, concerns.
