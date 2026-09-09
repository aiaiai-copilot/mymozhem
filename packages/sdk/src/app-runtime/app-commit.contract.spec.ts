import { appCommitSchema, appCommitActorSchema } from './app-commit';
import { validAppCommits, invalidAppCommits } from './app-commit.fixtures';

describe('appCommit contract (REQ-CTR-002/003)', () => {
  it.each(validAppCommits.map((v) => [JSON.stringify(v), v] as const))('accepts %s', (_l, v) => {
    expect(appCommitSchema.safeParse(v).success).toBe(true);
  });

  it.each(invalidAppCommits.map((v) => [JSON.stringify(v), v] as const))('rejects %s', (_l, v) => {
    expect(appCommitSchema.safeParse(v).success).toBe(false);
  });

  it('actor enum is exactly publisher | server', () => {
    expect([...appCommitActorSchema.options]).toEqual(['publisher', 'server']);
  });

  it('shortName stays lowercase: uppercase letters cannot slip a namespace lookalike in', () => {
    for (const shortName of ['Quiz.x', 'Answer.Submitted']) {
      expect(
        appCommitSchema.safeParse({ shortName, payload: {}, visibility: 'public', actor: 'server' }).success,
      ).toBe(false);
    }
  });
});
