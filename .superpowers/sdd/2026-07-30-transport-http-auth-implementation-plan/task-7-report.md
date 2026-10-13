# Task 7 Report: HttpExceptionFilter — типизированные ошибки наружу (REQ-SEC-006)

**Status:** DONE
**Commit:** `4853742` — `feat(core): global HTTP exception filter with typed wire codes (REQ-SEC-006)`
**Branch:** `phase-1-transport-http-auth`

## What was done

Created the single error-mapping point of the transport slice, per brief:

- `packages/core/src/transport/http-exception.filter.ts` — `@Catch()` global filter implementing
  `ExceptionFilter`. Mapping per design §5 / brief table:
  - `MembershipError` `ROOM_JOIN_DENIED` → 403 `ROOM_JOIN_DENIED`
  - `MembershipError` `JOIN_RATE_LIMITED` → 429 `RATE_LIMITED` (wire-код отличается от core-кода — design §0.6)
  - `MembershipError` `ROOM_PARTICIPANT_LIMIT_REACHED` → 409 `ROOM_PARTICIPANT_LIMIT_REACHED`
  - `AuthError` (любой) → 401 `SESSION_INVALID`
  - `ZodError` → 400 `REQUEST_INVALID`
  - `Prisma.PrismaClientKnownRequestError` (любой P-код, вкл. P2010/22P02 uuid-сырьё, parked minor) → 400 `REQUEST_INVALID`
  - Nest `HttpException` → его status, `REQUEST_INVALID` (4xx) / `INTERNAL_ERROR` (5xx)
  - всё прочее → 500 `INTERNAL_ERROR`
  - Наружу ровно `{code}` (REQ-SEC-006); 5xx логируется целиком через `Logger.error`.
- `packages/core/src/transport/http-exception.filter.spec.ts` — 11 unit-тестов: вся таблица
  маппинга (it.each), отдельные кейсы Prisma-сырья, Nest HttpException 404/503, инвариант
  REQ-SEC-006 (body ровно `{code}`, сериализованное тело не содержит internals/SQLSTATE),
  логирование 5xx и не-логирование 4xx. Фильтр тестируется без Nest — мок `ArgumentsHost`.

Регистрация через `APP_FILTER` НЕ делалась — это Task 8, как указано.

## Deviations from brief (with reasons)

1. **Нет `import type { FastifyReply } from 'fastify'`.** Brief предполагал, что fastify-типы
   доступны в core через platform-fastify — проверено: НЕТ. `@nestjs/platform-fastify` и
   `fastify` — зависимости только `apps/server`; в `packages/core/node_modules` fastify
   отсутствует, импорт не резолвится (pnpm-изоляция), а новые зависимости запрещены.
   Решение (предусмотрено brief'ом): локальный структурный интерфейс `ReplyLike`
   (`status(code) → { send(body) }`), с комментарием в коде. FastifyReply совместим по форме.
2. **HttpException сохраняет свой status, а не статус из `STATUS_BY_WIRE_CODE`.** В brief
   таблица («его status», строка HttpException) и код-скетч (`STATUS_BY_WIRE_CODE[code]` →
   всегда 400/500) противоречат. Взял таблицу — это нормативная формулировка маппинга
   (также в плане строка 852), и 404 неизвестного роута семантически должен остаться 404.
   Покрыто тестами: 404 → status 404 + `REQUEST_INVALID`; 503 → status 503 + `INTERNAL_ERROR`.
3. **Prisma-конструктор без `as never`.** Сверено с `@prisma/client@7.8.0`
   (`@prisma/client-runtime-utils`): конструктор публичный,
   `constructor(message, { code, clientVersion, meta?, batchRequestIdx? })`. Проверен и в
   runtime (`new Prisma.PrismaClientKnownRequestError(...)` + `instanceof` работают).
   Fallback через `Object.create` не понадобился.
4. **Дополнения к spec поверх brief'а:** кейсы Nest HttpException 404/503 (строка таблицы
   brief'а без примера кода) и пара тестов на `Logger.error` (5xx логируется, 4xx — нет;
   `Logger.prototype.error` заглушен spy'ем на весь сьют, чтобы 5xx-кейсы не печатали
   stack в консоль jest).

## Test commands + output tails

Red (Step 2):
```
$ pnpm test -t HttpExceptionFilter
error TS2307: Cannot find module './http-exception.filter' ...
Test Suites: 1 failed, 8 skipped
```

Green (Step 4):
```
$ pnpm test -t HttpExceptionFilter
PASS src/transport/http-exception.filter.spec.ts
Tests: 96 skipped, 11 passed, 107 total

$ pnpm test   (полный unit-сьют core)
Test Suites: 9 passed, 9 total
Tests: 107 passed, 107 total

$ pnpm typecheck   → clean (tsc --noEmit, no output)
$ pnpm lint        → clean (eslint src, no output)
```

## Self-review

- **Spec-compliance (REQ-SEC-006, REQ-ID-013, parked minor uuid):** наружу только `{code}` —
  `expect(body).toEqual({ code })` в каждом кейсе + негативные проверки на утечку
  `sensitive internals` / `22P02`. MembershipError-коды сколлапсированы core'ом (REQ-ID-013) —
  фильтр их не расклеивает. uuid-сырьё (P2010/22P02) типизируется в `REQUEST_INVALID` —
  parked minor закрыт строкой фильтра, как зафиксировано в design §6.
- **Границы (ADR-002):** фильтр импортирует только core-internal errors, zod, @prisma/client,
  @nestjs/common — всё внутри модуля core; SDK не трогал; fastify-зависимости в core не
  появилось (boundary-check не сломан).
- **Качество:** стиль комментариев/REQ-цитат соответствует соседним файлам
  (`membership.errors.ts`, `join-rate-limiter.spec.ts`); `ReplyLike` задокументирован;
  ветка HttpException покрыта обоими статус-классами.
- **Не в scope (осознанно):** регистрация `APP_FILTER` (Task 8); `ContractError` из SDK
  упомянут в Consumes brief'а, но ни в таблице маппинга, ни в коде-скетче отдельной ветки
  для него нет — не добавлял (открытый вопрос для Task 8, если ContractError реально
  вылетает из контроллеров: сейчас он упал бы в ветку `всё прочее` → 500 `INTERNAL_ERROR`).

## Concerns for next tasks

- Task 8: если контроллеры будут бросать `ContractError` (SDK), решить, нужна ли отдельная
  ветка в фильтре (сейчас → 500 `INTERNAL_ERROR`). Refresh rate-limit бросается как
  `JoinRateLimitedError` (план, task 8) — уже корректно маппится в 429 `RATE_LIMITED`.
- При регистрации через `APP_FILTER` убедиться, что fastify-адаптер реально отдаёт
  reply с `status().send()` — структурный `ReplyLike` это предполагает (стандартный
  FastifyReply API).
