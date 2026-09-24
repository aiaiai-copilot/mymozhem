// Seed для e2e-smoke веб-клиента (Task 16): REGISTERED identity + живая сессия
// через TokenService — та же Session-запись и хэш, что у OAuth-complete, но без
// Google: реальных кредов у стенда нет, а гейт /host проверяет лишь валидность
// refresh-куки (интерпретация I-4 плана: seed обходит Google).
//
// Запуск — ВНУТРИ контейнера server: compose by design не публикует порт
// Postgres на хост, а в контейнере DATABASE_URL и JWT_SECRET уже выставлены:
//   docker compose exec -T server node apps/server/scripts/e2e-web-seed.mjs \
//     --email=e2e@example.com
// stdout: {"refreshToken":"..."} — значение куки mm_refresh (REFRESH_COOKIE).
// Скрипт идемпотентен: identity переиспользуется по частичному уникальному
// индексу, каждый прогон создаёт новую независимую сессию (новое familyId).
//
// Импорты — точечные subpath из dist, НЕ barrel '@mymozhem/core': его
// dist/index.js на require-time подтягивает тестовый харнес testcontainers
// (та же причина, что в create-room.mjs).
import 'reflect-metadata';
import { loadConfig } from '@mymozhem/core/dist/config/config.schema.js';
import { PrismaService } from '@mymozhem/core/dist/prisma/prisma.service.js';
import { TokenService } from '@mymozhem/core/dist/auth/token.service.js';

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const email = arg('email', 'e2e@example.com');

// Единая config-схема валидирует всё окружение (REQ-OPS-003) — JWT_SECRET
// обязателен и здесь: TokenService подписывает access-токены тем же секретом.
const config = loadConfig(process.env);
const prisma = new PrismaService();
await prisma.onModuleInit();
try {
  // Reuse по частичному уникальному индексу "Identity_registered_email_key"
  // (kind=REGISTERED, deletedAt IS NULL) — паттерн create-room.mjs: повторный
  // seed с тем же email не создаёт второго организатора.
  let identity = await prisma.identity.findFirst({
    where: { email, kind: 'REGISTERED', deletedAt: null },
  });
  identity ??= await prisma.identity.create({ data: { kind: 'REGISTERED', email } });

  // Ручная сборка (как в create-room.mjs и core int-спеках): @Inject-декоратор
  // TokenService вне Nest-контекста — чистая метка, позиционные аргументы решают.
  const tokens = new TokenService(prisma, config);
  const issued = await tokens.issueRegisteredTokens(identity.id);
  // Наружу — только refreshToken: access короткоживущий, и клиент обязан пройти
  // refresh тем же путём, что реальный организатор после OAuth-лендинга, —
  // иначе smoke не упражнял бы refresh-шов.
  console.log(JSON.stringify({ refreshToken: issued.refreshToken }));
} finally {
  await prisma.onModuleDestroy();
}
