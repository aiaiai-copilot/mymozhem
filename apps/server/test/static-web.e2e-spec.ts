import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService, loadConfig } from '@mymozhem/core';
import { AppModule } from '../src/app.module';
import { registerStaticWeb } from '../src/static-web';

// Маркер отличает раздачу SPA от любого API-ответа: SPA-fallback срабатывает
// только на не-API GET, API-404 обязаны оставаться JSON (Review Focus 5, дизайн §2).
const SPA_MARKER = 'SPA-E2E-MARKER';

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

describe('Static web (same-origin SPA, e2e)', () => {
  let app: NestFastifyApplication;
  let staticDir: string;
  const prismaStub = { isHealthy: jest.fn(), onModuleInit: jest.fn(), onModuleDestroy: jest.fn() };
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    // Boot по паттерну health.e2e: Prisma заглушен (статике БД не нужна), env —
    // мёртвый порт, чтобы тест не смотрел в чужой локальный Postgres.
    for (const key of ['DATABASE_URL', 'JWT_SECRET', 'WEB_STATIC_DIR']) {
      savedEnv[key] = process.env[key];
    }
    process.env.DATABASE_URL ??= 'postgresql://stub:stub@localhost:55999/stub';
    process.env.JWT_SECRET ??= 'static-web-e2e-secret-32-bytes-pad!';
    staticDir = mkdtempSync(join(tmpdir(), 'mymozhem-web-'));
    writeFileSync(join(staticDir, 'index.html'), `<!doctype html><html><body>${SPA_MARKER}</body></html>`);
    process.env.WEB_STATIC_DIR = staticDir;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie);
    await app.register(fastifyHelmet);
    await app.register(fastifyCors, { origin: [] });
    await app.init();
    // Тот же production-helper, что вызывает main.ts: e2e пинит реальный код
    // раздачи, а не зеркальную копию bootstrap. Порядок значим: регистрация
    // ПОСЛЕ init — корневой not-found handler Nest откладывается в avvio-очередь
    // при init, и наш scope-handler обязан встать в очередь позже него,
    // иначе при boot выиграет корневой (см. static-web.ts).
    await registerStaticWeb(app, loadConfig(process.env));
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(staticDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) restoreEnv(key, value);
  });

  it('GET / → index.html (SPA)', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain(SPA_MARKER);
  });

  it('GET /host/console (не-API GET) → index.html (SPA fallback)', async () => {
    const res = await app.inject({ method: 'GET', url: '/host/console' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain(SPA_MARKER);
  });

  it('GET /rooms/nonexistent (API-путь) → JSON 404, НЕ index.html', async () => {
    const res = await app.inject({ method: 'GET', url: '/rooms/nonexistent' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).not.toContain(SPA_MARKER);
  });

  it('GET /socket.io/… → не index.html', async () => {
    const res = await app.inject({ method: 'GET', url: '/socket.io/?EIO=4&transport=polling' });
    expect(res.headers['content-type'] ?? '').not.toContain('text/html');
    expect(res.body).not.toContain(SPA_MARKER);
  });
});
