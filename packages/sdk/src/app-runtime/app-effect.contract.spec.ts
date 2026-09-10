import { appEffectSchema } from './app-effect';
import { validAppEffects, invalidAppEffects } from './app-effect.fixtures';

describe('appEffectSchema', () => {
  it.each(validAppEffects.map((v) => [JSON.stringify(v), v] as const))('accepts %s', (_l, v) => {
    expect(appEffectSchema.safeParse(v).success).toBe(true);
  });
  it.each(invalidAppEffects.map((v) => [JSON.stringify(v), v] as const))('rejects %s', (_l, v) => {
    expect(appEffectSchema.safeParse(v).success).toBe(false);
  });
});
