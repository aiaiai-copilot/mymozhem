import { createFocusRefetcher } from './focus-refetch';

// roster-refetch.ts — событийный рефетч ростера. Join теперь ЭМИТИТ public-
// событие core.member.joined (payload — только identityId, REQ-SEC-009;
// дизайн §9): displayName в лог не попадает, ростер перечитывается REST'ом
// (GET /rooms/:id/members). Плюс события, где имена появляются на экране
// (табло/победители, Review Focus 2).
const ROSTER_REFETCH_EVENTS = new Set([
  'core.member.joined',
  'quiz.question.revealed',
  'quiz.game.finished',
  'lottery.draw.completed',
]);
export const shouldRefetchRoster = (type: string): boolean => ROSTER_REFETCH_EVENTS.has(type);

// Дедуп событийного рефетча min 2 с (Review Focus 3): join-шторм на старте
// события (десятки member.joined подряд) не должен дёргать REST пачкой.
// Дедуп общий на вызывающего, не per-type: reveal сразу после join перечитал
// бы тот же ростер. min-interval-семантика переиспользована композицией над
// createFocusRefetcher (не копия). Чистая фабрика — тест без DOM.
export function createRosterEventRefetcher(
  refetch: () => void,
  minIntervalMs = 2_000,
  now: () => number = Date.now,
): (type: string) => void {
  const deduped = createFocusRefetcher(refetch, minIntervalMs, now);
  return (type: string) => {
    if (!shouldRefetchRoster(type)) return;
    deduped();
  };
}
