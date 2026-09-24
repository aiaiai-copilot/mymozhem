// roster-refetch.ts — join не эмитит событий: ростер рефетчим на subscribe и на
// событиях, где имена показываются (Review Focus 2).
const ROSTER_REFETCH_EVENTS = new Set(['quiz.question.revealed', 'quiz.game.finished', 'lottery.draw.completed']);
export const shouldRefetchRoster = (type: string): boolean => ROSTER_REFETCH_EVENTS.has(type);
