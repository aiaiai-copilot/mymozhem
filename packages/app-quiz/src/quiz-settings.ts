import { z } from 'zod';

// appSettings (design §3 с правкой плана: видимость top-level,
// correctAnswers без аннотации → fail-safe module-private, REQ-CORE-008).
export const quizSettingsSchema = z.strictObject({
  questions: z
    .array(z.strictObject({ text: z.string().min(1), options: z.array(z.string().min(1)).min(2) }))
    .min(1)
    .meta({ 'x-visibility': 'public' }),
  correctAnswers: z.array(z.number().int().min(0)),
  minAnswerIntervalMs: z.number().int().min(0).meta({ 'x-visibility': 'public' }),
  scoring: z
    .strictObject({ base: z.number().int().positive(), step: z.number().int().min(0) })
    .meta({ 'x-visibility': 'public' }),
});
export type QuizSettings = z.infer<typeof quizSettingsSchema>;
