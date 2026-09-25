import { Writable } from 'node:stream';
import pino from 'pino';
import { TEST_CONFIG } from '../testing/test-config';
import { buildPinoHttpOptions, requestIdMiddleware } from './pino-logger.module';

// REQ-OPS-004 (ф.4, дизайн §2): опции pino-http — чистая фабрика, юнит-гейты.
describe('buildPinoHttpOptions (REQ-OPS-004)', () => {
  it('уровень — из конфига', () => {
    expect(buildPinoHttpOptions({ ...TEST_CONFIG, LOG_LEVEL: 'debug' }).level).toBe('debug');
  });

  it('redact маскирует authorization, cookie и set-cookie ответа (Review Focus 5, C-1)', () => {
    const opts = buildPinoHttpOptions(TEST_CONFIG);
    expect(opts.redact.paths).toEqual([
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ]);
  });

  // Сквозная проверка через реальную сериализацию pino (C-1 + I-1): refresh/OAuth
  // секреты — в set-cookie ответа и в query OAuth callback — не покидают процесс
  // в строке лога; query из url срезается, поле query отсутствует (REQ-SEC-009).
  it('строка лога: set-cookie/authorization замаскированы, query (code/state) срезан из url и не логируется', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    // info: строка запроса пишется на уровне info (TEST_CONFIG.LOG_LEVEL='warn' подавил бы её).
    const opts = buildPinoHttpOptions({ ...TEST_CONFIG, LOG_LEVEL: 'info' });
    const logger = pino({ level: opts.level, serializers: opts.serializers, redact: opts.redact }, stream);
    const req = {
      id: 'r-1',
      method: 'GET',
      url: '/auth/google/callback?code=SECRET-CODE&state=SECRET-STATE',
      headers: { authorization: 'Bearer SECRET-TOKEN', cookie: 'mm_refresh=SECRET-COOKIE' },
      remoteAddress: '127.0.0.1',
    };
    const res = {
      statusCode: 200,
      headers: { 'set-cookie': 'mm_refresh=SECRET-REFRESH; HttpOnly; Path=/auth' },
    };
    logger.info({ req, res }, 'request completed');
    const line = lines.join('');
    for (const secret of ['SECRET-CODE', 'SECRET-STATE', 'SECRET-TOKEN', 'SECRET-COOKIE', 'SECRET-REFRESH']) {
      expect(line).not.toContain(secret);
    }
    expect(line).toContain('[redacted]');
    const parsed = JSON.parse(line);
    expect(parsed.req.url).toBe('/auth/google/callback');
    expect(parsed.req).not.toHaveProperty('query');
  });

  it('genReqId генерирует uuid и отражает его в заголовок x-request-id', () => {
    const setHeader = jest.fn();
    const id = buildPinoHttpOptions(TEST_CONFIG).genReqId({ headers: {} }, { setHeader });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', id);
  });

  // Nest-Fastify присваивает raw req.id ДО middleware (fastify-middie: raw.id = req.id,
  // счётчик 'req-N'), поэтому genReqId pino-http не вызывается — uuid и отражение в
  // заголовок обеспечивает pre-middleware (RequestIdModule).
  it('requestIdMiddleware: uuid в req.id (перезапись платформенного req-N) и x-request-id, next()', () => {
    const setHeader = jest.fn();
    const next = jest.fn();
    const req: { id?: unknown } = { id: 'req-1' };
    requestIdMiddleware(req, { setHeader }, next);
    expect(req.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', req.id);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
