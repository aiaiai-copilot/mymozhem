import { z } from 'zod';
import { composeEventType } from './event-type';
import type { EventTypeDefinition } from './core-events';

// Core-owned события контура rewards (design 2026-09-10 §2): коммитит rewards-модуль
// ядра через EventLogService.commitRewardsEvent в той же транзакции, что и запись
// состояния. Публичные (участники видят вручение по realtime); payload — только id
// (REQ-SEC-009); отображаемое имя клиент берёт из membership-проекции.
export const REWARDS_NAMESPACE = 'rewards';

export const REWARDS_EVENTS = {
  'reward.awarded': {
    schema: z.strictObject({
      awardId: z.uuid(),
      prizeId: z.uuid().nullable(), // REQ-RWD-002b: победитель без сущности приза
      winnerId: z.uuid(),
      sourceAppId: z.string().min(1),
    }),
    visibility: 'public',
    version: 1,
  },
  'reward.fulfilled': {
    schema: z.strictObject({ awardId: z.uuid() }),
    visibility: 'public',
    version: 1,
  },
  'reward.revoked': {
    schema: z.strictObject({ awardId: z.uuid() }),
    visibility: 'public',
    version: 1,
  },
} as const satisfies Record<string, EventTypeDefinition>;

export type RewardsEventName = keyof typeof REWARDS_EVENTS;

export const rewardsEventType = (name: RewardsEventName): string =>
  composeEventType(REWARDS_NAMESPACE, name);
