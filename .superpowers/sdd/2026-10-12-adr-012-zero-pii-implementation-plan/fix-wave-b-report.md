# Fix-wave B — отчёт по финревью батча B (ADR-012)

Worktree: `/Users/alexanderlapygin/Projects/mymozhem/.worktrees/adr-012-zero-pii`, ветка `adr-012-zero-pii`.
Base HEAD: `b9cf868`. Коммит fix-волны: `b05ba77fd986fe79b938dda872fd14d2fa42feff`.

## Finding 1 (Important, B-F.1) — удаление apps/server/scripts/create-room.mjs

**Проверка claim про PinoLogger — ПОДТВЕРЖДЁН.**
`packages/core/src/membership/membership.service.ts:35-43`: конструктор принимает 5 параметров, последний — `private readonly logger: PinoLogger`, и тело конструктора сразу вызывает `this.logger.setContext(MembershipService.name)`. Скрипт (старые строки 41-46) вызывал `new MembershipService(prisma, identity, new JoinRateLimiter(...), config)` — 4 аргумента, logger === undefined → падение с TypeError на `setContext` до любой работы с БД. Скрипт сломан независимо от ADR-012 (с коммита 934ae8b). Плюс скрипт создавал REGISTERED-identity с email (PII, устраняемое ADR-012) и на bootstrapped-инстансе упирался бы в partial index `Identity_single_registered_key` сырым P2002.

**Сделано:**
- `git rm apps/server/scripts/create-room.mjs`.
- Удалены script-записи: корневой `package.json` (`"create-room": "pnpm --filter @mymozhem/server run create-room"`) и `apps/server/package.json` (`"create-room": "node scripts/create-room.mjs"`). Форматирование обоих файлов сохранено (дифф минимальный, inline `"engines"` в корне восстановлен).
- Ссылки в README / docs/roadmap.md — отсутствуют (grep пуст), править нечего.
- `apps/server/scripts/e2e-web-seed.mjs`: три комментария ссылались на create-room.mjs как на живой паттерн (строки 16, 34, 41) — стали бы dead-pointer'ами после удаления; ссылки убраны из комментариев (сама логика seed-скрипта не тронута; его OAuth/TokenService-staleness — вне объёма этой волны).

**Нетронутые ссылки в docs/sessions/ (исторические документы сессий — правка отдельным решением):**
- `docs/sessions/2026-07-30-transport-http-auth-implementation-plan.md` (строки 1246-1314: создание скрипта, package.json-записи, usage)
- `docs/sessions/2026-07-30-transport-http-auth-design.md` (строки 76, 165)
- `docs/sessions/2026-08-05-realtime-read-handshake-implementation-plan.md` (строки 652, 1049, 1064)
- `docs/sessions/2026-09-23-ui-slice-implementation-plan.md` (строки 1186, 1188 — паттерн seed-скрипта)
- `docs/sessions/2026-09-02-oauth-implementation-plan.md` — упоминания `create-room-request.*` (SDK-контракт создания комнаты, НЕ этот скрипт) — не относятся к finding.

## Finding 2 (Important, B-F.2) — warn-log failed bootstrap в http-exception.filter

**RED (сначала тест):** добавлены два кейса в `packages/core/src/transport/http-exception.filter.spec.ts` (describe 'server logging'):
1. ContractError('ORGANIZER_SETUP_INVALID', …) → warn с `{requestId: 'req-1'}` и фиксированной строкой `'organizer setup token mismatch'`, error НЕ вызывается, wire остаётся `{code: 'ORGANIZER_SETUP_INVALID'}`.
2. Негативный пин: ContractError('PRIZE_UNKNOWN', …) → warn и error НЕ вызываются (blast radius warn-ветки — ровно ORGANIZER_SETUP_INVALID).

RED-прогон: `pnpm --filter @mymozhem/core test -- http-exception` → 1 failed / 32 passed («Number of calls: 0» у logger.warn) — как ожидалось.

**GREEN (реализация):** `packages/core/src/transport/http-exception.filter.ts` — в warn-ветку фильтра после ветки AuthError добавлено:
```ts
} else if (exception instanceof ContractError && exception.code === 'ORGANIZER_SETUP_INVALID') {
  // ADR-012: setup-токен — единственная креденшала инстанса … security-сигнал обязан
  // пережить {code}-only wire (REQ-SEC-006) … message фиксированная.
  this.logger.warn({ requestId }, 'organizer setup token mismatch');
}
```
requestId — по существующему паттерну ветки AuthError (`{ requestId }` из raw.id). Из запроса ничего не логируется.

GREEN-прогон: тот же фильтр-спек — 33 passed / 33 total.

## Finding 3 (Minor, B-F.3) — инвариант-комментарий «двух мест» → трёх

- `packages/core/src/identity/identity.service.ts:6-9` — комментарий переписан: предикат `kind='REGISTERED' AND deletedAt IS NULL` живёт в ТРЁХ местах: partial index `Identity_single_registered_key` (миграция), guarded create в `findOrCreateOrganizer` (T5), WHERE EXISTS в `RoomService.insertRoom` (REQ-ID-005); менять только вместе.
- `packages/core/src/room/room.service.ts:82-84` — комментарий `insertRoom` теперь называет те же три места; имя старого индекса `Identity_registered_email_key` из комментария убрано. Сам старый email-индекс в БД не трогали (намеренно оставлен).

## Finding 4 (Minor) — dead pointer в apps/server/test/jest-env-setup.ts:2

Комментарий ссылался на «bootstrap-smoke». Проверено: файл подключён через `setupFiles` в `apps/server/jest.config.js:6`; `apps/server/test/bootstrap.e2e-spec.ts:50-55` spawn'ит `dist/main.js` с `...process.env` — это фактический потребитель дефолта. Комментарий поправлен на «bootstrap.e2e-spec.ts отдаёт process.env потомку dist/main.js (setupFiles)».

## Прогоны (все зелёные)

| Команда | Итог |
|---|---|
| `pnpm --filter @mymozhem/core test -- http-exception` (RED) | 1 failed / 32 passed — ожидаемый RED |
| `pnpm --filter @mymozhem/core test -- http-exception` (GREEN) | 33 passed |
| `pnpm --filter @mymozhem/core test` | 20 suites, 224 passed |
| `pnpm --filter @mymozhem/core test:int` | 23 suites, 213 passed |
| `pnpm --filter @mymozhem/server test` | 9 suites, 63 passed + 1 skipped |
| `pnpm build` | 6/6 successful |
| `pnpm boundary-check` | no dependency violations (725 modules) |
| `pnpm guardrails` | All guardrails verified alive |
| `pnpm lint` | 6/6 successful |
| `pnpm typecheck` | 10/10 successful |

Санкционированного красного нет — всё зелёное.

## Коммит

`b05ba77fd986fe79b938dda872fd14d2fa42feff` — `fix(core,server): финревью батча B ADR-012 — warn-log отказов bootstrap (ORA-setup security-сигнал), удаление create-room.mjs (REGISTERED+email против ADR-012, сломан с 934ae8b), выравнивание инвариант-комментариев` (+ трейлер Co-Authored-By). 9 файлов, +40/−87.
