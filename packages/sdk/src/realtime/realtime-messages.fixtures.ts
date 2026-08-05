import type { PublishRequest, RoomSnapshot, SubscribeRequest } from './realtime-messages';

export const validSubscribeRequest: SubscribeRequest = {
  roomId: '11111111-1111-4111-8111-111111111111',
};

export const validPublishRequests: PublishRequest[] = [
  { type: 'quiz.answer.submitted', payload: { roundId: 'r1', choice: 2 } },
  {
    type: 'quiz.answer.submitted',
    payload: { roundId: 'r1', choice: 2 },
    visibility: 'organizer',
  },
];

export const validSnapshot: RoomSnapshot = {
  events: [
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
  ],
  appSettings: { roundsCount: 5 },
};

export const invalidSubscribeRequestCases: { name: string; value: unknown }[] = [
  { name: 'extra key (strictObject)', value: { ...validSubscribeRequest, since: 'x' } },
  { name: 'roomId not a uuid', value: { roomId: 'room-1' } },
];

export const invalidPublishRequestCases: { name: string; value: unknown }[] = [
  {
    name: 'type without namespace',
    value: { type: 'activated', payload: {} },
  },
  {
    name: 'visibility outside the enum',
    value: { type: 'quiz.answer.submitted', payload: {}, visibility: 'friends-only' },
  },
  {
    name: 'extra key (strictObject)',
    value: { type: 'quiz.answer.submitted', payload: {}, actorId: 'spoof' },
  },
];

export const invalidSnapshotCases: { name: string; value: unknown }[] = [
  {
    name: 'event carrying seq outward (REQ-RT-011a)',
    value: {
      ...validSnapshot,
      events: [{ ...validSnapshot.events[0], seq: 7 }],
    },
  },
  {
    name: 'replay cursor field (no cursor exists in MVP)',
    value: { ...validSnapshot, cursor: 'eyJzZXEiOjQyfQ==' },
  },
];
