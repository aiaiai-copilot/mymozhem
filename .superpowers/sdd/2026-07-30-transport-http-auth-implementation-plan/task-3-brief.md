### Task 3: Миграция — `identity."Session"`

**REQ:** REQ-ID-007 (хэшированный refresh, семейства ротации), REQ-ID-016 (expiry).

**Files:**
- Modify: `packages/core/prisma/schema.prisma`
- Create: `packages/core/prisma/migrations/<timestamp>_auth_sessions/migration.sql` (генерируется)
- Create: `packages/core/src/auth/session-schema.int-spec.ts`

**Interfaces:**
- Produces: Prisma-модель `Session` (`prisma.session`): поля `id, identityId, refreshTokenHash (unique), familyId, replacedById?, revokedAt?, expiresAt, createdAt`.

- [ ] **Step 1: Схема**

В `schema.prisma` добавить модель и связь в `Identity` (`sessions Session[]`):
```prisma
model Session {
  id               String    @id @default(uuid()) @db.Uuid
  identity         Identity  @relation(fields: [identityId], references: [id])
  identityId       String    @db.Uuid
  refreshTokenHash String    @unique
  familyId         String    @db.Uuid
  replacedById     String?   @db.Uuid
  revokedAt        DateTime?
  expiresAt        DateTime
  createdAt        DateTime  @default(now())

  @@schema("identity")
}
```

- [ ] **Step 2: Авторинг миграции через эфемерный контейнер (порт 55434, НЕ 5432)**

```bash
docker run -d --name mm-migrate -e POSTGRES_PASSWORD=postgres -p 55434:5432 postgres:17
# дождаться готовности: docker exec mm-migrate pg_isready -U postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:55434/postgres pnpm exec prisma migrate dev --name auth_sessions
DATABASE_URL=postgresql://postgres:postgres@localhost:55434/postgres pnpm exec prisma generate
docker rm -f mm-migrate
```
Проверить SQL: таблица в схеме `identity`, UNIQUE на `refreshTokenHash`, FK на `identity."Identity"`. Если `prisma generate` молча не регенерировал клиент — повторить явно (известная ловушка, HANDOFF).

- [ ] **Step 3: Presence-тест миграции (конвенция репо, см. membership-schema.int-spec.ts)**

`packages/core/src/auth/session-schema.int-spec.ts`:
```ts
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';

describe('identity."Session" schema (REQ-ID-007)', () => {
  let db: TestDb;
  beforeAll(async () => { db = await startTestDb(); }, 120000);
  afterAll(async () => { await db.stop(); });

  it('table exists in the identity schema', async () => {
    const rows = await db.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM information_schema.tables
      WHERE table_schema = 'identity' AND table_name = 'Session'`;
    expect(Number(rows[0].count)).toBe(1);
  });

  it('refreshTokenHash is unique', async () => {
    const rows = await db.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM pg_indexes
      WHERE schemaname = 'identity' AND tablename = 'Session'
        AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%refreshTokenHash%'`;
    expect(Number(rows[0].count)).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 4: Прогнать** `pnpm --filter @mymozhem/core test:int -t "Session schema"` — зелёно

- [ ] **Step 5: Commit**

```bash
git add packages/core/prisma packages/core/src/auth/session-schema.int-spec.ts
git commit -m "feat(core): identity.Session table for refresh token families (REQ-ID-007)"
```

---

