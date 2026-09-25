import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { ConfigModule } from '../config/config.module';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';

// REQ-OPS-004 (ф.4, дизайн §2): структурные JSON-логи поверх nestjs-pino.
// Корреляция requestId — из genReqId (pino-http кладёт его в req.id и в каждую
// строку лога запроса); roomId/actorId привязываются потребителями через
// logger.assign/поля в операционных точках (Task 8), не middleware-магией.

// Опциональное назначение логов: прод — stdout (pino default); тесты подставляют
// буферный Writable и читают фактические JSON-строки (observability.int-spec).
export const PINO_STREAM = Symbol('PINO_STREAM');

interface GenReqIdReq {
  headers: Record<string, unknown>;
}
interface GenReqIdRes {
  setHeader(name: string, value: string): void;
}

// Чистая фабрика опций pino-http — юнит-тестируема без Nest (pino-options.spec).
export function buildPinoHttpOptions(config: AppConfig): {
  level: string;
  genReqId: (req: GenReqIdReq, res: GenReqIdRes) => string;
  redact: { paths: string[]; censor: string };
} {
  return {
    level: config.LOG_LEVEL,
    // requestId — uuid; отражаем в ответ для разбора инцидентов с игроками.
    genReqId: (_req: GenReqIdReq, res: GenReqIdRes): string => {
      const id = randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    // Тела и payload'ы не логируются нормой дизайна; секретные заголовки маскируем.
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie'],
      censor: '[redacted]',
    },
  };
}

// Dynamic module определён ОДИН раз и импортируется только по ссылке — Nest
// дедуплицирует его по метаданным, повторный импорт в дереве не порождает
// дубль-регистрацию провайдеров. LoggerModule nestjs-pino — @Global: после
// включения в дерево PinoLogger резолвится в любом модуле этого дерева.
export const PinoLoggerModule = LoggerModule.forRootAsync({
  imports: [ConfigModule],
  inject: [APP_CONFIG, { token: PINO_STREAM, optional: true }],
  useFactory: (config: AppConfig, stream?: DestinationStream) => ({
    pinoHttp: stream === undefined ? buildPinoHttpOptions(config) : { ...buildPinoHttpOptions(config), stream },
  }),
});

// Boundary observability-libs-contained: потребители импортируют PinoLogger
// ОТСЮДА, не из nestjs-pino напрямую (Task 8 опирается на этот реэкспорт).
export { PinoLogger } from 'nestjs-pino';
