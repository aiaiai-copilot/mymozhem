### Task 11: Seed-скрипт создания комнаты служебным организатором

**REQ:** REQ-SEC-001 (CLI, не HTTP-путь; токены организатору не выдаются), REQ-ID-005.

**Files:**
- Create: `apps/server/scripts/create-room.mjs`
- Modify: `apps/server/package.json` (script `create-room`)
- Modify: корневой `package.json` (script `create-room`)

- [ ] **Step 1: Скрипт**

`apps/server/scripts/create-room.mjs`:
```js
// CLI-создание комнаты служебным организатором к первому живому событию (design §8).
// Живой путь через core-сервисы: валидации, код комнаты, организаторская membership,
// lifecycle-эмит — всё штатно. НЕ HTTP-путь и не демо-auth (REQ-SEC-001): токены
// организатору не выдаются нигде.
// Usage: pnpm create-room -- --email=org@example.com [--policy=guests]
// Env: DATABASE_URL, JWT_SECRET (единая config-схема валидирует всё, REQ-OPS-003).
// Требует собранный @mymozhem/core (pnpm build).
import 'reflect-metadata';
import {
  loadConfig,
  PrismaService,
  IdentityService,
  MembershipService,
  JoinRateLimiter,
  EventLogService,
  AppRegistryService,
  RoomService,
} from '@mymozhem/core';

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const email = arg('email', 'organizer@mymozhem.local');
const policy = arg('policy', 'guests');

const config = loadConfig(process.env);
const prisma = new PrismaService();
await prisma.onModuleInit();
try {
  const identity = new IdentityService(prisma);
  const membership = new MembershipService(prisma, identity, new JoinRateLimiter(config.JOIN_RATE_LIMIT_IP), config);
  const rooms = new RoomService(prisma, new EventLogService(), new AppRegistryService([]), membership, config);

  let organizer = await prisma.identity.findFirst({ where: { email, kind: 'REGISTERED', deletedAt: null } });
  organizer ??= await prisma.identity.create({ data: { kind: 'REGISTERED', email } });

  const room = await rooms.create(organizer.id, policy);
  console.log(`Room created: id=${room.id} code=${room.code} joinPolicy=${room.joinPolicy} organizer=${organizer.id}`);
} finally {
  await prisma.onModuleDestroy();
}
```

`apps/server/package.json` scripts: `"create-room": "node scripts/create-room.mjs"`. Корневой `package.json` scripts: `"create-room": "pnpm --filter @mymozhem/server run create-room"`.

- [ ] **Step 2: Проверка на эфемерной БД (порт 55435, НЕ 5432)**

```bash
docker run -d --name mm-seed-check -e POSTGRES_PASSWORD=postgres -p 55435:5432 postgres:17
DATABASE_URL=postgresql://postgres:postgres@localhost:55435/postgres pnpm exec prisma migrate deploy
DATABASE_URL=postgresql://postgres:postgres@localhost:55435/postgres JWT_SECRET=$(openssl rand -hex 32) pnpm create-room -- --email=org@example.test
# ожидается строка "Room created: id=... code=... joinPolicy=guests ..."
# повторный прогон с тем же email — НЕ создаёт второго организатора (findFirst → reuse)
docker rm -f mm-seed-check
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/scripts apps/server/package.json package.json
git commit -m "feat(server): create-room CLI seed script via core services (REQ-SEC-001)"
```

---

