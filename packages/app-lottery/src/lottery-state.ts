import type { AppLogEvent } from '@mymozhem/sdk';
import type { z } from 'zod';
import type { drawCompletedPayload } from './lottery-events';

// Проекция лотереи (REQ-CORE-004): список розыгрышей из лога; своих таблиц нет —
// состояние наград в rewards, история в логе. Использованные drawId хранятся
// здесь — идемпотентность команды (design §4).
export interface LotteryState {
  readonly draws: Readonly<Record<string, { readonly prizeId: string; readonly winnerId: string }>>;
}

export function initialLotteryState(): LotteryState {
  return { draws: {} };
}

export function reduceLottery(state: LotteryState, event: AppLogEvent): LotteryState {
  if (event.shortName !== 'draw.completed') return state;
  const p = event.payload as z.infer<typeof drawCompletedPayload>;
  if (state.draws[p.drawId]) return state; // повтор (replay/live дубль) — no-op
  return { draws: { ...state.draws, [p.drawId]: { prizeId: p.prizeId, winnerId: p.winnerId } } };
}
