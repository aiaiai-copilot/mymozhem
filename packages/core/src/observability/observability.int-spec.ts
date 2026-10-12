import { Writable } from 'node:stream';
import { Global, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigModule } from '../config/config.module';
import { APP_CONFIG } from '../config/config.tokens';
import { TEST_CONFIG } from '../testing/test-config';
import { MetricsService } from './metrics.service';
import { ObservabilityModule } from './observability.module';
import { PINO_STREAM } from './pino-logger.module';

// Приёмник логов pino для спеки (тестовое состояние файла — REQ-CORE-004
// запрещает мутабельный module-level state в src ПРОД-кода, не в спеках).
const logLines: string[] = [];
const logBuffer = new Writable({
  write(chunk, _enc, cb) {
    logLines.push(chunk.toString());
    cb();
  },
});

// PINO_STREAM инжектится в фабрику динамического (и @Global) LoggerModule —
// провайдер из корневого TestingModule туда не виден; виден только глобальный.
@Global()
@Module({
  providers: [{ provide: PINO_STREAM, useValue: logBuffer }],
  exports: [PINO_STREAM],
})
class TestPinoStreamModule {}

// HTTP-граница экспозиции метрик (REQ-OPS-004, дизайн ф.4 §3/§0.3): fastify-
// адаптер, дерево ConfigModule + ObservabilityModule. БД не нужна — контроллер
// читает только registry MetricsService. Эндпоинт открытый (решение владельца)
// — как /health: авторизация и CORS-гейты не применяются.
describe('Observability /metrics (int)', () => {
  let moduleRef: TestingModule;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, ObservabilityModule, TestPinoStreamModule],
    })
      // ConfigModule читает process.env — в int-лайне подменяем инертным конфигом.
      // LOG_LEVEL поднят до info: строка лога запроса пишется на уровне info,
      // а с PINO_STREAM-буфером шум в консоль всё равно не уходит.
      .overrideProvider(APP_CONFIG)
      .useValue({ ...TEST_CONFIG, LOG_LEVEL: 'info' })
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

  it('строка лога запроса — JSON с requestId; authorization/cookie замаскированы (Review Focus 5)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: 'Bearer SECRET-TOKEN', cookie: 'mm_refresh=SECRET-COOKIE' },
    });
    expect(res.statusCode).toBe(200);
    const requestId = res.headers['x-request-id'];
    const line = logLines
      .map((l) => l.trim())
      .filter((l) => l.includes('"req"'))
      .pop();
    expect(line).toBeDefined();
    const parsed = JSON.parse(line!);
    expect(parsed.req.id).toBe(requestId);
    expect(line).not.toContain('SECRET-TOKEN');
    expect(line).not.toContain('SECRET-COOKIE');
  });
});
