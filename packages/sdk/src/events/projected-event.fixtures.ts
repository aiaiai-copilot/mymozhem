import type { LogEvent } from './log-event.schema';
import type { ProjectedEvent } from './projected-event.schema';

export const validProjectedEvents: ProjectedEvent[] = [
  {
    type: 'core.room.activated',
    payload: { appId: 'quiz', manifestVersion: 1 },
    actorId: null,
  },
  {
    type: 'quiz.answer.submitted',
    payload: { roundId: 'r1', choice: 2 },
    actorId: '22222222-2222-4222-8222-222222222222',
  },
];

// The internal envelope a careless handler might hand to a client verbatim.
const internalLogEvent: LogEvent = {
  roomId: '11111111-1111-4111-8111-111111111111',
  seq: 42,
  type: 'quiz.answer.submitted',
  payload: { roundId: 'r1', choice: 2 },
  actorId: '22222222-2222-4222-8222-222222222222',
  visibility: 'public',
  schemaVersion: 1,
};

export const invalidProjectedEventCases: { name: string; value: unknown }[] = [
  {
    name: 'whole log envelope spread outward (leaks seq — REQ-RT-011a)',
    value: internalLogEvent,
  },
  {
    name: 'seq smuggled onto an otherwise clean projection',
    value: { ...validProjectedEvents[0], seq: 0 },
  },
  {
    name: 'visibility label sent outward',
    value: { ...validProjectedEvents[0], visibility: 'public' },
  },
  {
    name: 'replay cursor sent outward (no cursor exists in MVP — design §4.4)',
    value: { ...validProjectedEvents[0], cursor: 'eyJzZXEiOjQyfQ==' },
  },
  {
    name: 'event type without an owning namespace',
    value: { ...validProjectedEvents[0], type: 'activated' },
  },
];
