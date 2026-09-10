import type { AppManifest } from '../manifest/manifest.schema';
import type { AppCommit } from './app-commit';
import type { AppHostContext } from './app-host-context';
import type { AppLogEvent } from './app-log-event';
import type { AppPublishResult } from './app-publish-result';

// Рантайм-контракт app-модуля (фаза 2, командный хост): ядро диспетчит publish
// через handlePublish, восстанавливает состояние редукцией лога (initialState +
// reduce), фиксирует только то, что модуль вернул как AppCommit[] (REQ-CTR-003).
// С контракта 1.6.0 модуль может вернуть также AppPublishResult (коммиты +
// эффекты награждения, design 2026-09-10 §2); «голый массив» читается как
// { commits, effects: [] } (обратная совместимость, normalizePublishResult).
export interface AppRuntimeModule<S = unknown> {
  readonly appId: string;
  readonly manifestVersion: number;
  readonly manifest: AppManifest;
  initialState(): S;
  reduce(state: S, event: AppLogEvent): S;
  handlePublish(
    ctx: AppHostContext<S>,
    shortName: string,
    payload: Record<string, unknown>,
  ): AppCommit[] | AppPublishResult | Promise<AppCommit[] | AppPublishResult>;
}
