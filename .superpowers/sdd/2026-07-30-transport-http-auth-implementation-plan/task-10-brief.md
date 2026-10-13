### Task 10: HTTP e2e — полный поток на testcontainer-БД

**REQ:** REQ-ID-013 (неразличимость на проводе), REQ-SEC-006 (контракт на проводе), REQ-ID-007/008/016 (поток join→refresh→reuse), REQ-SEC-007 (429 на refresh), REQ-SEC-008 (helmet/CORS заголовки).

**Files:**
- Modify: `packages/core/src/index.ts` (экспорт `testing/postgres.testcontainer`, `testing/seed-identity` — осознанное расширение barrel, design §9)
- Modify: `apps/server/package.json` (devDeps: `testcontainers`, `@testcontainers/postgresql`)
- Create: `apps/server/test/transport.e2e-spec.ts`

**Каркас:** один `startTestDb()` на файл (beforeAll, 120s), app пересобирается per describe с нужными env-override'ами (`JOIN_RATE_LIMIT_IP`, `ROOM_PARTICIPANT_LIMIT`, `REFRESH_RATE_LIMIT`); ConfigModule читает env при boot модуля. `@fastify/cookie` регистрируется в тестовом app (контроллеры зовут `setCookie`). Env в afterAll восстанавливается. TRUNCATE (`identity."Session"`, `membership."Membership"`, `room."Room"`, `identity."Identity"` CASCADE) между тестами.

Посев комнаты — через core-сервисы из dist (`RoomService`, `MembershipService`, `IdentityService`, `EventLogService`, `AppRegistryService`, `JoinRateLimiter`, `seedIdentity`, `TEST_CONFIG` — конструируются вручную, как в int-спеках).

- [ ] **Step 1: Экспорты + зависимости**

```bash
pnpm --filter @mymozhem/server add -D testcontainers @testcontainers/postgresql
```
В core `index.ts`: `export * from './testing/postgres.testcontainer'; export * from './testing/seed-identity'; export * from './testing/test-config';`

- [ ] **Step 2: Тесты (transport.e2e-spec.ts)**

Обязательный набор (каждый — отдельный `it`, код по образцу health.e2e + `app.inject`):
1. **join happy path:** 201; body `expect(tokenResponseSchema.parse(res.json()))` — валиден по SDK-схеме; `set-cookie` содержит `mm_refresh=`, `HttpOnly`, `SameSite=Strict`, `Path=/auth`; access verify через `TokenService.verifyAccessToken` → claims `{kind:'GUEST', roomId}`.
2. **неверный код → 403 `{code:'ROOM_JOIN_DENIED'}`**, body ровно `{code}` (нет message/stack — REQ-SEC-006).
3. **закрытая политика (`registered`) → ответ ИДЕНТИЧЕН неверному коду** (REQ-ID-013 на проводе): `expect(resClosed.statusCode).toBe(resWrong.statusCode); expect(resClosed.body).toBe(resWrong.body);`
4. **невалидное тело → 400 `{code:'REQUEST_INVALID'}`** (напр. `{code:'ABCDEFGH'}` без displayName).
5. **join rate limit:** boot с `JOIN_RATE_LIMIT_IP=2` → третий join → 429 `{code:'RATE_LIMITED'}`.
6. **лимит участников:** boot с `ROOM_PARTICIPANT_LIMIT=1` → второй гость → 409 `{code:'ROOM_PARTICIPANT_LIMIT_REACHED'}`.
7. **refresh happy:** join → `POST /auth/refresh` с кукой → 200, новый access, новая кука; старый refresh повторно → 401 `{code:'SESSION_INVALID'}`; НОВЫЙ refresh после повторного старого → тоже 401 (семейство ревокнуто, REQ-ID-007 сквозь провод).
8. **refresh без куки → 401 `{code:'SESSION_INVALID'}`**.
9. **refresh rate limit:** boot с `REFRESH_RATE_LIMIT=1` → второй refresh → 429 `{code:'RATE_LIMITED'}`.
10. **helmet:** ответ join содержит security-заголовки (напр. `x-dns-prefetch-control`).
11. **CORS:** запрос с `Origin: https://evil.example` → нет `access-control-allow-origin`; при `CORS_ORIGINS=https://ok.example` и этом origin — есть.
12. **терминальная комната:** join → room COMPLETED (через `RoomService`) → refresh → 401 (REQ-ID-016 на проводе).

Куку между запросами передавать вручную: `res.cookies` из ответа → заголовок `cookie` следующего запроса.

- [ ] **Step 3: Прогнать — зелёно**

Run: `pnpm build && pnpm --filter @mymozhem/server test`
(Требует Docker Desktop. `jest.setTimeout(120_000)` в файле.)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/index.ts apps/server
git commit -m "test(server): transport e2e — join/refresh flows, REQ-ID-013 indistinguishability, REQ-SEC-006 wire contract"
```

---

