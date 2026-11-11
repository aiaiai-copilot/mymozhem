import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/api-error';
import { isTerminalSessionFailure } from './session-failure';

// Классификация отказов сессии (дизайн §3(В), builder-check Q1, план I-1):
// терминален ровно серверный отказ по существу — ApiError 4xx (401 refresh:
// кука протухла/отозвана; 403/404/409 join: комната терминальна). Всё
// остальное — временное: сеть лежит (TypeError), таймаут (AbortError),
// инфраструктурный обрыв (5xx — рестарт сервера посреди события не должен
// убивать все гостевые сессии разом), wire-уровень (статус 0: ack-таймауты
// PUBLISH_TIMEOUT/SUBSCRIBE_TIMEOUT/NOT_CONNECTED).
describe('isTerminalSessionFailure', () => {
  it.each([
    ['401 refresh → терминал', new ApiError('SESSION_INVALID', 401), true],
    ['403 join → терминал', new ApiError('ROOM_JOIN_DENIED', 403), true],
    ['404 join → терминал', new ApiError('ROOM_NOT_FOUND', 404), true],
    ['409 join → терминал', new ApiError('ROOM_NOT_JOINABLE', 409), true],
    ['5xx → временный (инфраструктурный обрыв)', new ApiError('HTTP_502', 502), false],
    ['wire-отказ (статус 0) → временный', new ApiError('PUBLISH_TIMEOUT', 0), false],
    ['сетевой TypeError → временный', new TypeError('fetch failed'), false],
    ['таймаутный AbortError → временный', new DOMException('aborted', 'AbortError'), false],
    ['неизвестная ошибка → временный', new Error('boom'), false],
    ['не-Error → временный', 'строка', false],
  ])('%s', (_label, err, expected) => {
    expect(isTerminalSessionFailure(err)).toBe(expected);
  });
});
