import { Test, type TestingModule } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigModule } from '../config/config.module';
import { APP_CONFIG } from '../config/config.tokens';
import { TEST_CONFIG } from '../testing/test-config';
import { MetricsService } from './metrics.service';
import { ObservabilityModule } from './observability.module';

// HTTP-граница экспозиции метрик (REQ-OPS-004, дизайн ф.4 §3/§0.3): fastify-
// адаптер, дерево ConfigModule + ObservabilityModule. БД не нужна — контроллер
// читает только registry MetricsService. Эндпоинт открытый (решение владельца)
// — как /health: авторизация и CORS-гейты не применяются.
describe('Observability /metrics (int)', () => {
  let moduleRef: TestingModule;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, ObservabilityModule],
    })
      // ConfigModule читает process.env — в int-лайне подменяем инертным конфигом.
      .overrideProvider(APP_CONFIG)
      .useValue(TEST_CONFIG)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /metrics — 200, text format, 4 метрики REQ-OPS-004', async () => {
    const metrics = moduleRef.get(MetricsService);
    metrics.connectionAdded('11111111-1111-4111-8111-111111111111');
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('mymozhem_active_connections{roomId="11111111-1111-4111-8111-111111111111"} 1');
    expect(res.body).toContain('mymozhem_publish_to_deliver_seconds');
    expect(res.body).toContain('mymozhem_replay_duration_seconds');
    expect(res.body).toContain('mymozhem_event_commit_errors_total');
  });

  it('GET /metrics не требует авторизации (открытый — решение владельца, дизайн §0.3)', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' }); // без заголовков
    expect(res.statusCode).toBe(200);
  });
});
