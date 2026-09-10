const UUID_A = '3f6b2b6e-9c5a-4f1e-8b2d-7a9c1e0f2a3b';
const UUID_B = '00000000-0000-4000-8000-000000000001';

export const validAppEffects: unknown[] = [
  { kind: 'award.prize', prizeId: UUID_A, winnerId: UUID_B },
  { kind: 'award.points', identityId: UUID_B, points: 100 },
  { kind: 'award.points', identityId: UUID_B, points: 900, reason: 'quiz.round' },
];

export const invalidAppEffects: unknown[] = [
  { kind: 'award.prize', prizeId: 'not-a-uuid', winnerId: UUID_B }, // невалидный uuid
  { kind: 'award.prize', prizeId: UUID_A }, // нет winnerId
  { kind: 'award.points', identityId: UUID_B, points: 0 }, // points строго положительные (MVP)
  { kind: 'award.points', identityId: UUID_B, points: -50 }, // отрицательные начисления вне MVP
  { kind: 'award.points', identityId: UUID_B, points: 1.5 }, // не int
  { kind: 'award.prize', prizeId: UUID_A, winnerId: UUID_B, extra: 1 }, // strictObject
  { kind: 'award.unknown', identityId: UUID_B }, // неизвестный kind
];
