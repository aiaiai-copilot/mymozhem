import { z } from 'zod';
import { prizeResponseSchema } from './prize-response';

// GET /rooms/:id/prizes (дизайн UI-среза §2): консоли нужны prizeId и остаток фонда.
export const listPrizesResponseSchema = z.strictObject({ prizes: z.array(prizeResponseSchema) });
export type ListPrizesResponse = z.infer<typeof listPrizesResponseSchema>;
