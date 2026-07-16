import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '@mymozhem/core';
import { AppModule } from '../src/app.module';

describe('Health (e2e)', () => {
  let app: NestFastifyApplication;
  const prismaStub = { isHealthy: jest.fn(), onModuleInit: jest.fn(), onModuleDestroy: jest.fn() };

  beforeAll(async () => {
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
