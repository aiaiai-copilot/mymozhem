import { z } from 'zod';

// POST /auth/organizer (ADR-012 §2): bootstrap единственного REGISTERED инстанса
// по setup-токену из конфигурации. Длина проверяется сервером сравнением с
// конфигом (timing-safe), здесь — только форма.
export const organizerBootstrapRequestSchema = z.strictObject({
  setupToken: z.string().min(1),
});
export type OrganizerBootstrapRequest = z.infer<typeof organizerBootstrapRequestSchema>;
