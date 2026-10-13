# Task 4 Report — TokenService: issue/verify (unit-часть)

## Что сделано

Реализован токен-контур AuthModule ровно по brief, без отклонений в коде:

- `packages/core/src/auth/auth.constants.ts` — `REFRESH_COOKIE = 'mm_refresh'` (REQ-ID-008).
- `packages/core/src/auth/auth.errors.ts` — `AUTH_ERROR_CODES.SESSION_INVALID`, `AuthError` по образцу `membership.errors.ts`.
- `packages/core/src/auth/token.service.ts` — `TokenService` с `issueGuestTokens` (opaque refresh 32 байта base64url, в БД только SHA-256 hex-хэш, `familyId = randomUUID()`, `expiresAt = now + min(REFRESH_TOKEN_TTL, GUEST_TTL)`), `verifyAccessToken` (HS256 по `JWT_SECRET`, `algorithms: ['HS256']` пиннинг, валидация claims sub/sid/kind, ошибки свёрнуты в `AuthError(SESSION_INVALID)`), protected-хелперы `sessionExpiry()`/`signAccess()` для Task 5 (rotate). `rotate` НЕ реализован — это Task 5, как указано.
- `packages/core/src/auth/auth.module.ts` — `AuthModule` (imports: PrismaModule, ConfigModule; exports: TokenService).
- `packages/core/src/index.ts` — добавлены 4 экспортные строки auth в конец файла.
- `packages/core/package.json` + `pnpm-lock.yaml` — `jsonwebtoken` (deps) + `@types/jsonwebtoken` (devDeps), один lockfile в корне.

TDD-порядок соблюдён: deps → failing spec (TS2307, модулей нет) → implementation → green → typecheck → commit.

## Отклонения от brief

Нет. Код, тесты и коммит-команда — verbatim из brief. Единственное дополнение к предписанным шагам: прогнал `eslint src/auth` перед коммитом (чисто, без вывода) — CI-гейт lint не сломан.

## Проверки

- esModuleInterop: включён в `tsconfig.base.json` (`"esModuleInterop": true`, module commonjs) — `import jwt from 'jsonwebtoken'` работает, подтверждено проходящими тестами и typecheck.
- Существующий `packages/core/src/auth/session-schema.int-spec.ts` (из Task 3) уже был в git — коммит его не задел, миграции и prisma-схема не тронуты.

### Команды и вывод

`pnpm --filter @mymozhem/core add jsonwebtoken` → `+12`, Done (jsonwebtoken@9 + транзитивные).
`pnpm --filter @mymozhem/core add -D @types/jsonwebtoken` → `+2`, Done.

RED: `pnpm --filter @mymozhem/core test -t TokenService`
```
Test suite failed to run
src/auth/token.service.spec.ts:1:30 - error TS2307: Cannot find module './token.service'...
src/auth/token.service.spec.ts:2:27 - error TS2307: Cannot find module './auth.errors'...
Test Suites: 1 failed, 7 skipped
```

GREEN: `pnpm --filter @mymozhem/core test -t TokenService`
```
PASS src/auth/token.service.spec.ts
Test Suites: 7 skipped, 1 passed, 1 of 8 total
Tests:       89 skipped, 5 passed, 94 total
```

Typecheck: `pnpm --filter @mymozhem/core typecheck` → `tsc -p tsconfig.json --noEmit`, exit 0, без вывода.

Lint: `npx eslint src/auth` (из packages/core) → exit 0, без вывода.

Commit:
```
eaba0d8 feat(core): TokenService issue/verify with hashed refresh families (REQ-ID-007, REQ-ID-016)
8 files changed, 261 insertions(+)
```

## Self-review

- **REQ-ID-007**: refresh — `randomBytes(32).toString('base64url')` (opaque, 256 бит энтропии), хранится только `sha256(token)` hex (64 символа), тест проверяет формат хэша и `hash !== token`. OK.
- **REQ-ID-008**: константа куки есть; Path=/auth — зона ответственности контроллера (Task 8), здесь только имя. OK.
- **REQ-ID-016**: guest claims содержат `roomId`; `kind: 'GUEST'`; session expiry = `min(REFRESH_TOKEN_TTL, GUEST_TTL)` — тест проверяет cap с допуском 5 с. OK.
- **REQ-SEC-002**: HS256 с явным пиннингом `algorithms: ['HS256']` при verify — alg-confusion («none»/RS256-подстановка) отсечён. OK.
- Ошибки verify (неверная подпись, malformed, истёкший exp, битые claims) сворачиваются в один `AuthError(SESSION_INVALID)` — принцип единообразного отказа REQ-ID-013, зафиксирован в комментарии. OK.
- Нет глобального мутабельного состояния (REQ-CORE-004): всё в readonly-полях инстанса. OK.
- `verifyAccessToken` синхронный (jwt.verify sync) — совместимо с будущим realtime-handshake (REQ-RT-009), как отмечено в комментарии.
- Стиль: плотность комментариев и цитирование REQ-ID соответствуют соседним файлам (membership.errors.ts, config.tokens.ts).
- Замечание, не дефект: тесты используют `prisma as never`-каст — так предписано brief, паттерн согласован с остальными unit-spec пакета.

## Concerns

Нет. Готов к Task 5 (rotate): protected-хелперы `sessionExpiry()`/`signAccess()` на месте, `familyId` в схеме сессии заполняется.
