export const validJoinRequests: unknown[] = [
  { code: 'ABCDEFGH', displayName: 'Alex' },
  { code: 'x', displayName: '  Аня  ' },
];
export const invalidJoinRequests: unknown[] = [
  {},
  { code: 'ABCDEFGH' },
  { displayName: 'Alex' },
  { code: '', displayName: 'Alex' },
  { code: 'ABCDEFGH', displayName: '' },
  { code: 'ABCDEFGH', displayName: 'x'.repeat(41) },
  { code: 'ABCDEFGH', displayName: 'Alex', extra: true }, // strictObject
  'not-an-object',
];
