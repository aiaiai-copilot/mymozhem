import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '@mymozhem/core';
import { AppModule } from '../src/app.module';

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

describe('Health (e2e)', () => {
  let app: NestFastifyApplication;
  const prismaStub = { isHealthy: jest.fn(), onModuleInit: jest.fn(), onModuleDestroy: jest.fn() };
  let savedDatabaseUrl: string | undefined;
  let savedJwtSecret: string | undefined;

  beforeAll(async () => {
    // AppModule now includes ConfigModule (REQ-OPS-003): env is validated at boot.
    // PrismaService is stubbed below, so a dead port is sufficient — and deliberate:
    // 5432 on a dev machine may be a foreign container, the test must not point at it.
    savedDatabaseUrl = process.env.DATABASE_URL;
    savedJwtSecret = process.env.JWT_SECRET;
    process.env.DATABASE_URL ??= 'postgresql://stub:stub@localhost:55999/stub';
    process.env.JWT_SECRET ??= 'health-e2e-secret-32-bytes-padding!';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    restoreEnv('DATABASE_URL', savedDatabaseUrl);
    restoreEnv('JWT_SECRET', savedJwtSecret);
  });

  it('GET /health/live → 200 ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/ready → 200 when DB healthy', async () => {
    prismaStub.isHealthy.mockResolvedValueOnce(true);
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: true });
  });

  it('GET /health/ready → 503 when DB down', async () => {
    prismaStub.isHealthy.mockResolvedValueOnce(false);
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
  });
});
