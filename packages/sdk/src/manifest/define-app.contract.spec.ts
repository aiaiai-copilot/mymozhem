import { z } from 'zod';
import { ContractError } from '../errors/error-codes';
import { CONTRACT_VERSION } from '../contract-version';
import { appManifestSchema } from './manifest.schema';
import { readPropertyVisibility } from './app-settings-visibility';
import { defineApp, toRegisteredSchema } from './define-app';
import { representableSchemas, unrepresentableSchemas } from './define-app.fixtures';

const quizSettings = z.object({
  title: z.string().meta({ 'x-visibility': 'public' }),
  correctAnswers: z.array(z.number()),
});

const defineQuiz = () =>
  defineApp({
    appId: 'quiz',
    manifestVersion: 1,
    appSettings: quizSettings,
    events: {
      'answer.submitted': {
        schema: z.object({ roundId: z.string(), choice: z.number().int() }),
        visibility: 'module-private',
      },
    },
  });

describe('conversion guard', () => {
  it.each(representableSchemas.map((c) => [c.name, c.schema] as const))(
    'converts a legal schema: %s',
    (_name, schema) => {
      expect(() => toRegisteredSchema(schema)).not.toThrow();
    },
  );

  // Design §6: the loss is SILENT, which is the ADR-008 class of defect — the app
  // believes the core enforces a rule the core never received. Reject instead.
  it.each(unrepresentableSchemas.map((c) => [c.name, c.schema] as const))(
    'refuses a schema that would not survive conversion: %s',
    (_name, schema) => {
      expect(() => toRegisteredSchema(schema)).toThrow(
        expect.objectContaining({ code: 'SCHEMA_NOT_REPRESENTABLE' }),
      );
    },
  );

  // This is the fixture that guards the guard (design §6). It rests on a zod
  // internal (_zod.def.checks); a zod upgrade that breaks detection must fail CI
  // loudly rather than quietly open the gate. Do not silence it — fix the detector.
  //
  // The premise check is that zod's own output for the refined schema is IDENTICAL
  // to its output for the same schema with the refinement stripped — i.e. the
  // refinement leaves no trace at all, under whatever keyword a future zod might
  // use for it. Asserting the literal string 'refine' is absent would pass even if
  // zod started representing refinements under a different keyword.
  it('still detects that zod drops .refine() silently', () => {
    const bare = z.object({ a: z.number(), b: z.number() });
    const refined = bare.refine((v) => v.a < v.b);

    expect(JSON.stringify(z.toJSONSchema(refined))).toBe(JSON.stringify(z.toJSONSchema(bare)));
    expect(() => toRegisteredSchema(refined)).toThrow(ContractError);
  });

  it('keeps the checks that DO convert', () => {
    const json = toRegisteredSchema(z.object({ nick: z.string().min(1) }));
    expect(JSON.stringify(json)).toContain('minLength');
  });
});

describe('defineApp', () => {
  it('produces a manifest that satisfies the manifest contract', () => {
    expect(appManifestSchema.safeParse(defineQuiz()).success).toBe(true);
  });

  it('defaults contractRange to the current major of the contract', () => {
    expect(defineQuiz().contractRange).toBe(`^${CONTRACT_VERSION}`);
  });

  it('keeps an explicit contractRange', () => {
    const manifest = defineApp({
      appId: 'quiz',
      manifestVersion: 2,
      contractRange: '>=1.0.0 <2.0.0',
      appSettings: quizSettings,
      events: {},
    });
    expect(manifest.contractRange).toBe('>=1.0.0 <2.0.0');
  });

  it('registers events under short names and carries their ceiling', () => {
    const manifest = defineQuiz();
    expect(Object.keys(manifest.events)).toEqual(['answer.submitted']);
    expect(manifest.events['answer.submitted'].visibility).toBe('module-private');
  });

  it('snapshots appSettings with visibility annotations intact (ADR-008)', () => {
    const manifest = defineQuiz();
    expect(readPropertyVisibility(manifest.appSettings, 'title')).toBe('public');
    // Never annotated → module-private, and that is what the outcome-deciding data
    // must be (REQ-CORE-008).
    expect(readPropertyVisibility(manifest.appSettings, 'correctAnswers')).toBe('module-private');
  });

  // REQ-CTR-002: what the registry stores must be serializable — no live zod.
  it('produces a JSON-serializable manifest with no live objects in it', () => {
    const manifest = defineQuiz();
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });

  it('refuses an app that would take the core namespace', () => {
    expect(() =>
      defineApp({ appId: 'core', manifestVersion: 1, appSettings: quizSettings, events: {} }),
    ).toThrow(ContractError);
  });

  it('refuses an unrepresentable event schema with a typed error', () => {
    expect(() =>
      defineApp({
        appId: 'quiz',
        manifestVersion: 1,
        appSettings: quizSettings,
        events: {
          'answer.submitted': {
            schema: z.object({ a: z.number(), b: z.number() }).refine((v) => v.a < v.b),
            visibility: 'module-private',
          },
        },
      }),
    ).toThrow(ContractError);
  });

  it('refuses a misspelled visibility annotation', () => {
    expect(() =>
      defineApp({
        appId: 'quiz',
        manifestVersion: 1,
        appSettings: z.object({ title: z.string().meta({ 'x-visibility': 'publik' }) }),
        events: {},
      }),
    ).toThrow(ContractError);
  });
});
