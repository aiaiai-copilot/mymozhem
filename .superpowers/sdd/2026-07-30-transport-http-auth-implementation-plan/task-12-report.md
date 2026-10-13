# Task 12 Report — Полные гейты + docker boot smoke

Date: 2026-07-30
Branch: `phase-1-transport-http-auth`
Executor: verification subagent (Steps 1–2 only; Step 3 HANDOFF is controller's)
Code changes: none. Nothing to commit.

---

## Step 1 — Гейты из корня репо

Все команды запускались из `/Users/alexanderlapygin/Projects/mymozhem` по одной (порядок как в брифе), каждая с exit code 0. Отклонений в именах скриптов нет — все семь существуют в root `package.json` как есть.

### 1. `pnpm build` — GREEN (exit 0)

```
@mymozhem/sdk:build: cache hit — tsc -p tsconfig.json
@mymozhem/core:build: cache hit — tsc -p tsconfig.json
@mymozhem/server:build: cache miss — tsc -p tsconfig.json
Tasks: 3 successful, 3 total
```

### 2. `pnpm lint` — GREEN (exit 0)

```
@mymozhem/sdk:lint: $ eslint src
@mymozhem/server:lint: $ eslint src
@mymozhem/core:lint: $ eslint src
Tasks: 3 successful, 3 total
```

### 3. `pnpm typecheck` — GREEN (exit 0)

```
sdk/core/server: $ tsc -p tsconfig.json --noEmit
Tasks: 5 successful, 5 total
```

### 4. `pnpm test` — GREEN (exit 0)

```
@mymozhem/sdk:    Test Suites: 16 passed, 16 total | Tests: 198 passed, 198 total
@mymozhem/core:   Test Suites: 9 passed, 9 total   | Tests: 107 passed, 107 total
@mymozhem/server: Test Suites: 2 passed, 2 total   | Tests: 15 passed, 15 total
Tasks: 5 successful, 5 total
```
Итого 320 unit-тестов, 0 failed.

### 5. `pnpm test:int` — GREEN (exit 0)

```
@mymozhem/core:test:int: Test Suites: 10 passed, 10 total
@mymozhem/core:test:int: Tests:       88 passed, 88 total
@mymozhem/core:test:int: Time:        47.268 s
Tasks: 3 successful, 3 total
```

### 6. `pnpm boundary-check` — GREEN (exit 0)

```
$ depcruise apps packages --config .dependency-cruiser.cjs
✔ no dependency violations found (313 modules, 778 dependencies cruised)
```

### 7. `pnpm guardrails` — GREEN (exit 0)

```
OK   — guardrail fired on: sdk → core import (dependency-cruiser)
OK   — guardrail fired on: module-level mutable export (eslint)
OK   — guardrail fired on: apps → core src-internals import (dependency-cruiser)
All guardrails verified alive.
```

**Step 1 verdict: ALL 7 GATES GREEN.**

---

## Step 2 — Docker boot smoke

### Pre-flight safety check

- `docker compose config`: project name `mymozhem`; services `postgres` (postgres:17, **no host port published**) и `server` (build из root `Dockerfile`, публикует только host 3000). Стек не пересекается с lt-pg.
- `docker ps` до старта: `lt-pg` (127.0.0.1:5432, up 8 days) и `az-cabinet-pg` (5433) — чужие, не трогались.

### Boot

```
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build -d   → exit 0
Image mymozhem-server Built
Container mymozhem-postgres-1 Healthy → mymozhem-server-1 Started
```

### Миграции

Применяются в entrypoint (`ENTRYPOINT ["/app/docker/entrypoint.sh"]` в Dockerfile). Логи server:
```
7 migrations found in prisma/migrations
Applying migration `20260718061612_room_lifecycle`
Applying migration `20260722151900_identity_seam`
Applying migration `20260722153952_room_organizer_fk`
...
```
Замечание (не блокер): Prisma в контейнере пишет warning о невозможности определить libssl/openssl и дефолтит на openssl-1.1.x — работает, но стоит добавить `openssl` в runtime-стейдж Dockerfile при случае.

### Smoke transcript

Health (200 на первой же попытке):
```
GET localhost:3000/health/ready → 200
{"status":"ok","db":true}
```

Join-denied probe:
```
POST localhost:3000/rooms/join  (content-type: application/json)
body: {"code":"NOPE1234","displayName":"Probe"}
→ HTTP 403
{"code":"ROOM_JOIN_DENIED"}
```
Точно соответствует ожиданию брифа — транспорт + HttpExceptionFilter живы.

`docker compose ps` (во время smoke):
```
mymozhem-postgres-1   Up (healthy)
mymozhem-server-1     Up
```
Логи server: все модули поднялись, в т.ч. `TransportModule`, маршруты `POST /rooms/join` и `POST /auth/refresh` замаплены, приложение стартовало без ошибок.

### Teardown

```
docker compose down -v → оба контейнера + network + volume удалены (project-scoped)
docker ps после: lt-pg Up 8 days, az-cabinet-pg Up — нетронуты
```

**Step 2 verdict: SMOKE PASSED.**

---

## Deviations

- Compose-команды `ps`/`logs`/`down` требуют `JWT_SECRET` в env из-за интерполяции с валидацией (`JWT_SECRET is required (>=32 bytes)`); для read-only команд подставлялся фиктивный 64-символьный секрет — на работающий стек не влияет (он стартовал с реальным случайным секретом).
- Cookie round-trip не проверялся по design (NODE_ENV=production → Secure cookie over plain HTTP) — смоук покрывает только join-denied путь, как и предписано.

## Concerns

- Non-blocking: prisma openssl-detection warning в контейнере (см. выше).
- Шаг 3 (HANDOFF.md update + commit) — вне моего скоупа, за контроллером.

---

## Final-review fix: reuse logging

**Commit:** `519fd8aa261fcdf55660431a316ecb1da95d8eb1` — `fix(core): log refresh reuse/invalid events server-side (design §11 investigation trail)`

**Finding (Important, final whole-branch review):** refresh-token reuse detection (theft signal — whole session family revoked) left zero server-side trace. Design §11 justifies collapsing all refresh refusals into one wire `SESSION_INVALID` precisely because «серверный лог несёт различие для расследования», but `HttpExceptionFilter` logged only `status >= 500`. Owner decision: fix before merge.

### What changed

1. **`packages/core/src/transport/http-exception.filter.ts`** — added an `else if (exception instanceof AuthError)` branch calling `logger.warn(exception.message)`. 5xx still `logger.error(exception)`; wire response unchanged (still exactly `{code}`, REQ-SEC-006). Added a code comment citing design §11 and stating why the message is safe to log.
2. **`packages/core/src/transport/http-exception.filter.spec.ts`** — added a `warn` spy alongside the existing `error` spy; new test asserts AuthError → `logger.warn` called with the message, `logger.error` not called, wire body still `{code: 'SESSION_INVALID'}`; the 4xx non-auth test now asserts neither `error` nor `warn` is called (membership/zod/prisma stay silent); 5xx test unchanged. REQ-SEC-006 invariant table untouched.

### Token-material check (token.service.ts)

Read all `AuthError` message sites in `packages/core/src/auth/token.service.ts`. **No AuthError message contains token material:**

- Fixed strings only: `'unknown refresh token'`, `'session revoked or expired'`, `'identity gone'`, `'guest TTL expired'`, `'membership gone'`, `'room terminal'`, `'rotation race lost'`, `'access claims malformed'`.
- `'refresh reuse detected, family ${session.familyId} revoked'` — `familyId` is a random UUID (session-family identifier), not token material.
- `'access verify failed: ${jwt-error.message}'` — jsonwebtoken error strings (`'jwt expired'`, `'invalid signature'`, etc.) never echo the token.
- `'rotation failed: ${err.message}'` — wraps Prisma/tx errors; transaction data carries only `refreshTokenHash` (sha256), never the raw token, and Prisma known-error messages name fields, not values.

Conclusion: logging `exception.message` is safe; no fallback to name-only logging was needed.

### Test commands + output tails

`pnpm --filter @mymozhem/core test -t HttpExceptionFilter`:

```
PASS src/transport/http-exception.filter.spec.ts
Test Suites: 8 skipped, 1 passed, 1 of 9 total
Tests:       96 skipped, 12 passed, 108 total
```

`pnpm --filter @mymozhem/core test` (full core unit lane):

```
Test Suites: 9 passed, 9 total
Tests:       108 passed, 108 total
```

`pnpm --filter @mymozhem/core typecheck` (`tsc -p tsconfig.json --noEmit`): clean, no output.
