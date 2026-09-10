import Ajv2020 from 'ajv/dist/2020';
import {
  appManifestSchema,
  readPropertyVisibility,
  type Visibility,
} from '@mymozhem/sdk';
import { buildQuizManifest, QUIZ_APP_ID, QUIZ_MANIFEST_VERSION } from './quiz-manifest';

// REQ-CTR-005: the quiz manifest is validated against the contract it will live
// under — appManifestSchema for the form, Ajv over the REGISTERED JSON Schemas for
// what the core will actually enforce (REQ-CORE-007). The zod sources are the
// authoring surface; the registered snapshots are the artifact.
const manifest = buildQuizManifest();

const ajv = new Ajv2020({ allErrors: true, strict: false });

const ACTOR = '0f8fad5b-d9cb-469f-a165-70867728950e';
const ACTOR_2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const EXPECTED_EVENTS: ReadonlyArray<readonly [string, Visibility, boolean]> = [
  ['question.opened', 'public', true],
  ['answer.submitted', 'module-private', true],
  ['question.closed', 'public', true],
  ['game.finish', 'public', true],
  ['answer.accepted', 'public', false],
  ['question.revealed', 'public', false],
  ['game.finished', 'public', false],
];

describe('quiz manifest', () => {
  it('satisfies the manifest contract (appManifestSchema)', () => {
    expect(appManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it('carries the quiz identity', () => {
    expect(manifest.appId).toBe(QUIZ_APP_ID);
    expect(manifest.manifestVersion).toBe(QUIZ_MANIFEST_VERSION);
  });

  it('registers exactly the 7 quiz event types', () => {
    expect(Object.keys(manifest.events).sort()).toEqual(
      EXPECTED_EVENTS.map(([name]) => name).sort(),
    );
  });

  it.each(EXPECTED_EVENTS)(
    'event %s declares visibility=%s and clientInitiated=%s',
    (name, visibility, clientInitiated) => {
      const event = manifest.events[name];
      expect(event?.visibility).toBe(visibility);
      expect(event?.clientInitiated).toBe(clientInitiated);
    },
  );
});

describe('registered appSettings JSON Schema', () => {
  const validate = ajv.compile(manifest.appSettings);

  const validSettings = {
    questions: [
      { text: 'Столица Франции?', options: ['Париж', 'Лион'] },
      { text: '2+2?', options: ['3', '4', '5'] },
    ],
    correctAnswers: [0, 1],
    minAnswerIntervalMs: 1000,
    scoring: { base: 100, step: 10 },
  };

  it('accepts a valid settings snapshot', () => {
    expect(validate(validSettings)).toBe(true);
  });

  it('accepts correctAnswers shorter than questions (a question without a configured correct answer)', () => {
    expect(validate({ ...validSettings, correctAnswers: [0] })).toBe(true);
  });

  const invalidSettings: ReadonlyArray<readonly [string, unknown]> = [
    ['empty questions', { ...validSettings, questions: [] }],
    ['minAnswerIntervalMs below zero', { ...validSettings, minAnswerIntervalMs: -1 }],
    ['an unknown extra key', { ...validSettings, bogus: 1 }],
    [
      'a question with a single option',
      { ...validSettings, questions: [{ text: 'Q?', options: ['only'] }] },
    ],
    ['a question with an empty text', { ...validSettings, questions: [{ text: '', options: ['a', 'b'] }] }],
  ];

  it.each(invalidSettings)('rejects %s', (_description, settings) => {
    expect(validate(settings)).toBe(false);
  });
});

describe('registered event JSON Schemas', () => {
  const validatorFor = (name: string) => {
    const entry = manifest.events[name];
    if (!entry) {
      throw new Error(`no such event in the quiz manifest: ${name}`);
    }
    return ajv.compile(entry.schema);
  };

  const PAYLOAD_CASES: ReadonlyArray<readonly [string, string, unknown, boolean]> = [
    ['question.opened accepts a valid payload', 'question.opened', { questionIndex: 0 }, true],
    ['question.opened rejects a string questionIndex', 'question.opened', { questionIndex: '0' }, false],
    ['question.opened rejects an extra key', 'question.opened', { questionIndex: 0, extra: 1 }, false],
    ['answer.submitted accepts a valid payload', 'answer.submitted', { questionIndex: 0, optionIndex: 1 }, true],
    ['answer.submitted rejects a missing optionIndex', 'answer.submitted', { questionIndex: 0 }, false],
    ['answer.submitted rejects a string questionIndex', 'answer.submitted', { questionIndex: '0', optionIndex: 1 }, false],
    ['question.closed accepts a valid payload', 'question.closed', { questionIndex: 2 }, true],
    ['question.closed rejects a missing questionIndex', 'question.closed', {}, false],
    ['game.finish accepts an empty payload', 'game.finish', {}, true],
    ['game.finish rejects an extra key', 'game.finish', { force: true }, false],
    ['answer.accepted accepts a valid payload', 'answer.accepted', { questionIndex: 0, actorId: ACTOR }, true],
    ['answer.accepted rejects a non-string actorId', 'answer.accepted', { questionIndex: 0, actorId: 42 }, false],
    ['answer.accepted rejects a missing questionIndex', 'answer.accepted', { actorId: ACTOR }, false],
    [
      'question.revealed accepts a payload with correctIndex',
      'question.revealed',
      {
        questionIndex: 0,
        correctIndex: 1,
        awarded: [{ actorId: ACTOR, points: 110 }],
        totals: [{ actorId: ACTOR, total: 110 }],
      },
      true,
    ],
    [
      'question.revealed accepts a payload without correctIndex (no correct answer configured)',
      'question.revealed',
      { questionIndex: 1, awarded: [], totals: [] },
      true,
    ],
    [
      'question.revealed rejects negative points',
      'question.revealed',
      { questionIndex: 0, awarded: [{ actorId: ACTOR, points: -5 }], totals: [] },
      false,
    ],
    [
      'question.revealed rejects missing totals',
      'question.revealed',
      { questionIndex: 0, awarded: [] },
      false,
    ],
    [
      'game.finished accepts a valid standings payload',
      'game.finished',
      {
        standings: [
          { actorId: ACTOR, total: 320, place: 1 },
          { actorId: ACTOR_2, total: 210, place: 2 },
        ],
      },
      true,
    ],
    [
      'game.finished rejects place 0',
      'game.finished',
      { standings: [{ actorId: ACTOR, total: 0, place: 0 }] },
      false,
    ],
    [
      'game.finished rejects an entry missing place',
      'game.finished',
      { standings: [{ actorId: ACTOR, total: 10 }] },
      false,
    ],
  ];

  it.each(PAYLOAD_CASES)('%s', (_description, eventName, payload, expectedValid) => {
    expect(validatorFor(eventName)(payload)).toBe(expectedValid);
  });
});

describe('appSettings visibility annotations', () => {
  // REQ-CORE-008: outcome-deciding data must never leave the module. correctAnswers
  // is deliberately left UNANNOTATED in the schema, so the fail-safe default
  // (module-private) is what the core projects by — this test pins that.
  it('keeps correctAnswers module-private via the fail-safe default', () => {
    expect(readPropertyVisibility(manifest.appSettings, 'correctAnswers')).toBe('module-private');
  });

  it.each([['questions'], ['minAnswerIntervalMs'], ['scoring']] as const)(
    'exposes %s as public',
    (property) => {
      expect(readPropertyVisibility(manifest.appSettings, property)).toBe('public');
    },
  );
});
