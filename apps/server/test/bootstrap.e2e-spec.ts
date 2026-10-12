import { spawn, type ChildProcess } from 'node:child_process';
import * as net from 'node:net';
import * as path from 'node:path';
import { TEST_CONFIG, startTestDb, type TestDb } from '@mymozhem/core';

jest.setTimeout(180_000);

// Boot-smoke РЕАЛЬНОГО entrypoint (dist/main.js) — уровень, на котором жил
// Critical-1 (fix round 1): main.ts делает app.get(Logger) из nestjs-pino, и при
// split-инстансах nestjs-pino (apps/server против packages/core — разные realpath
// из-за peer pino) класс Logger другой, провайдер не резолвится и bootstrap падает
// "Nest could not find Logger". e2e через TestingModule этот путь НЕ выполняют
// (useLogger там не вызывается) — проверка возможна только запуском собранного
// main.js отдельным процессом. Порядок гейтов гарантирует свежий dist:
// `pnpm build` идёт раньше `pnpm --filter @mymozhem/server test`.
// nestjs-pino здесь не импортируется — boundary observability-libs-contained
// разрешает его только main.ts/core; процесс-потомок обходит ограничение честно.
describe('Bootstrap smoke (REQ-OPS-003/OPS-004)', () => {
  let db: TestDb;
  let child: ChildProcess | undefined;
  let childOutput = '';

  beforeAll(async () => {
    db = await startTestDb(); // выставляет DATABASE_URL — её отдаём потомку
  });

  afterAll(async () => {
    if (child !== undefined && child.exitCode === null) child.kill('SIGKILL');
    await db.stop();
  });

  function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address === null || typeof address === 'string') {
          server.close();
          reject(new Error('no free port'));
          return;
        }
        server.close(() => resolve(address.port));
      });
    });
  }

  it('dist/main.js поднимается: /health/live 200 + x-request-id uuid (app.get(Logger) резолвится, REQ-OPS-004)', async () => {
    const port = await freePort();
    child = spawn(process.execPath, [path.join(__dirname, '..', 'dist', 'main.js')], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(port),
        DATABASE_URL: process.env.DATABASE_URL!,
        JWT_SECRET: TEST_CONFIG.JWT_SECRET,
        LOG_LEVEL: 'warn', // потомок пишет в свой stdout — уровень на шум не влияет, но оставляем явно
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout!.on('data', (chunk: Buffer) => (childOutput += chunk.toString()));
    child.stderr!.on('data', (chunk: Buffer) => (childOutput += chunk.toString()));
    let earlyExit: number | null = null;
    child.once('exit', (code) => {
      earlyExit = code ?? -1;
    });

    // Readiness: poll /health/live до 200 (≤ 30 с). Ранний exit потомка — дефект
    // bootstrap (например, split nestjs-pino), вывод потомка — в сообщении падения.
    const deadline = Date.now() + 30_000;
    let status: number | undefined;
    let requestId: string | null = null;
    while (Date.now() < deadline) {
      if (earlyExit !== null) break;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health/live`);
        status = res.status;
        if (status === 200) {
          requestId = res.headers.get('x-request-id');
          break;
        }
      } catch {
        // ещё не слушает
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (earlyExit !== null) {
      throw new Error(`entrypoint exited early (code ${earlyExit}) — bootstrap broken. Output:\n${childOutput}`);
    }
    if (status !== 200) {
      throw new Error(`no 200 from /health/live (last status ${String(status)}). Output:\n${childOutput}`);
    }
    // Сквозная проверка наблюдаемости через реальный entrypoint: middleware
    // requestId встал (uuid в ответе) — значит и app.useLogger(app.get(Logger)) прошёл.
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
