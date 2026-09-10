import { z } from 'zod';

export const prizeResponseSchema = z.strictObject({
  id: z.uuid(),
  roomId: z.uuid(),
  name: z.string(),
  quantityTotal: z.number().int(),
  quantity: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PrizeResponse = z.infer<typeof prizeResponseSchema>;
