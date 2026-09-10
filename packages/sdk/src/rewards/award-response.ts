import { z } from 'zod';

export const AWARD_STATUSES = ['AWARDED', 'FULFILLED', 'REVOKED'] as const;
export const awardStatusSchema = z.enum(AWARD_STATUSES);

export const awardResponseSchema = z.strictObject({
  id: z.uuid(),
  roomId: z.uuid(),
  prizeId: z.uuid().nullable(),
  winnerId: z.uuid(),
  status: awardStatusSchema,
  sourceAppId: z.string(),
  createdAt: z.string(),
  fulfilledAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type AwardResponse = z.infer<typeof awardResponseSchema>;
