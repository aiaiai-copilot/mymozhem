import { z } from 'zod';

// Wire-имена — dotted-lowercase (shortEventNameSchema, erratum нейминга ф.2).
export const drawRunPayload = z.strictObject({
  drawId: z.uuid(), // клиентский uuid — идемпотентность команды розыгрыша
  // ADR-012 §4 / REQ-RWD-002b: розыгрыш без сущности приза — «выбор победителя».
  prizeId: z.uuid().optional(),
});
export const drawCompletedPayload = z.strictObject({
  drawId: z.uuid(),
  // Ключ обязателен (nullable ≠ optional): безпризовость — явный факт кадра
  // (REQ-DEV-007: аддитивная эволюция — старый призовой кадр остаётся валидным).
  prizeId: z.uuid().nullable(),
  winnerId: z.uuid(), // только id (REQ-SEC-009); имя — из membership-проекции
});
