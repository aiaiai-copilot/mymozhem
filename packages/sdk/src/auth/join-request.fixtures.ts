export const validJoinRequests: unknown[] = [
  { code: 'ABCDEFGH', displayName: 'Alex' },
  { code: 'x', displayName: '  Аня  ' },
  { code: 'ABCDEFGH', displayName: 'Гляделкин', role: 'spectator' },
];
export const invalidJoinRequests: unknown[] = [
  {},
  { code: 'ABCDEFGH' },
  { displayName: 'Alex' },
  { code: '', displayName: 'Alex' },
  { code: 'ABCDEFGH', displayName: '' },
  { code: 'ABCDEFGH', displayName: 'x'.repeat(41) },
  { code: 'ABCDEFGH', displayName: 'Alex', extra: true }, // strictObject
  { code: 'ABCDEFGH', displayName: 'Alex', role: 'organizer' }, // привилегированные роли через флаг не назначаются (REQ-ID-011)
  'not-an-object',
];
