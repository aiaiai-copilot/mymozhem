import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaService } from '../prisma/prisma.service';

// packages/core/src/testing -> repo root (four levels up).
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

export interface TestDb {
  prisma: PrismaService;
  stop: () => Promise<void>;
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

  return {
    prisma,
    stop: async () => {
      await prisma.onModuleDestroy();
      await container.stop();
    },
  };
}
