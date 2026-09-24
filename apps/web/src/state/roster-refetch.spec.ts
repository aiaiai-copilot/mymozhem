import { describe, expect, it } from 'vitest';
import { shouldRefetchRoster } from './roster-refetch';

// Review Focus 2: join не эмитит событий — ростер рефетчится на subscribe
// (это делает useRoomBinding, Task 10) и на событиях, где имена показываются.
describe('shouldRefetchRoster', () => {
  it.each(['quiz.question.revealed', 'quiz.game.finished', 'lottery.draw.completed'])(
    'true для %s (на экране появляются имена)',
    (type) => {
      expect(shouldRefetchRoster(type)).toBe(true);
    },
  );

  it.each(['quiz.question.opened', 'quiz.answer.submitted', 'core.room.activated'])(
    'false для %s (имён на экране не прибавляется)',
    (type) => {
      expect(shouldRefetchRoster(type)).toBe(false);
    },
  );
});
