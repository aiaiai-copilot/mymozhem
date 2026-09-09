import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { getContainerRuntimeClient } from 'testcontainers';
import { PrismaService } from '../prisma/prisma.service';

// packages/core/src/testing -> repo root (four levels up).
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

export interface TestDb {
  prisma: PrismaService;
  stop: () => Promise<void>;
  // Остановка/поднятие самого Postgres — для тестов недоступности БД
  // (REQ-DEV-008). OrbStack ПЕРЕНАЗНАЧАЕТ случайный host-порт при restart,
  // поэтому старый клиент после поднятия мёртв навсегда: startContainer
  // возвращает НОВЫЙ подключённый PrismaService (та же БД, новый порт);
  // спек обязан перейти на него для верификации и последующих тестов.
  stopContainer: () => Promise<void>;
  startContainer: () => Promise<PrismaService>;
}

// Starts a throwaway Postgres, applies the committed migration with `migrate deploy`
// (REQ-OPS-002), and returns a connected PrismaService. NEVER points at a shared or
// production DB — the container is ephemeral and isolated by construction.
export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('postgres:17').start();
  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url; // PrismaService reads this at construction

  execSync('pnpm exec prisma migrate deploy', {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });

  const prisma = new PrismaService();
  await prisma.onModuleInit();

  // testcontainers v12: у Started-контейнера нет start(), а StoppedTestContainer —
  // только метаданные. Остановка/подъём — через runtime-клиент (dockerode) по id.
  // Флаг делает пару stop/start идемпотентной (упавший посередине тест не ломает
  // teardown).
  let containerDown = false;
  const extraClients: PrismaService[] = []; // клиенты рестартов — закрываются в stop()

  return {
    prisma,
    stop: async () => {
      for (const client of extraClients) await client.$disconnect().catch(() => {});
      await prisma.onModuleDestroy().catch(() => {}); // клиент может быть мёртв вместе с БД
      await container.stop().catch(() => {}); // контейнер может быть уже остановлен тестом
    },
    stopContainer: async () => {
      if (containerDown) return;
      const client = await getContainerRuntimeClient();
      await client.container.stop(client.container.getById(container.getId()), { timeout: 5 });
      containerDown = true;
    },
    startContainer: async () => {
      if (!containerDown) return prisma;
      const client = await getContainerRuntimeClient();
      const handle = client.container.getById(container.getId());
      await client.container.start(handle);
      containerDown = false;
      // OrbStack перевешивает случайный host-порт при restart — читаем фактический.
      const inspected = await client.container.inspect(handle);
      const hostPort = inspected.NetworkSettings.Ports['5432/tcp'][0].HostPort;
      const url = new URL(container.getConnectionUri());
      url.port = hostPort;
      const savedUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = url.toString(); // PrismaService читает при конструировании
      const fresh = new PrismaService();
      process.env.DATABASE_URL = savedUrl;
      await fresh.onModuleInit();
      extraClients.push(fresh);
      // Postgres после start ещё поднимается — опрашиваем до реальной
      // отвечаемости, иначе проверки «ничего не записалось» флейковали бы.
      const deadline = Date.now() + 30000;
      for (;;) {
        try {
          await fresh.$queryRaw`SELECT 1`;
          return fresh;
        } catch (err) {
          if (Date.now() > deadline) throw err;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    },
  };
}
