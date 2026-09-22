import type { Prisma } from '@prisma/client';
import type { AppEffect } from '@mymozhem/sdk';

// DI-шов «ядро не зависит от rewards» (REQ-RWD-001, design 2026-09-10 §2):
// app-runtime знает только этот интерфейс; реализация — RewardsService,
// подключается в composition root. Boundary-правило запрещает остальным доменам
// ядра импорт core/rewards (Task 11).
export interface AwardEffectHandler {
  executeEffects(
    tx: Prisma.TransactionClient,
    roomId: string,
    sourceAppId: string,
    effects: readonly AppEffect[],
  ): Promise<void>;
}

export const AWARD_EFFECT_HANDLER = Symbol('AWARD_EFFECT_HANDLER');
