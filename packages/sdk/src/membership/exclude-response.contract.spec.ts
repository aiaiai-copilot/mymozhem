import { excludeResponseSchema } from './exclude-response';

describe('excludeResponse contract (REQ-ID-006)', () => {
  it.each([{ excluded: true }, { excluded: false }])('accepts %j', (v) => {
    expect(excludeResponseSchema.safeParse(v).success).toBe(true);
  });
  it.each([{}, { excluded: 'yes' }, { excluded: true, extra: 1 }, 'x'])('rejects %j', (v) => {
    expect(excludeResponseSchema.safeParse(v).success).toBe(false);
  });
});
