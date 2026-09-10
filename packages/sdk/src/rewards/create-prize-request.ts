import { z } from 'zod';

export const createPrizeRequestSchema = z.strictObject({
  name: z.string().min(1).max(200),
  quantity: z.number().int().positive().max(10_000),
});
export type CreatePrizeRequest = z.infer<typeof createPrizeRequestSchema>;
