import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { MembershipError } from '../membership/membership.errors';
import { AuthError } from '../auth/auth.errors';

// Единственная точка маппинга ошибка → HTTP (design §5): контроллеры статусов не знают.
// Наружу — ровно {code} (REQ-SEC-006); полное исключение уходит только в серверный лог.
const STATUS_BY_WIRE_CODE = {
  ROOM_JOIN_DENIED: 403,
  RATE_LIMITED: 429,
  ROOM_PARTICIPANT_LIMIT_REACHED: 409,
  REQUEST_INVALID: 400,
  SESSION_INVALID: 401,
  INTERNAL_ERROR: 500,
} as const;

type WireCode = keyof typeof STATUS_BY_WIRE_CODE;

// Core не зависит от fastify напрямую (адаптер подключается в apps/server) — фильтру
// достаточно структурного минимума ответа; FastifyReply совместим по форме.
interface ReplyLike {
  status(statusCode: number): { send(body: unknown): unknown };
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<ReplyLike>();
    const code = this.toWireCode(exception);
    // Nest-встроенные HttpException (404 неизвестного роута и т.п.) сохраняют свой
    // статус («его status», маппинг design §5); wire-код при этом типизированный.
    const status: number =
      exception instanceof HttpException ? exception.getStatus() : STATUS_BY_WIRE_CODE[code];
    if (status >= 500) {
      this.logger.error(exception);
    } else if (exception instanceof AuthError) {
      // Design §11: наружу все отказы refresh слиты в один SESSION_INVALID, поэтому
      // различие reuse/expired/unknown обязан нести серверный лог — иначе сигнал кражи
      // токена не оставляет следа для расследования. Message AuthError безопасен:
      // token.service.ts кладёт туда только фиксированные строки и familyId (UUID),
      // без token-материала.
      this.logger.warn(exception.message);
    }
    void reply.status(status).send({ code });
  }

  private toWireCode(exception: unknown): WireCode {
    if (exception instanceof MembershipError) {
      // JOIN_RATE_LIMITED (core) → RATE_LIMITED (wire) — решение владельца, design §0.6.
      return exception.code === 'JOIN_RATE_LIMITED' ? 'RATE_LIMITED' : exception.code;
    }
    if (exception instanceof AuthError) return 'SESSION_INVALID';
    if (exception instanceof ZodError) return 'REQUEST_INVALID';
    // Prisma-сырьё (включая P2010+SQLSTATE 22P02 uuid-syntax — parked minor): типизируем,
    // детали не раскрываем. Отнесение всех P-кодов к 400 — решение дизайна §5.
    if (exception instanceof Prisma.PrismaClientKnownRequestError) return 'REQUEST_INVALID';
    if (exception instanceof HttpException) {
      return exception.getStatus() >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_INVALID';
    }
    return 'INTERNAL_ERROR';
  }
}
