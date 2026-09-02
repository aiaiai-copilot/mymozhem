import { z } from 'zod';
import { roomJoinPolicySchema } from '../membership/room-join-policy';

// Wire-форма статуса комнаты принадлежит контракту (design §6); core-тип RoomStatus
// в room-state-machine.ts держит те же строки — сервис кастует на границе.
export const roomStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED']);
export type RoomStatus = z.infer<typeof roomStatusSchema>;

export const createRoomResponseSchema = z.strictObject({
  roomId: z.uuid(),
  code: z.string().trim().min(1),
  joinPolicy: roomJoinPolicySchema,
  status: roomStatusSchema,
});
export type CreateRoomResponse = z.infer<typeof createRoomResponseSchema>;
