import { contractErrorCodeSchema } from '../errors/error-codes';
import {
  publishOkAckSchema,
  publishRequestSchema,
  roomSnapshotSchema,
  subscribeOkAckSchema,
  subscribeRequestSchema,
} from './realtime-messages';
import {
  invalidPublishRequestCases,
  invalidSnapshotCases,
  invalidSubscribeRequestCases,
  validPublishRequests,
  validSnapshot,
  validSubscribeRequest,
} from './realtime-messages.fixtures';

describe('realtime messages contract', () => {
  it('accepts the valid subscribe request', () => {
    expect(subscribeRequestSchema.safeParse(validSubscribeRequest).success).toBe(true);
  });

  it.each(invalidSubscribeRequestCases.map((c) => [c.name, c.value] as const))(
    'rejects subscribe request: %s',
    (_name, value) => {
      expect(subscribeRequestSchema.safeParse(value).success).toBe(false);
    },
  );

  it.each(validPublishRequests.map((r, i) => [i, r] as const))(
    'accepts valid publish request #%i',
    (_i, request) => {
      expect(publishRequestSchema.safeParse(request).success).toBe(true);
    },
  );

  it.each(invalidPublishRequestCases.map((c) => [c.name, c.value] as const))(
    'rejects publish request: %s',
    (_name, value) => {
      expect(publishRequestSchema.safeParse(value).success).toBe(false);
    },
  );

  it('accepts the valid snapshot and the ok acks', () => {
    expect(roomSnapshotSchema.safeParse(validSnapshot).success).toBe(true);
    expect(subscribeOkAckSchema.safeParse({ ok: true, snapshot: validSnapshot }).success).toBe(true);
    expect(publishOkAckSchema.safeParse({ ok: true }).success).toBe(true);
  });

  it.each(invalidSnapshotCases.map((c) => [c.name, c.value] as const))(
    'rejects snapshot: %s',
    (_name, value) => {
      expect(roomSnapshotSchema.safeParse(value).success).toBe(false);
    },
  );

  it('ACTOR_NOT_MEMBER is a contract error code (design §0.5)', () => {
    expect(contractErrorCodeSchema.safeParse('ACTOR_NOT_MEMBER').success).toBe(true);
  });
});
