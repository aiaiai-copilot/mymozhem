import { defineApp, type AppManifest } from '@mymozhem/sdk';
import { lotterySettingsSchema } from './lottery-settings';
import { drawCompletedPayload, drawRunPayload } from './lottery-events';

export const LOTTERY_APP_ID = 'lottery';
// v2 (ADR-012): prizeId необязателен, draw_eligibility удалена.
export const LOTTERY_MANIFEST_VERSION = 2;

export function buildLotteryManifest(): AppManifest {
  return defineApp({
    appId: LOTTERY_APP_ID,
    manifestVersion: LOTTERY_MANIFEST_VERSION,
    capabilities: ['rewards'], // REQ-RWD-001/005: делегирование фонда/выбора — capability
    appSettings: lotterySettingsSchema,
    events: {
      'draw.run': { schema: drawRunPayload, visibility: 'public', clientInitiated: true },
      'draw.completed': { schema: drawCompletedPayload, visibility: 'public', clientInitiated: false },
    },
  });
}
