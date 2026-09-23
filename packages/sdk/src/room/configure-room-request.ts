import { z } from 'zod';
import { appIdSchema } from '../events/event-type';

// POST /rooms/:roomId/configure (дизайн UI-среза, решение №9). settings — JSON-объект
// appSettings: семантическую валидацию делает app-registry (REQ-CORE-007), здесь — форма.
export const configureRoomRequestSchema = z.strictObject({
  appId: appIdSchema,
  manifestVersion: z.number().int().positive(),
  settings: z.record(z.string(), z.unknown()),
});
export type ConfigureRoomRequest = z.infer<typeof configureRoomRequestSchema>;
