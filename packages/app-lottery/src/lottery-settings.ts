import { z } from 'zod';

// Атрибут розыгрыша (REQ-RWD-014): дефолт guests_allowed; verified = вес только
// у REGISTERED. Замораживается при ACTIVE (REQ-RT-004); изменение —
// переконфигурация в DRAFT (design §0.8).
export const lotterySettingsSchema = z.strictObject({
  drawEligibility: z
    .enum(['guests_allowed', 'verified'])
    .default('guests_allowed')
    .meta({ 'x-visibility': 'public' }),
});
export type LotterySettings = z.infer<typeof lotterySettingsSchema>;
