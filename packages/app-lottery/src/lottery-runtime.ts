import type { AppManifest, AppRuntimeModule } from '@mymozhem/sdk';
import { buildLotteryManifest, LOTTERY_APP_ID, LOTTERY_MANIFEST_VERSION } from './lottery-manifest';
import { handleLotteryPublish } from './lottery-handlers';
import { initialLotteryState, reduceLottery, type LotteryState } from './lottery-state';

export function createLotteryRuntime(): AppRuntimeModule<LotteryState> {
  return {
    appId: LOTTERY_APP_ID,
    manifestVersion: LOTTERY_MANIFEST_VERSION,
    manifest: buildLotteryManifest(),
    initialState: initialLotteryState,
    reduce: reduceLottery,
    handlePublish: handleLotteryPublish,
  };
}

export function createLotteryApp(): { manifest: AppManifest; runtime: AppRuntimeModule<LotteryState> } {
  const manifest = buildLotteryManifest();
  return { manifest, runtime: createLotteryRuntime() };
}
