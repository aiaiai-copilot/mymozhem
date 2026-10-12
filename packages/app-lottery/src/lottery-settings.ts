import { z } from 'zod';

// ADR-012: draw_eligibility удалена (verified-ветка REQ-RWD-014 приостановлена —
// REGISTERED только организатор). Схема сохраняется как точка расширения
// appSettings лотереи; strict — посторонние ключи отклоняются.
export const lotterySettingsSchema = z.strictObject({});
export type LotterySettings = z.infer<typeof lotterySettingsSchema>;
