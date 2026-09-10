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
        clientInitiated: true,
      },
      // Производный тип (эмиссия модуля): клиенту закрыт (design 2026-09-09 §2).
      'round.opened': {
        schema: { type: 'object', properties: {}, additionalProperties: false },
        visibility: 'public',
        clientInitiated: false,
      },
    },
  },
  // Capability фазы 3 (design 2026-09-10): манифест с делегированием rewards
  // (REQ-RWD-001/005) — валиден.
  {
    appId: 'lottery',
    manifestVersion: 1,
    contractRange: '^1.0.0',
    capabilities: ['rewards'],
    appSettings: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        fundLimit: { type: 'number', 'x-visibility': 'public' },
      },
      required: ['fundLimit'],
      additionalProperties: false,
    },
    events: {
      'draw.completed': {
        schema: {
          type: 'object',
          properties: { drawId: { type: 'string' } },
          required: ['drawId'],
          additionalProperties: false,
        },
        visibility: 'public',
        clientInitiated: false,
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
    name: 'contractRange is not bounded above (>=1.0.0 admits a future breaking major)',
    value: { ...validManifests[0], contractRange: '>=1.0.0' },
  },
  {
    name: 'contractRange constrains almost nothing yet is not literally * (>=0.0.0-0)',
    value: { ...validManifests[0], contractRange: '>=0.0.0-0' },
  },
  {
    name: 'event short name would forge a namespace',
    value: {
      ...validManifests[0],
      events: { 'Bad.Key!': { schema: { type: 'object' }, visibility: 'public', clientInitiated: true } },
    },
  },
  {
    name: 'event declares an unknown visibility ceiling',
    value: {
      ...validManifests[0],
      events: { 'answer.submitted': { schema: { type: 'object' }, visibility: 'secret', clientInitiated: true } },
    },
  },
  {
    name: 'event definition misses its visibility ceiling (REQ-CTR-009 makes it mandatory)',
    value: {
      ...validManifests[0],
      events: { 'answer.submitted': { schema: { type: 'object' }, clientInitiated: true } },
    },
  },
  {
    name: 'event definition misses clientInitiated (design 2026-09-09 §2 makes it mandatory)',
    value: {
      ...validManifests[0],
      events: { 'answer.submitted': { schema: { type: 'object' }, visibility: 'public' } },
    },
  },
  {
    name: 'unknown capability value',
    value: { ...validManifests[0], capabilities: ['teleport'] },
  },
];
