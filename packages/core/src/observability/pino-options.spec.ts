import { TEST_CONFIG } from '../testing/test-config';
import { buildPinoHttpOptions } from './pino-logger.module';

// REQ-OPS-004 (ф.4, дизайн §2): опции pino-http — чистая фабрика, юнит-гейты.
describe('buildPinoHttpOptions (REQ-OPS-004)', () => {
  it('уровень — из конфига', () => {
    expect(buildPinoHttpOptions({ ...TEST_CONFIG, LOG_LEVEL: 'debug' }).level).toBe('debug');
  });

  it('redact маскирует authorization и cookie (Review Focus 5)', () => {
    const opts = buildPinoHttpOptions(TEST_CONFIG);
    expect(opts.redact.paths).toEqual(['req.headers.authorization', 'req.headers.cookie']);
  });

  it('genReqId генерирует uuid и отражает его в заголовок x-request-id', () => {
    const setHeader = jest.fn();
    const id = buildPinoHttpOptions(TEST_CONFIG).genReqId({ headers: {} }, { setHeader });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', id);
  });
});
