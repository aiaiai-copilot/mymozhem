import { z } from 'zod';

// Wire-имена — dotted-lowercase (shortEventNameSchema, erratum нейминга ф.2).
export const drawRunPayload = z.strictObject({
  drawId: z.uuid(), // клиентский uuid — идемпотентность команды розыгрыша
  prizeId: z.uuid(),
});
export const drawCompletedPayload = z.strictObject({
  drawId: z.uuid(),
  prizeId: z.uuid(),
  winnerId: z.uuid(), // только id (REQ-SEC-009); имя — из membership-проекции
});
