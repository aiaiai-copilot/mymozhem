import { z } from 'zod';

// Ответ exclude (REQ-ID-006). excluded:false — типизированный no-op повторного
// исключения (дизайн §0.4, прецедент идемпотентности REQ-RWD-007).
export const excludeResponseSchema = z.strictObject({
  excluded: z.boolean(),
});
export type ExcludeResponse = z.infer<typeof excludeResponseSchema>;
