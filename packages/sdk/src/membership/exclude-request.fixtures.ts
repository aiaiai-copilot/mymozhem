export const validExcludeRequests: unknown[] = [{}, { reason: 'нарушение правил' }, { reason: '  x  ' }];
export const invalidExcludeRequests: unknown[] = [
  { reason: '' },
  { reason: 'x'.repeat(501) },
  { reason: 42 },
  { reason: 'ok', extra: true }, // strictObject
  'not-an-object',
];
