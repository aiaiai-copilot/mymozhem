import { z } from 'zod';

// Payload-схемы (источник типов для handler'ов и манифеста).
export const questionOpenedPayload = z.strictObject({ questionIndex: z.number().int().min(0) });
export const answerSubmittedPayload = z.strictObject({
  questionIndex: z.number().int().min(0),
  optionIndex: z.number().int().min(0),
});
export const questionClosedPayload = z.strictObject({ questionIndex: z.number().int().min(0) });
export const finishGamePayload = z.strictObject({});
export const answerAcceptedPayload = z.strictObject({
  questionIndex: z.number().int().min(0),
  actorId: z.uuid(),
});
export const scoreEntryPayload = z.strictObject({ actorId: z.uuid(), total: z.number().int() });
export const questionRevealedPayload = z.strictObject({
  questionIndex: z.number().int().min(0),
  // Опционально: отсутствует, когда у вопроса не сконфигурирован правильный ответ
  // (correctAnswers[questionIndex] === undefined) — «нет правильного» не выражается
  // sentinel-значением, поле просто опущено.
  correctIndex: z.number().int().min(0).optional(),
  awarded: z.array(z.strictObject({ actorId: z.uuid(), points: z.number().int().min(0) })),
  totals: z.array(scoreEntryPayload),
});
export const gameFinishedPayload = z.strictObject({
  standings: z.array(scoreEntryPayload.extend({ place: z.number().int().min(1) })),
});
