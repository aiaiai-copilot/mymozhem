import { randomUUID } from 'node:crypto';
import { Global, Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { stdSerializers, type DestinationStream } from 'pino';
import { ConfigModule } from '../config/config.module';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';

// REQ-OPS-004 (ф.4, дизайн §2): структурные JSON-логи поверх nestjs-pino.
// Корреляция requestId — uuid в req.id (pino-http кладёт его в каждую строку лога
// запроса, а RequestIdModule отражает в x-request-id ответа); roomId/actorId
// привязываются потребителями через logger.assign/поля в операционных точках
// (Task 8), не middleware-магией.

// Опциональное назначение логов: прод — stdout (pino default); тесты подставляют
// буферный Writable и читают фактические JSON-строки (observability.int-spec).
export const PINO_STREAM = Symbol('PINO_STREAM');

interface GenReqIdReq {
  headers: Record<string, unknown>;
}
interface GenReqIdRes {
  setHeader(name: string, value: string): void;
}

// requestId — uuid; отражаем в ответ для разбора инцидентов с игроками.
// Nest-Fastify присваивает raw req.id ДО middleware (fastify-middie: raw.id = req.id
// — счётчик 'req-N'), а pino-http зовёт genReqId только на пустой req.id — поэтому
// uuid обязан присвоить pre-middleware, иначе в лог уйдёт платформенный 'req-N'.
export function requestIdMiddleware(
  req: { id?: unknown },
  res: GenReqIdRes,
  next: () => void,
): void {
  const id = randomUUID();
  req.id = id;
  res.setHeader('x-request-id', id);
  next();
}

// Pre-middleware requestId: ОБЯЗАН исполняться раньше LoggerModule (pino-http
// замораживает req.id в child-логгере при входе — позже его не переопределить).
// Nest сортирует middleware по distance модуля, @Global-модули — первыми, а между
// собой — в порядке регистрации. LoggerModule nestjs-pino — @Global, поэтому этот
// модуль тоже @Global и обязан импортироваться РАНЬШЕ PinoLoggerModule
// (см. ObservabilityModule — порядок в imports значим).
@Global()
@Module({})
export class RequestIdModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestIdMiddleware).forRoutes('*');
  }
}

// Чистая фабрика опций pino-http — юнит-тестируема без Nest (pino-options.spec).
export function buildPinoHttpOptions(config: AppConfig): {
  level: string;
  genReqId: (req: GenReqIdReq, res: GenReqIdRes) => string;
  serializers: { req: (req: unknown) => Record<string, unknown> };
  redact: { paths: string[]; censor: string };
} {
  return {
    level: config.LOG_LEVEL,
    // Запасной путь для платформ без предустановленного req.id (не Nest-Fastify):
    // pino-http зовёт genReqId, только если req.id ещё пуст; в нашем стеке
    // requestIdMiddleware присваивает uuid раньше (см. выше).
    genReqId: (_req: GenReqIdReq, res: GenReqIdRes): string => {
      const id = randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    serializers: {
      // I-1 (REQ-SEC-009): std-сериализатор req несёт url С querystring и поле query —
      // OAuth callback (/auth/google/callback?code=…&state=…) сливал бы code/state
      // в каждую строку лога. База — stdSerializers.req (id/method/headers/remoteAddress
      // сохранены), из результата удалены query и querystring в url. Redact заголовков
      // применяется к сериализованному объекту — продолжает работать.
      req: (req: unknown): Record<string, unknown> => {
        const serialized = stdSerializers.req(req as Parameters<typeof stdSerializers.req>[0]) as unknown as Record<
          string,
          unknown
        >;
        delete serialized.query;
        if (typeof serialized.url === 'string') serialized.url = serialized.url.split('?')[0];
        return serialized;
      },
    },
    // Тела и payload'ы не логируются нормой дизайна; секретные заголовки маскируем.
    // C-1: set-cookie ОТВЕТА (refresh-токен, OAuth state/PKCE) — в том же ряду:
    // std-сериализатор res печатает response headers.
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
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
