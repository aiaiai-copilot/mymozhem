import type { AppCommit } from './app-commit';
import type { AppEffect } from './app-effect';

// Возврат handlePublish (design §2): коммиты + эффекты. Старая форма «голый
// массив AppCommit[]» читается как { commits, effects: [] } — обратная
// совместимость для модулей, написанных под контракт 1.5.0 (квиз v1).
export interface AppPublishResult {
  readonly commits: readonly AppCommit[];
  readonly effects: readonly AppEffect[];
}

// TS не сужает readonly-массив через Array.isArray — сужение типом-предикатом.
const isCommitArray = (
  result: readonly AppCommit[] | AppPublishResult,
): result is readonly AppCommit[] => Array.isArray(result);

export function normalizePublishResult(
  result: readonly AppCommit[] | AppPublishResult,
): AppPublishResult {
  return isCommitArray(result) ? { commits: result, effects: [] } : result;
}
