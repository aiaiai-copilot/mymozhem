import { z } from 'zod';

// Эффекты награждения (design 2026-09-10 §2, подход A): возвращаются модулем из
// handlePublish вместе с коммитами и исполняются диспетчером в той же транзакции
// outbox.run ДО коммита событий. Это статические zod-схемы: эффекты не входят в
// манифест и в JSON Schema не конвертируются.
export const awardPrizeEffectSchema = z.strictObject({
  kind: z.literal('award.prize'),
  prizeId: z.uuid(),
  winnerId: z.uuid(),
});
export const awardPointsEffectSchema = z.strictObject({
  kind: z.literal('award.points'),
  identityId: z.uuid(),
  points: z.number().int().positive(), // REQ-RWD-002a: начисления в MVP только положительные
  reason: z.string().min(1).optional(),
});
export const appEffectSchema = z.discriminatedUnion('kind', [
  awardPrizeEffectSchema,
  awardPointsEffectSchema,
]);
export type AppEffect = z.infer<typeof appEffectSchema>;
