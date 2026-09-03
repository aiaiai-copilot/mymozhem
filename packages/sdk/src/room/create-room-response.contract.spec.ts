import { createRoomResponseSchema } from './create-room-response';

// zod v4 z.uuid() requires a valid RFC 9562 version nibble — v4-compatible forms only.
const ROOM_ID = '00000000-0000-4000-8000-000000000001';

describe('createRoomResponse contract (REQ-ID-005)', () => {
  const valid: unknown[] = [
    { roomId: ROOM_ID, code: 'ABCDEFGH', joinPolicy: 'guests', status: 'DRAFT' },
    { roomId: ROOM_ID, code: 'x', joinPolicy: 'registered', status: 'ACTIVE' },
    { roomId: ROOM_ID, code: 'ABCDEFGH', joinPolicy: 'invite_only', status: 'COMPLETED' },
    { roomId: ROOM_ID, code: 'ABCDEFGH', joinPolicy: 'guests', status: 'CANCELLED' },
  ];
  const invalid: unknown[] = [
    { roomId: 'not-a-uuid', code: 'ABCDEFGH', joinPolicy: 'guests', status: 'DRAFT' },
    // zod v4: RFC 9562 version nibble обязателен — v0-формы не проходят.
    { roomId: '00000000-0000-0000-0000-000000000001', code: 'ABCDEFGH', joinPolicy: 'guests', status: 'DRAFT' },
    { roomId: ROOM_ID, code: '', joinPolicy: 'guests', status: 'DRAFT' },
    { roomId: ROOM_ID, code: 'ABCDEFGH', joinPolicy: 'admin', status: 'DRAFT' },
    { roomId: ROOM_ID, code: 'ABCDEFGH', joinPolicy: 'guests', status: 'PAUSED' },
    { roomId: ROOM_ID, code: 'ABCDEFGH', joinPolicy: 'guests', status: 'DRAFT', extra: true }, // strictObject
    { roomId: ROOM_ID, code: 'ABCDEFGH', joinPolicy: 'guests' }, // нет status
    'not-an-object',
  ];
  it.each(valid.map((v) => [JSON.stringify(v), v] as const))('accepts %s', (_l, v) => {
    expect(createRoomResponseSchema.safeParse(v).success).toBe(true);
  });
  it.each(invalid.map((v) => [JSON.stringify(v), v] as const))('rejects %s', (_l, v) => {
    expect(createRoomResponseSchema.safeParse(v).success).toBe(false);
  });
});
