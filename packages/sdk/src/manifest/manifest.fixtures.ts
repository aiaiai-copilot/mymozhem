import type { AppManifest } from './manifest.schema';

export const validManifests: AppManifest[] = [
  {
    appId: 'quiz',
    manifestVersion: 1,
    contractRange: '^1.0.0',
    appSettings: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        title: { type: 'string', 'x-visibility': 'public' },
        correctAnswers: { type: 'array', items: { type: 'number' } },
      },
      required: ['title', 'correctAnswers'],
      additionalProperties: false,
    },
    events: {
      'answer.submitted': {
        schema: {
          type: 'object',
          properties: { roundId: { type: 'string' }, choice: { type: 'number' } },
          required: ['roundId', 'choice'],
          additionalProperties: false,
        },
        visibility: 'module-private',
      },
      'round.opened': {
        schema: { type: 'object', properties: {}, additionalProperties: false },
        visibility: 'public',
      },
    },
  },
];

export const invalidManifestCases: { name: string; value: unknown }[] = [
  {
    name: 'appId is not a slug',
    value: { ...validManifests[0], appId: 'Quiz App' },
  },
  {
    name: 'appId claims the reserved core namespace',
    value: { ...validManifests[0], appId: 'core' },
  },
  {
    name: 'manifestVersion is not a positive integer',
    value: { ...validManifests[0], manifestVersion: 0 },
  },
  {
    name: 'contractRange is not a semver range',
    value: { ...validManifests[0], contractRange: 'whatever' },
  },
  {
    name: 'event short name would forge a namespace',
    value: {
      ...validManifests[0],
      events: { 'Bad.Key!': { schema: { type: 'object' }, visibility: 'public' } },
    },
  },
  {
    name: 'event declares an unknown visibility ceiling',
    value: {
      ...validManifests[0],
      events: { 'answer.submitted': { schema: { type: 'object' }, visibility: 'secret' } },
    },
  },
  {
    name: 'event definition misses its visibility ceiling (REQ-CTR-009 makes it mandatory)',
    value: {
      ...validManifests[0],
      events: { 'answer.submitted': { schema: { type: 'object' } } },
    },
  },
  {
    name: 'manifest carries a capabilities field (rewards is phase 3 — design §5)',
    value: { ...validManifests[0], capabilities: ['rewards'] },
  },
];
