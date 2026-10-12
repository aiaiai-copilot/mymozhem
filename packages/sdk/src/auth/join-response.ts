import { z } from 'zod';
import { tokenResponseSchema } from './token-response';

// Ответ POST /rooms/join (ADR-012 §3): фактический displayName (заданный или
// назначенный сервером псевдоним) — клиент сохраняет его для авто-rejoin.
export const joinResponseSchema = tokenResponseSchema.extend({
  displayName: z.string().min(1),
});
export type JoinResponse = z.infer<typeof joinResponseSchema>;
