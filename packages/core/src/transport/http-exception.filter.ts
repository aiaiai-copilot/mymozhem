import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { ContractError } from '@mymozhem/sdk';
import { MembershipError } from '../membership/membership.errors';
import { AuthError } from '../auth/auth.errors';
import { OAuthError } from '../oauth/oauth.errors';
import { RoomError } from '../room/room.errors';
import { RealtimeError } from '../realtime/realtime.errors';

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
  // UI-срез (lifecycle-контур, решение №9): остальные RoomError идут в wire 1:1
  // (строковый паритет заложен в room.errors.ts). 409 — отказ из-за состояния
  // комнаты (переход, заморозка, гонка), не из-за формы запроса.
  ROOM_TRANSITION_INVALID: 409,
  ROOM_CONFLICT: 409,
  ROOM_NOT_CONFIGURED: 409,
  ROOM_SETTINGS_FROZEN: 409,
  // Фаза 3 (design 2026-09-10 §2): REST-контур rewards.
  ROOM_NOT_ACTIVE: 409,
  PRIZE_UNKNOWN: 404,
  AWARD_UNKNOWN: 404,
  PRIZE_FUND_EXHAUSTED: 409,
  REWARD_ALREADY_RESOLVED: 409,
  // Фаза 4 (C-8.1): гонка свип/розыгрыш проиграна награждением — как прочие 409 конфликта состояния.
  IDENTITY_ANONYMIZED: 409,
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
      // Покрытие полное (UI-срез, lifecycle-контур): все коды RoomError присутствуют
      // в STATUS_BY_WIRE_CODE и идут наружу 1:1; неизвестный код — fail-closed в
      // INTERNAL_ERROR с error-логом, как прежде.
      return exception.code in STATUS_BY_WIRE_CODE ? (exception.code as WireCode) : 'INTERNAL_ERROR';
    }
    // Ошибки контракта с wire-паритетом кода (rewards ф.3 и далее): класс-
    // специфичные ветки выше сохраняют свои правила свёртки; сюда попадают
    // ContractError'ы, коды которых сознательно добавлены в STATUS_BY_WIRE_CODE.
    if (exception instanceof ContractError && exception.code in STATUS_BY_WIRE_CODE) {
      return exception.code as WireCode;
    }
    // RoomNotActiveError (createPrize, rewards ф.3) и realtime-вариант
    // ActorNotMemberError (membership-гейт эмита, realtime-срез) — RealtimeError,
    // НЕ ContractError: симметричная ветка паритета, охраняемая членством кода в
    // STATUS_BY_WIRE_CODE. Blast radius ровно два realtime-кода: ROOM_NOT_ACTIVE
    // (409) и ACTOR_NOT_MEMBER (403 — тот же wire-код и статус, что у
    // membership-варианта в ветке выше); прочие падают в INTERNAL_ERROR ниже.
    if (exception instanceof RealtimeError && exception.code in STATUS_BY_WIRE_CODE) {
      return exception.code as WireCode;
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
