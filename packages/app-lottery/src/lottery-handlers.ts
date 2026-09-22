import {
  AppRejection,
  type AppHostContext,
  type AppPublishResult,
} from '@mymozhem/sdk';
import type { z } from 'zod';
import { drawRunPayload } from './lottery-events';
import { lotterySettingsSchema } from './lottery-settings';
import type { LotteryState } from './lottery-state';

// actorId — только из ctx, никогда из payload (REQ-RT-009). Случайность — только
// ctx.randomInt (CSPRNG хоста, REQ-RWD-011); Math.random в packages/app-*
// запрещён lint-правилом (Task 11).
export function handleLotteryPublish(
  ctx: AppHostContext<LotteryState>,
  shortName: string,
  payload: Record<string, unknown>,
): AppPublishResult {
  if (shortName !== 'draw.run') {
    throw new AppRejection('EVENT_UNKNOWN_TYPE', `unknown lottery command: ${shortName}`);
  }
  if (ctx.actorRole !== 'ORGANIZER') {
    throw new AppRejection('PUBLISH_FORBIDDEN', 'only the organizer runs a draw');
  }
  const command: z.infer<typeof drawRunPayload> = drawRunPayload.parse(payload);

  // Идемпотентность (design §4): повтор drawId — no-op с прежним результатом;
  // re-emit draw.completed самолечит клиента, пропустившего кадр (редьюсер
  // дедуплицирует по drawId). Без эффекта — приз не списывается вторично.
  const existing = ctx.state.draws[command.drawId];
  if (existing) {
    return {
      commits: [{
        shortName: 'draw.completed',
        payload: { drawId: command.drawId, prizeId: existing.prizeId, winnerId: existing.winnerId },
        visibility: 'public',
        actor: 'server',
      }],
      effects: [],
    };
  }

  const settings = lotterySettingsSchema.parse(ctx.settings);
  // Пул — снапшот от диспетчера (ctx.drawPool). verified: отсекаем GUEST (REQ-RWD-014).
  let pool = settings.drawEligibility === 'verified'
    ? ctx.drawPool.filter((e) => e.kind !== 'GUEST')
    : [...ctx.drawPool];
  // Прежние победители этого приза вне пула (UX; частичный индекс — страховка).
  const previousWinners = new Set(
    Object.values(ctx.state.draws)
      .filter((d) => d.prizeId === command.prizeId)
      .map((d) => d.winnerId),
  );
  pool = pool.filter((e) => !previousWinners.has(e.identityId));
  if (pool.length === 0) {
    throw new AppRejection('DRAW_POOL_EMPTY', 'draw pool is empty');
  }
  const winnerId = pool[ctx.randomInt(pool.length)].identityId;
  return {
    commits: [
      { shortName: 'draw.run', payload: command, visibility: 'public', actor: 'publisher' },
      {
        shortName: 'draw.completed',
        payload: { drawId: command.drawId, prizeId: command.prizeId, winnerId },
        visibility: 'public',
        actor: 'server',
      },
    ],
    effects: [{ kind: 'award.prize', prizeId: command.prizeId, winnerId }],
  };
}
