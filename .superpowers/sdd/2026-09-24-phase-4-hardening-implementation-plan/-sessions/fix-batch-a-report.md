# Отчёт: fix-волна батча A (ф.4 харднинг) — C-8.1, амендмент 2026-09-25

**Дата:** 2026-09-25
**Worktree:** `.worktrees/phase-4-hardening`, ветка `phase-4-hardening` (база HEAD `3b6e190`)
**Бриф:** `-sessions/fix-batch-a-brief.md`; первоисточник — амендмент в конце `docs/sessions/2026-09-24-phase-4-hardening-design.md`
**Статус:** DONE

## Коммиты

1. `cc5eec9` — `fix(rewards): award-гарда C-8.1 — блокирующее чтение FOR NO KEY UPDATE (амендмент 2026-09-25)` (пункты 1–2: фикс + детерминированный тест)
2. `1f390d3` — `docs(core): фактический механизм сериализации C-8.1 в комментариях + восстановленные rationale свипа` (пункты 3–4)

## Пункт 2 (TDD, выполнен первым): детерминированный тест interleaving'а

**Файл:** `packages/core/src/rewards/rewards.int-spec.ts:120-189` (новый `it` «гонка: «свип» держит блокировку identity — …» в существующем describe, рядом с swept-тестом на строке 105; добавлен импорт `type { Prisma }`).

Сценарий — по брифу, без sleep'ов, барьеры на промисах:

1. Гость/комната/приз — существующие хелперы `seedPrize(1)` / `guest()` / `prizeEffect(...)`.
2. tx-«свип»: `db.prisma.$transaction(async (tx) => { await tx.identity.update(... deletedAt ...); markAnonymized(); await sweepBarrier; })` — держит `FOR NO KEY UPDATE` на строке identity до разрешения барьера.
3. `await anonymizedInTx` → запуск реального `executeEffects(award.prize)` через `outbox.run` (образец — строка 112 в старой нумерации).
4. `releaseSweep()` → «свип» коммитится.
5. Ассерты: `awardRun` rejects `{ code: 'IDENTITY_ANONYMIZED' }`; `Award` = 0; `prize.quantity` = 1.

**Проблема детерминизма и решение (tx-прокси).** Буквальная схема «запустить award и сразу разрешить барьер» недетерминирована на старом коде: неблокирующий `findUnique` гарды гоняется с COMMIT «свипа» (несколько round-trip против одного) — гард мог прочитать уже после коммита, и тест был бы ложно зелёным. Поэтому чтение гарды обёрнуто tx-прокси (`gateTx`), который перехватывает обе формы гарды и даёт тесту точку синхронизации «контакт с гардой произошёл, пока «свип» на барьере»:

- `identity.findUnique` (старый код) — сигнал ПОСЛЕ чтения + парковка на `guardGate`: stale-чтение `deletedAt NULL` захвачено детерминированно, пока «свип» держит блокировку; дальше путь award ни с чем не конфликтует (FK-проверка `FOR KEY SHARE` не конфликтует с `FOR NO KEY UPDATE` — ровно находка амендмента) → award коммитится → RED.
- `$queryRaw … FOR NO KEY UPDATE` (новый код) — сигнал ДО вызова, без парковки: дальше чтение реально блокируется в Postgres до коммита «свипа» (блокировка гарантированно взята — `markAnonymized()` после await update, award запущен после `anonymizedInTx`) и перечитывает строку по EPQ → GREEN.

Дедлок исключён: на новом коде `$queryRaw` ждёт только COMMIT «свипа», а `releaseSweep()` вызывается безусловно после `guardContact`; парковка (`guardGate`) стоит только на неблокирующей ветке. Post-гейт на `$queryRaw` сознательно не ставился — на новом коде он дедлочил бы тест (чтение завершается только после коммита «свипа»).

## Пункт 1: гард в `awardPrize` → блокирующее чтение

**Файл:** `packages/core/src/rewards/rewards.service.ts:74-87`.

Неблокирующий `tx.identity.findUnique({ where: { id: winnerId }, select: { deletedAt: true } })` заменён на блокирующее чтение в той же tx, до INSERT — дословно по брифу:

```ts
const winnerRows = await tx.$queryRaw<{ deletedAt: Date | null }[]>`
  SELECT "deletedAt" FROM identity."Identity" WHERE id = ${winnerId} FOR NO KEY UPDATE`;
if (winnerRows.length === 0 || winnerRows[0].deletedAt !== null) {
  throw new IdentityAnonymizedError(winnerId);
}
```

Семантика findUnique сохранена: 0 строк или `deletedAt !== null` → `IdentityAnonymizedError(winnerId)`; поведение отказа и HTTP-маппинг (409) не менялись. Дедуп `INSERT ... ON CONFLICT DO NOTHING` (REQ-RWD-003) не тронут — гард остаётся до INSERT; `award.points` по-прежнему вне гарды; serializable не вводился; исключения внутри tx не ловятся. SDK, схема БД, миграции не менялись.

## Пункт 3: поправка lock-режимов в комментариях

- `packages/core/src/rewards/rewards.service.ts:74-82` — комментарий гарды переписан: убрано «FK-проверка Award берёт FOR KEY SHARE и конфликтует»; описан фактический механизм (блокирующее чтение `FOR NO KEY UPDATE`, конфликт режима с самим собой на строке identity, READ COMMITTED EPQ перечитывает строку после ожидания; FK-проверка в механизме не участвует).
- `packages/core/src/identity/guest-sweep.service.ts:31-40` — блок C-8.1 переписан тем же образом: сериализацию обеспечивает блокирующее чтение award-гарды (`FOR NO KEY UPDATE` ≡ режим `updateMany` свипа; кто первым взял блокировку, тот выиграл); FK-проверка `FOR KEY SHARE` не конфликтует с `FOR NO KEY UPDATE` и не участвует.

## Пункт 4: восстановленные rationale в guest-sweep.service.ts

Формулировки восстановлены из диффа Task 2 (`git show 6e4a80c` — они там видны как удалённые):

- **(а)** Прецедент отзыва сессий — перед `tx.session.updateMany` (строки 65-67): «Отзыв живых сессий гостя — по прецеденту среза исключения (membership.service.ts:147-153). Сессия гостя под приостановкой истекает по своему капу как обычно (design §5) — здесь её нет.» **Отклонение от брифа:** ссылка на строки обновлена `118-123` → `147-153` — в брифе и исходном комментарии номера от коммита `158d85b`; проверил оба среза, в текущем файле блок отзыва сессий в `exclude` — строки 147-153. Код не менялся.
- **(б)** Rationale `deletedAt: null` в `updateMany.where` (строки 59-61): вторая линия защиты от гонки с ручным исключением (concurrent exclusion мог успеть soft-delete'нуть между выборкой кандидатов и updateMany). Поставлен инлайн у `where` (в оригинале был в шапке метода) — ближе к коду, который мотивирует.

## Подтверждение RED → GREEN

**RED (старый код, до пункта 1)** — `pnpm --filter @mymozhem/core test:int -- rewards.int-spec -t "гонка"`:

```
● RewardsService (int) › гонка: «свип» держит блокировку identity — …
  expect(received).rejects.toMatchObject()
  Received promise resolved instead of rejected
  Resolved to value: undefined
Tests: 1 failed, 8 passed, 9 total
```

Award коммитился, пока «свип» держал блокировку на барьере — гонка воспроизведена детерминированно (не флаки: структура теста гарантирует stale-чтение до коммита «свипа»).

**GREEN (после пункта 1)** — полный файл, 9/9 passed, включая гоночный тест. Гоночный тест прогнан **5 раз** (1 в составе первого зелёного прогона + 4 повторных): все зелёные, 11–17 мс.

## Гейты

1. `pnpm --filter @mymozhem/core test:int -- rewards.int-spec` — 5 прогонов, каждый `Tests: 9 passed, 9 total`.
2. `pnpm --filter @mymozhem/core test:int -- guest-sweep.int-spec` — `Tests: 5 passed, 5 total` (комментарии поведение не меняли).
3. `pnpm --filter @mymozhem/core build` — чисто; `pnpm --filter @mymozhem/core lint` — чисто.
4. `pnpm --filter @mymozhem/core typecheck` (`tsc --noEmit`) — чисто.

Docker: testcontainers поднялся без `DOCKER_HOST`-override (сокет починен владельцем).

## Отклонения от брифа

1. **Ссылка на строки в восстановленном комментарии (а):** `membership.service.ts:118-123` → `147-153` (актуальные строки блока отзыва сессий в `exclude`; старые номера — от коммита `158d85b`, файл вырос).
2. **Синхронизация теста усилена tx-прокси** поверх чистых барьеров из брифа — иначе RED на старом коде был недетерминирован (см. пункт 2). Это реализация требования брифа «гарда должна читать до коммита «свипа»», а не изменение сценария: реальный `executeEffects` через `outbox.run`, реальная блокировка Postgres на новом коде.

## Concerns

Нет блокирующих. Замечание для ревьюера: tx-прокси в тесте перехватывает `identity.findUnique` и `$queryRaw` целиком в рамках tx — если в `awardPrize` позже появятся другие такие вызовы до гарды, точка синхронизации сместится (тест начнёт падать/виснуть — сигнал заметный, не молчаливый).
