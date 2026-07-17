import { ContractError } from '../errors/error-codes';
import type { JsonSchemaObject } from './manifest.schema';
import {
  VISIBILITY_ANNOTATION,
  appSettingsVisibilityMap,
  assertVisibilityAnnotations,
  readPropertyVisibility,
} from './app-settings-visibility';

const appSettings: JsonSchemaObject = {
  type: 'object',
  properties: {
    title: { type: 'string', 'x-visibility': 'public' },
    scoreboardMode: { type: 'string', 'x-visibility': 'organizer' },
    correctAnswers: { type: 'array', 'x-visibility': 'module-private' },
    hiddenWeights: { type: 'array' },
  },
};

describe('appSettings per-property visibility', () => {
  it('uses the annotation ADR-008 mandates', () => {
    expect(VISIBILITY_ANNOTATION).toBe('x-visibility');
  });

  it.each([
    ['title', 'public'],
    ['scoreboardMode', 'organizer'],
    ['correctAnswers', 'module-private'],
  ])('reads the declared level of %s', (property, expected) => {
    expect(readPropertyVisibility(appSettings, property)).toBe(expected);
  });

  // REQ-CORE-008 / ADR-008: absence of an annotation means module-private.
  // Forgetting to annotate must close, never open.
  it('treats an unannotated property as module-private', () => {
    expect(readPropertyVisibility(appSettings, 'hiddenWeights')).toBe('module-private');
  });

  it('treats an unknown property as module-private', () => {
    expect(readPropertyVisibility(appSettings, 'nope')).toBe('module-private');
  });

  it.each([
    ['no properties block', { type: 'object' }],
    ['properties is not an object', { type: 'object', properties: 'nonsense' }],
    ['property is not an object', { type: 'object', properties: { a: 'nonsense' } }],
  ])('fails safe when the schema is shaped unexpectedly: %s', (_name, schema) => {
    expect(readPropertyVisibility(schema as JsonSchemaObject, 'a')).toBe('module-private');
  });

  it('maps every property, defaulting the unannotated ones', () => {
    expect(appSettingsVisibilityMap(appSettings)).toEqual({
      title: 'public',
      scoreboardMode: 'organizer',
      correctAnswers: 'module-private',
      hiddenWeights: 'module-private',
    });
  });

  it('accepts annotations that are absent or valid', () => {
    expect(() => assertVisibilityAnnotations(appSettings)).not.toThrow();
  });

  it('rejects a misspelled annotation instead of silently hiding the property', () => {
    const typo: JsonSchemaObject = {
      type: 'object',
      properties: { title: { type: 'string', 'x-visibility': 'publik' } },
    };
    expect(() => assertVisibilityAnnotations(typo)).toThrow(ContractError);
    try {
      assertVisibilityAnnotations(typo);
    } catch (err) {
      expect((err as ContractError).code).toBe('MANIFEST_INVALID');
    }
  });
});
