import { z } from 'zod';
import { awardResponseSchema } from './award-response';

export const listRewardsResponseSchema = z.strictObject({
  awards: z.array(awardResponseSchema),
});
export type ListRewardsResponse = z.infer<typeof listRewardsResponseSchema>;
