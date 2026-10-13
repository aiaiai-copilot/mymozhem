# Task 7 — API-клиент (`src/api/`) для apps/web — отчёт

## Что реализовано

Ровно по brief, четыре модуля + spec:

- `apps/web/src/api/api-error.ts` — `ApiError { code: string; status: number }`. Код НЕ сверяется с `CONTRACT_ERROR_CODES`: клиент прозрачен для неизвестных wire-кодов (static-режим отдаёт `NOT_FOUND` вне enum'а), generic-бакетинг оставлен слоям выше — зафиксировано в комментарии.
- `apps/web/src/api/token-provider.ts` — интерфейс `TokenProvider { getAccessToken(): string | null; refresh(): Promise<void> }` (реализация — SessionStore, Task 10).
- `apps/web/src/api/api-client.ts` — `ApiClient.call<S extends z.ZodType>(req): Promise<z.output<S>>` по форме brief: zod-парсинг ответа fail-loud; `credentials: 'same-origin'`; 401 → один `refresh()` → один retry через флаг `allowRetry` (повторный 401 → `ApiError`, цикла нет — Review Focus 4); тело ошибки не-JSON → `{}` → код `HTTP_<status>`.
- `apps/web/src/api/endpoints.ts` — все 14 обёрток: `joinRoom` (POST /rooms/join, auth:false), `refreshSession` (POST /auth/refresh, auth:false), `createRoom` (POST /rooms), `configureRoom`/`activateRoom`/`completeRoom`/`cancelRoom` (POST /rooms/:id/..., схема `createRoomResponseSchema` — так парсит сервер через `toRoomResponse`), `listMembers` (GET /rooms/:id/members), `listPrizes` (GET), `createPrize` (POST), `listRewards` (GET /rooms/:id/rewards), `fulfillAward`/`revokeAward` (POST /rooms/:id/awards/:awardId/...), `excludeMember` (POST /rooms/:id/members/:identityId/exclude, `reason` опционален — сервер парсит `body ?? {}`).

## Сверка с фактическим контрактом

- Пути сверены с контроллерами ядра: `packages/core/src/transport/{join,auth,rooms,rooms-lifecycle,members,exclude}.controller.ts`, `packages/core/src/rewards/rewards.controller.ts`. Путь исключения: `POST /rooms/:roomId/members/:identityId/exclude` (exclude.controller.ts:20).
- Все нужные схемы есть в SDK barrel и проверены в `packages/sdk/dist` (`tokenResponseSchema`, `rosterResponseSchema`, `createRoomResponseSchema`, `listPrizesResponseSchema`, `prizeResponseSchema`, `listRewardsResponseSchema`, `awardResponseSchema`, `excludeResponseSchema`) — dist актуален, пересборка не потребовалась.
- **Эндпоинтов без SDK response-схемы нет** — все 14 покрыты существующими схемами (lifecycle-ответы формой `createRoomResponseSchema` — это фактическое поведение сервера, не выдумка).

## Что протестировано (8 тестов, vitest, `vi.stubGlobal('fetch', ...)`)

Сьют ApiClient:
1. ok-ответ валидируется схемой, типизированный результат; `credentials: 'same-origin'`; Bearer-заголовок из TokenProvider.
2. Дрейф контракта → `ZodError` (fail-loud).
3. 401 → один refresh → один retry с НОВЫМ токеном (fetch ровно 2 раза, `refreshed === 1`, второй вызов с `Bearer new-token`).
4. Повторный 401 → `ApiError` со статусом 401, fetch ровно 2 раза — без бесконечного retry.
5. `{ code }` → `ApiError` с этим кодом; не-JSON тело 500 → `HTTP_500`.
6. **Неизвестные wire-коды проходят as-is** (доп. требование финревью батча 2): `NOT_FOUND` (404, static-режим) и произвольный `SOME_FUTURE_CODE` (422) доезжают без фильтрации/whitelist'а.
7. `auth:false` → нет `authorization`, нет refresh при 401, ровно один fetch.

Сьют endpoints: табличный тест — все 14 обёрток маппятся на метод/путь/схему контракта (schema identity против импортов из `@mymozhem/sdk`), `auth:false` у join/refresh, тело join доезжает as-is.

## TDD Evidence

**RED** — `pnpm --filter @mymozhem/web test` (после Step 1, до реализации):

```
FAIL  src/api/api-client.spec.ts [ src/api/api-client.spec.ts ]
Error: Cannot find module './api-client' imported from .../api-client.spec.ts
 Test Files  1 failed (1)
```

Ожидаемо: spec написан первым, модулей ещё нет — падает на резолве импортов.

**GREEN** — `pnpm --filter @mymozhem/web test` (после Step 3):

```
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

Гейты:
- `pnpm --filter @mymozhem/web lint` — чисто.
- `pnpm --filter @mymozhem/web typecheck` — чисто.
- `pnpm boundary-check` (depcruise) — `no dependency violations found (659 modules)`: импорты только `@mymozhem/sdk`, правила `web-only-through-sdk-and-app-packages` / `web-no-cross-app-imports` соблюдены.

## Изменённые файлы

- `apps/web/src/api/api-error.ts` (new)
- `apps/web/src/api/token-provider.ts` (new)
- `apps/web/src/api/api-client.ts` (new)
- `apps/web/src/api/endpoints.ts` (new)
- `apps/web/src/api/api-client.spec.ts` (new)

Новых зависимостей нет (zod и `@mymozhem/sdk` уже в apps/web, обе zod-инстанции 4.4.3 — конфликта типов нет).

## Self-review findings

- Полнота: все 14 endpoints, все 5 тест-кейсов brief + обязательный кейс неизвестных кодов — закрыто.
- YAGNI: ничего сверх brief (никаких query-параметров, перехватчиков, базовых URL — dev-proxy vite уже даёт same-origin).
- Тесты проверяют поведение (счётчики вызовов, заголовки, identity схем), а не моки ради моков; вывод тестов чистый, без warning'ов.
- `excludeMember` без `reason` шлёт вызов без тела — сервер это поддерживает (`body ?? {}` в ExcludeController:30); задокументировано в комментарии.
- Мелочь: в FakeTokens `refresh()` затирает токен на `tokenAfterRefresh` (null по умолчанию) — в тесте №4 это безразлично (второй 401 не зависит от токена), в тесте №3 это и есть сценарий.

## Issues / concerns

Нет. DONE.
