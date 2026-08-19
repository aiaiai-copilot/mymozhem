import { excludeRequestSchema } from './exclude-request';
import { validExcludeRequests, invalidExcludeRequests } from './exclude-request.fixtures';

describe('excludeRequest contract (REQ-ID-006)', () => {
  it.each(validExcludeRequests.map((v) => [JSON.stringify(v), v] as const))('accepts %s', (_l, v) => {
    expect(excludeRequestSchema.safeParse(v).success).toBe(true);
  });
  it.each(invalidExcludeRequests.map((v) => [JSON.stringify(v), v] as const))('rejects %s', (_l, v) => {
    expect(excludeRequestSchema.safeParse(v).success).toBe(false);
  });
});
