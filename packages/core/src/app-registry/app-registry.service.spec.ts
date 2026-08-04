import { Test } from '@nestjs/testing';
import Ajv2020 from 'ajv/dist/2020';
import { ContractError, validManifests, invalidManifestCases } from '@mymozhem/sdk';
import { AppRegistryService } from './app-registry.service';
import { AppRegistryModule } from './app-registry.module';
import { AppManifestUnknownError, AppSettingsInvalidError } from './app-registry.errors';

// Синхронный catch-helper: validateSettings бросает, не возвращает промис.
const capture = (fn: () => void): unknown => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
};

describe('AppRegistryService', () => {
  it('builds its registry from the injected manifests', () => {
    const { appId, manifestVersion } = validManifests[0];
    const svc = new AppRegistryService([validManifests[0]]);
    expect(svc.getManifest(appId, manifestVersion)).toEqual(validManifests[0]);
  });

  it('fails construction (boot) when an injected manifest is invalid', () => {
    expect(() => new AppRegistryService([invalidManifestCases[0].value])).toThrow(ContractError);
  });
});

describe('AppRegistryService.validateSettings (REQ-CORE-007)', () => {
  const manifest = validManifests[0]; // quiz@1: { title: string, correctAnswers: number[] }, additionalProperties: false

  it('accepts settings that satisfy the manifest schema', () => {
    const svc = new AppRegistryService([manifest]);
    expect(() =>
      svc.validateSettings('quiz', 1, { title: 'Friday quiz', correctAnswers: [0, 2] }),
    ).not.toThrow();
  });

  it.each([
    { name: 'missing required property', value: { title: 'Friday quiz' } },
    { name: 'wrong property type', value: { title: 'Friday quiz', correctAnswers: 'nope' } },
    { name: 'additional property', value: { title: 'Friday quiz', correctAnswers: [0], hack: true } },
  ])('rejects invalid settings with APP_SETTINGS_INVALID ($name)', ({ value }) => {
    const svc = new AppRegistryService([manifest]);
    const err = capture(() => svc.validateSettings('quiz', 1, value));
    expect(err).toBeInstanceOf(AppSettingsInvalidError);
    expect((err as AppSettingsInvalidError).code).toBe('APP_SETTINGS_INVALID');
  });

  it.each([
    { name: 'unknown appId', appId: 'nope', version: 1 },
    { name: 'unknown manifestVersion', appId: 'quiz', version: 99 },
  ])('rejects an unknown manifest with APP_MANIFEST_UNKNOWN ($name)', ({ appId, version }) => {
    const svc = new AppRegistryService([manifest]);
    const err = capture(() =>
      svc.validateSettings(appId, version, { title: 't', correctAnswers: [] }),
    );
    expect(err).toBeInstanceOf(AppManifestUnknownError);
    expect((err as AppManifestUnknownError).code).toBe('APP_MANIFEST_UNKNOWN');
  });

  it('compiles the validator once per (appId, manifestVersion) key', () => {
    const spy = jest.spyOn(Ajv2020.prototype, 'compile');
    try {
      const svc = new AppRegistryService([manifest]);
      svc.validateSettings('quiz', 1, { title: 'a', correctAnswers: [] });
      svc.validateSettings('quiz', 1, { title: 'b', correctAnswers: [1] });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('event-commit read-path (REQ-CTR-008/009)', () => {
  it('getEventDefinition returns schema+visibility for a known type, undefined for unknown', () => {
    const svc = new AppRegistryService([validManifests[0]]);
    const def = svc.getEventDefinition('quiz', 1, 'answer.submitted');
    expect(def?.visibility).toBe('module-private');
    expect(def?.schema).toMatchObject({ type: 'object' });
    expect(svc.getEventDefinition('quiz', 1, 'answer.v2')).toBeUndefined();
    expect(svc.getEventDefinition('nope', 1, 'answer.submitted')).toBeUndefined();
  });

  it('eventValidatorFor compiles, caches and validates the registered schema', () => {
    const svc = new AppRegistryService([validManifests[0]]);
    const def = svc.getEventDefinition('quiz', 1, 'answer.submitted');
    if (!def) throw new Error('fixture must define answer.submitted');
    const v1 = svc.eventValidatorFor('quiz', 1, 'answer.submitted', def.schema);
    const v2 = svc.eventValidatorFor('quiz', 1, 'answer.submitted', def.schema);
    expect(v1).toBe(v2); // кэш REQ-CORE-007
    expect(v1({ roundId: 'r1', choice: 2 })).toBe(true);
    expect(v1({ roundId: 'r1', choice: 'x' })).toBe(false);
  });

  it('describeEventErrors renders ajv errors after a failed validation', () => {
    const svc = new AppRegistryService([validManifests[0]]);
    const def = svc.getEventDefinition('quiz', 1, 'answer.submitted');
    if (!def) throw new Error('fixture must define answer.submitted');
    const v = svc.eventValidatorFor('quiz', 1, 'answer.submitted', def.schema);
    expect(v({})).toBe(false);
    expect(svc.describeEventErrors(v)).toMatch(/roundId|required/);
  });
});

describe('AppRegistryModule', () => {
  it('provides AppRegistryService with an empty registry by default', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppRegistryModule],
    }).compile();
    const svc = moduleRef.get(AppRegistryService);
    const { appId, manifestVersion } = validManifests[0];
    expect(svc.getManifest(appId, manifestVersion)).toBeUndefined();
  });
});
