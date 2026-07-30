import { ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AuthError } from '../auth/auth.errors';
import {
  JoinRateLimitedError,
  RoomJoinDeniedError,
  RoomParticipantLimitReachedError,
} from '../membership/membership.errors';
import { HttpExceptionFilter } from './http-exception.filter';

type ReplyMock = { status: jest.Mock; send: jest.Mock };

const makeFilter = () => {
  const filter = new HttpExceptionFilter();
  const reply: ReplyMock = { status: jest.fn().mockReturnThis(), send: jest.fn() };
  return { filter, reply };
};

// Фильтр тестируется без Nest-контекста: мок ArgumentsHost отдаёт reply напрямую.
const makeHost = (reply: ReplyMock): ArgumentsHost =>
  ({ switchToHttp: () => ({ getResponse: () => reply }) }) as unknown as ArgumentsHost;

describe('HttpExceptionFilter (REQ-SEC-006)', () => {
  // Глушим серверный лог на всём сьюте: 5xx-кейсы иначе печатают исключение в консоль jest.
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  // Полная таблица маппинга design §5 + инвариант REQ-SEC-006: наружу ровно {code}.
  const cases: Array<[string, unknown, number, string]> = [
    ['join denied', new RoomJoinDeniedError('no room for code'), 403, 'ROOM_JOIN_DENIED'],
    // JOIN_RATE_LIMITED (core) → RATE_LIMITED (wire) — решение владельца, design §0.6.
    ['rate limited', new JoinRateLimitedError('x'), 429, 'RATE_LIMITED'],
    ['room full', new RoomParticipantLimitReachedError('x'), 409, 'ROOM_PARTICIPANT_LIMIT_REACHED'],
    ['auth', new AuthError('SESSION_INVALID', 'reuse detected, family revoked'), 401, 'SESSION_INVALID'],
    ['zod', new ZodError([]), 400, 'REQUEST_INVALID'],
    ['unknown', new Error('boom with sensitive internals'), 500, 'INTERNAL_ERROR'],
  ];

  it.each(cases)('%s → typed wire error without internals', (_label, err, status, code) => {
    const { filter, reply } = makeFilter();
    filter.catch(err, makeHost(reply));
    expect(reply.status).toHaveBeenCalledWith(status);
    const body = reply.send.mock.calls[0][0];
    expect(body).toEqual({ code }); // ровно {code} — ни message, ни stack (REQ-SEC-006)
    expect(JSON.stringify(body)).not.toContain('sensitive internals');
  });

  it('types Prisma raw-query errors (P2010 + SQLSTATE 22P02 uuid-сырьё, parked minor) without details', () => {
    const err = new Prisma.PrismaClientKnownRequestError(
      'Raw query failed. Code: `22P02`. Message: invalid input syntax for type uuid',
      { code: 'P2010', clientVersion: '7.8.0' },
    );
    const { filter, reply } = makeFilter();
    filter.catch(err, makeHost(reply));
    expect(reply.status).toHaveBeenCalledWith(400);
    const body = reply.send.mock.calls[0][0];
    expect(body).toEqual({ code: 'REQUEST_INVALID' });
    expect(JSON.stringify(body)).not.toContain('22P02');
  });

  it('keeps the status of Nest built-in HttpException (404 неизвестного роута), typed code', () => {
    const { filter, reply } = makeFilter();
    filter.catch(new HttpException('Not Found', HttpStatus.NOT_FOUND), makeHost(reply));
    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send.mock.calls[0][0]).toEqual({ code: 'REQUEST_INVALID' });
  });

  it('maps 5xx HttpException to INTERNAL_ERROR keeping its status', () => {
    const { filter, reply } = makeFilter();
    filter.catch(new HttpException('oops', HttpStatus.SERVICE_UNAVAILABLE), makeHost(reply));
    expect(reply.status).toHaveBeenCalledWith(503);
    expect(reply.send.mock.calls[0][0]).toEqual({ code: 'INTERNAL_ERROR' });
  });

  describe('server logging', () => {
    it('logs the full exception to the server log on 5xx', () => {
      const err = new Error('boom');
      const { filter, reply } = makeFilter();
      filter.catch(err, makeHost(reply));
      expect(errorSpy).toHaveBeenCalledWith(err);
    });

    it('logs AuthError message at warn level (design §11: различие reuse/expired/unknown живёт в серверном логе)', () => {
      const err = new AuthError('SESSION_INVALID', 'refresh reuse detected, family <uuid> revoked');
      const { filter, reply } = makeFilter();
      filter.catch(err, makeHost(reply));
      expect(warnSpy).toHaveBeenCalledWith('refresh reuse detected, family <uuid> revoked');
      expect(errorSpy).not.toHaveBeenCalled();
      // Wire не меняется: всё ещё ровно {code} (REQ-SEC-006).
      expect(reply.send.mock.calls[0][0]).toEqual({ code: 'SESSION_INVALID' });
    });

    it('does not log non-auth 4xx at all', () => {
      const { filter, reply } = makeFilter();
      filter.catch(new RoomJoinDeniedError('no room for code'), makeHost(reply));
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
