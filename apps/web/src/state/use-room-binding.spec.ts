import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/api-error';
import { joinErrorCode } from './use-room-binding';

// Код отказа стартового join (находка №3): консоль различает «комната из прошлой
// БД» (ACTOR_NOT_MEMBER → экран «не найдена») и сетевой обрыв (баннер). Хук
// без DOM-тестов (нет @testing-library/react — известный deferred T10), поэтому
// маппинг — чистая функция.
describe('joinErrorCode', () => {
  it('ApiError → wire-код', () => {
    expect(joinErrorCode(new ApiError('ACTOR_NOT_MEMBER', 0))).toBe('ACTOR_NOT_MEMBER');
    expect(joinErrorCode(new ApiError('NOT_FOUND', 404))).toBe('NOT_FOUND');
  });

  it('не-ApiError (сеть, ZodError) → null', () => {
    expect(joinErrorCode(new TypeError('fetch failed'))).toBeNull();
    expect(joinErrorCode(new Error('boom'))).toBeNull();
    expect(joinErrorCode('строка')).toBeNull();
  });
});
