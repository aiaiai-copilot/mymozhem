import { z } from 'zod';
import { roomJoinPolicySchema } from '../membership/room-join-policy';

// POST /rooms request body (REQ-ID-005 HTTP-путь, design 2026-09-02 §6). strict: лишние
// ключи не проходят границу. Пустое тело → дефолт 'guests' (REQ-ID-002).
export const createRoomRequestSchema = z.strictObject({
  joinPolicy: roomJoinPolicySchema.default('guests'),
});
export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;
