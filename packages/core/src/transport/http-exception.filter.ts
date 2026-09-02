import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { MembershipError } from '../membership/membership.errors';
import { AuthError } from '../auth/auth.errors';
import { OAuthError } from '../oauth/oauth.errors';
import { RoomError } from '../room/room.errors';

// Единственная точка маппинга ошибка → HTTP (design §5): контроллеры статусов не знают.
// Наружу — ровно {code} (REQ-SEC-006); полное исключение уходит только в серверный лог.
const STATUS_BY_WIRE_CODE = {
  ROOM_JOIN_DENIED: 403,
  RATE_LIMITED: 429,
  ROOM_PARTICIPANT_LIMIT_REACHED: 409,
  // Срез исключения (REQ-ID-006, design-таблица маппинга): добавлено в Task 4 —
  // расширение MEMBERSHIP_ERROR_CODES без этих статусов ломает compile-time
  // exhaustive-маппинг ниже (гейт Task 4); спек-кейсы фильтра — Task 7.
  ACTOR_NOT_MEMBER: 403,
  ACTOR_NOT_ORGANIZER: 403,
  TARGET_NOT_MEMBER: 404,
  TARGET_NOT_EXCLUDABLE: 409,
  REQUEST_INVALID: 400,
  SESSION_INVALID: 401,
  // OAuth-срез (REQ-ID-015/009, design 2026-09-02 §7).
  OAUTH_NOT_CONFIGURED: 503,
  OAUTH_REDIRECT_INVALID: 400,
  OAUTH_STATE_INVALID: 401,
  OAUTH_ACCESS_DENIED: 403,
  OAUTH_EXCHANGE_FAILED: 502,
  OAUTH_EMAIL_UNVERIFIED: 403,
  OAUTH_EMAIL_CONFLICT: 409,
  // Первый HTTP-путь RoomError (POST /rooms, REQ-ID-005).
  ROOM_ORGANIZER_NOT_REGISTERED: 403,
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
    } else if (exception instanceof AuthError || exception instanceof OAuthError) {
      // Design §11: наружу все отказы refresh слиты в один SESSION_INVALID, поэтому
      // различие reuse/expired/unknown обязан нести серверный лог — иначе сигнал кражи
      // токена не оставляет следа для расследования. Та же норма для OAuthError
      // (причина отказа флоу — в логе, наружу ровно {code}). Message обоих классов
      // безопасен: фиксированные строки + familyId/sub, без token-материала.
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
    if (exception instanceof OAuthError) return exception.code;
    if (exception instanceof RoomError) {
      // Покрытие частичное (design §11): по HTTP в этом срезе достижим только
      // ROOM_ORGANIZER_NOT_REGISTERED; прочие коды — INTERNAL_ERROR с error-логом.
      return exception.code === 'ROOM_ORGANIZER_NOT_REGISTERED' ? exception.code : 'INTERNAL_ERROR';
    }
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
