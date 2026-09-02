export const validCreateRoomRequests: unknown[] = [
  {},
  { joinPolicy: 'registered' },
  { joinPolicy: 'invite_only' },
];
export const invalidCreateRoomRequests: unknown[] = [
  { joinPolicy: 'admin' },
  { extra: true }, // strictObject
  'not-an-object',
];
