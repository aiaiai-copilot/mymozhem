import {
  AppRejection,
  type AppHostContext,
  type AppPublishResult,
} from '@mymozhem/sdk';
import type { z } from 'zod';
import { drawRunPayload } from './lottery-events';
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

  const prizeId = command.prizeId ?? null;
  // Прежние победители ЭТОГО приза вне пула; безпризовый розыгрыш исключает
  // прежних безпризовых победителей (ключ null, решение §0.4).
  const previousWinners = new Set(
    Object.values(ctx.state.draws)
      .filter((d) => d.prizeId === prizeId)
      .map((d) => d.winnerId),
  );
  const pool = ctx.drawPool.filter((e) => !previousWinners.has(e.identityId));
  if (pool.length === 0) throw new AppRejection('DRAW_POOL_EMPTY', 'draw pool is empty');
  const winnerId = pool[ctx.randomInt(pool.length)].identityId;
  return {
    commits: [
      { shortName: 'draw.run', payload: command, visibility: 'public', actor: 'publisher' },
      {
        shortName: 'draw.completed',
        payload: { drawId: command.drawId, prizeId, winnerId },
        visibility: 'public',
        actor: 'server',
      },
    ],
    // Эффект списания фонда — только при реальном призе; безпризовый draw
    // юридического факта выигрыша не создаёт (ADR-012 §4).
    effects: prizeId ? [{ kind: 'award.prize', prizeId, winnerId }] : [],
  };
}
