import type { LogEvent } from './log-event.schema';

export const validLogEvents: LogEvent[] = [
  {
    roomId: '11111111-1111-4111-8111-111111111111',
    seq: 0,
    type: 'room.created',
    payload: { policy: 'guests' },
    actorId: null,
    visibility: 'public',
    schemaVersion: 1,
  },
  {
    roomId: '11111111-1111-4111-8111-111111111111',
    seq: 1,
    type: 'quiz.answer_scored',
    payload: { correct: true },
    actorId: '22222222-2222-4222-8222-222222222222',
    visibility: 'module-private',
    schemaVersion: 1,
  },
];

export const invalidLogEventCases: { name: string; value: unknown }[] = [
  {
    name: 'unknown visibility level',
    value: { ...validLogEvents[0], visibility: 'secret' },
  },
  {
    name: 'missing seq',
    value: (() => {
      const { seq, ...rest } = validLogEvents[0];
      return rest;
    })(),
  },
  {
    name: 'negative seq',
    value: { ...validLogEvents[0], seq: -1 },
  },
  {
    name: 'non-uuid roomId',
    value: { ...validLogEvents[0], roomId: 'not-a-uuid' },
  },
];
