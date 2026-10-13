import { describe, expect, it } from 'vitest';
import { isStaleRoomJoinError } from './console-page';

// Стейл-roomId (находка №3): комната из прошлой БД → join отказывает
// ACTOR_NOT_MEMBER; консоль обязана показать «комната не найдена», а не
// вечный «Нет соединения». NOT_FOUND — на случай будущего REST-восстановления
// комнаты; сетевые отказы (null) сюда не попадают.
describe('isStaleRoomJoinError', () => {
  it('ACTOR_NOT_MEMBER и NOT_FOUND → true', () => {
    expect(isStaleRoomJoinError('ACTOR_NOT_MEMBER')).toBe(true);
    expect(isStaleRoomJoinError('NOT_FOUND')).toBe(true);
  });

  it('прочие коды и null (сеть) → false', () => {
    expect(isStaleRoomJoinError('ROOM_NOT_ACTIVE')).toBe(false);
    expect(isStaleRoomJoinError('SESSION_INVALID')).toBe(false);
    expect(isStaleRoomJoinError(null)).toBe(false);
  });
});
