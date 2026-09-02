import { createRoomRequestSchema } from './create-room-request';
import { validCreateRoomRequests, invalidCreateRoomRequests } from './create-room-request.fixtures';

describe('createRoomRequest contract (REQ-ID-005, REQ-ID-002)', () => {
  it.each(validCreateRoomRequests.map((v) => [JSON.stringify(v), v] as const))('accepts %s', (_l, v) => {
    expect(createRoomRequestSchema.safeParse(v).success).toBe(true);
  });
  it.each(invalidCreateRoomRequests.map((v) => [JSON.stringify(v), v] as const))('rejects %s', (_l, v) => {
    expect(createRoomRequestSchema.safeParse(v).success).toBe(false);
  });
  it('defaults joinPolicy to guests on an empty body (REQ-ID-002)', () => {
    expect(createRoomRequestSchema.parse({})).toEqual({ joinPolicy: 'guests' });
  });
});
