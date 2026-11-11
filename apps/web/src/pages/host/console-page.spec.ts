import { describe, expect, it } from 'vitest';
import type { AwardResponse, RosterEntry } from '@mymozhem/sdk';
import { ApiError } from '../../api/api-error';
import {
  commandErrorText,
  isStaleRoomJoinError,
  participantsCount,
  pendingAwardsCount,
} from './console-page';

// Тексты отказа publish-команд ведущего (находка Н1, решение 7): ack-таймаут
// не значит «не исполнилось» — честное «нет подтверждения», повтор руками
// безопасен (сервер отвечает конфликтом состояния). Коды — из RoomConnection
// (T1). Прочее — прежний честный код / прежний сетевой текст.
describe('commandErrorText', () => {
  it('NOT_CONNECTED и PUBLISH_TIMEOUT → «Нет подтверждения команды…» (решение 7)', () => {
    const text =
      'Нет подтверждения команды — проверьте, не применилась ли она, прежде чем повторять.';
    expect(commandErrorText(new ApiError('NOT_CONNECTED', 0))).toBe(text);
    expect(commandErrorText(new ApiError('PUBLISH_TIMEOUT', 0))).toBe(text);
  });

  it('прочий ApiError — прежний честный код; сеть — прежний текст', () => {
    expect(commandErrorText(new ApiError('ROOM_NOT_ACTIVE', 409))).toBe(
      'Команда не выполнена (ROOM_NOT_ACTIVE).',
    );
    expect(commandErrorText(new TypeError('fetch failed'))).toBe(
      'Ошибка сети. Команда не выполнена.',
    );
  });
});

// Поверхность отказа стартовой подписки (joinErrorText) переехала в
// state/use-room-binding (фикс-волна батча C, финревью Important 2: поверхность
// общая для play/console/screen) — её кейсы живут в use-room-binding.spec.ts.

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

const member = (role: RosterEntry['role']): RosterEntry => ({
  identityId: '0f8fad5b-d9cb-469f-a165-70867728950e',
  displayName: 'Ёж-88',
  role,
});

// Знаменатель разбора «не успели» в reveal (бриф T9): считаем только
// участников — организатор/наблюдатель в квиз не играют.
describe('participantsCount', () => {
  it('считает только role participant', () => {
    const members: RosterEntry[] = [
      member('organizer'),
      member('participant'),
      member('spectator'),
      member('participant'),
    ];
    expect(participantsCount(members)).toBe(2);
  });

  it('пустой ростер → 0', () => {
    expect(participantsCount([])).toBe(0);
  });
});

const award = (status: AwardResponse['status']): AwardResponse => ({
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  roomId: '11111111-1111-4111-8111-111111111111',
  prizeId: null,
  winnerId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  status,
  sourceAppId: 'quiz',
  createdAt: '2026-10-20T10:00:00.000Z',
  fulfilledAt: null,
  revokedAt: null,
});

// Подсказка экрана «Квиз окончен» (бриф T9, дизайн п. 18): невручённые =
// статус AWARDED; вручённые/отозванные подсказку не порождают.
describe('pendingAwardsCount', () => {
  it('считает только AWARDED', () => {
    const awards: AwardResponse[] = [award('AWARDED'), award('FULFILLED'), award('REVOKED'), award('AWARDED')];
    expect(pendingAwardsCount(awards)).toBe(2);
  });

  it('нет наград → 0 (подсказки нет)', () => {
    expect(pendingAwardsCount([])).toBe(0);
  });
});
