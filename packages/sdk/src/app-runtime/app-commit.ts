import { z } from 'zod';
import { shortEventNameSchema } from '../events/event-type';
import { visibilitySchema } from '../visibility/visibility';

// Что модуль просит ядро зафиксировать. actor: 'publisher' —
// событие атрибутируется клиенту (membership-гейт и per-actor rate-limit применяются);
// 'server' — эмиссия модуля (actorId=null, гейты не применяются, как в commitAppEvent).
export const appCommitActorSchema = z.enum(['publisher', 'server']);
export const appCommitSchema = z.strictObject({
  shortName: shortEventNameSchema,
  payload: z.record(z.string(), z.unknown()),
  visibility: visibilitySchema,
  actor: appCommitActorSchema,
});
export type AppCommit = z.infer<typeof appCommitSchema>;
