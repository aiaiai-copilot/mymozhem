// CLI-создание комнаты служебным организатором к первому живому событию (design §8).
// Живой путь через core-сервисы: валидации, код комнаты, организаторская membership,
// lifecycle-эмит — всё штатно. НЕ HTTP-путь и не демо-auth (REQ-SEC-001): токены
// организатору не выдаются нигде.
// Usage: pnpm create-room -- --email=org@example.com [--policy=guests]
// Env: DATABASE_URL, JWT_SECRET (единая config-схема валидирует всё, REQ-OPS-003).
// Требует собранный @mymozhem/core (pnpm build).
//
// Импорты — НЕ из barrel '@mymozhem/core': его dist/index.js на require-time
// подтягивает ./testing/postgres.testcontainer → '@testcontainers/postgresql'
// (devDependency core). На dev-машине с установленными devDeps это бы сработало,
// но CLI-путь не должен зависеть от тестового харнесса — поэтому точечные
// subpath-импорты из dist (поле exports у пакета нет, subpaths разрешены).
import 'reflect-metadata';
import { loadConfig } from '@mymozhem/core/dist/config/config.schema.js';
import { PrismaService } from '@mymozhem/core/dist/prisma/prisma.service.js';
import { IdentityService } from '@mymozhem/core/dist/identity/identity.service.js';
import { MembershipService } from '@mymozhem/core/dist/membership/membership.service.js';
import { JoinRateLimiter } from '@mymozhem/core/dist/membership/join-rate-limiter.js';
import { EventLogService } from '@mymozhem/core/dist/realtime/event-log.service.js';
import { AppRegistryService } from '@mymozhem/core/dist/app-registry/app-registry.service.js';
import { RoomService } from '@mymozhem/core/dist/room/room.service.js';

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const email = arg('email', 'organizer@mymozhem.local');
const policy = arg('policy', 'guests');

const config = loadConfig(process.env);
const prisma = new PrismaService();
await prisma.onModuleInit();
try {
  // Ручная сборка по паттерну core int-спек (design §8): порядок зависимостей
  // PrismaService → IdentityService/JoinRateLimiter → MembershipService → RoomService.
  const identity = new IdentityService(prisma);
  const membership = new MembershipService(
    prisma,
    identity,
    new JoinRateLimiter(config.JOIN_RATE_LIMIT_IP),
    config,
  );
  const rooms = new RoomService(
    prisma,
    new EventLogService(),
    new AppRegistryService([]),
    membership,
    config,
  );

  // Служебный организатор: reuse по частичному уникальному индексу
  // "Identity_registered_email_key" (kind=REGISTERED, deletedAt IS NULL) — повторный
  // прогон с тем же email не создаёт второго организатора. Гонка двух одновременных
  // запусков охраняется самим индексом (второй create упадёт с unique violation).
  let organizer = await prisma.identity.findFirst({
    where: { email, kind: 'REGISTERED', deletedAt: null },
  });
  organizer ??= await prisma.identity.create({ data: { kind: 'REGISTERED', email } });

  const room = await rooms.create(organizer.id, policy);
  console.log(
    `Room created: id=${room.id} code=${room.code} joinPolicy=${room.joinPolicy} organizer=${organizer.id}`,
  );
} finally {
  await prisma.onModuleDestroy();
}
