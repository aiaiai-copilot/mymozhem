import { describe, expect, it, vi } from 'vitest';
import { createRosterEventRefetcher, shouldRefetchRoster } from './roster-refetch';

// Дизайн §9: join теперь эмитит public-событие core.member.joined (payload —
// только identityId, REQ-SEC-009), ростер по нему перечитывается REST'ом;
// плюс события, где имена появляются на экране (табло/победители, Review Focus 2).
describe('shouldRefetchRoster', () => {
  it.each(['core.member.joined', 'quiz.question.revealed', 'quiz.game.finished', 'lottery.draw.completed'])(
    'true для %s (live-ростер / на экране появляются имена)',
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

// Дедуп событийного рефетча (Review Focus 3): join-шторм на старте события
// (десятки member.joined подряд) не должен дёргать REST пачкой. Тест без DOM,
// по прецеденту focus-refetch.spec.
describe('createRosterEventRefetcher', () => {
  it('два member.joined в пределах окна → один вызов refetch; после окна → снова вызов', () => {
    const refetch = vi.fn();
    let now = 1_000;
    const onEvent = createRosterEventRefetcher(refetch, 2_000, () => now);

    onEvent('core.member.joined'); // t=1000 → рефетч
    now = 2_000;
    onEvent('core.member.joined'); // внутри окна → пропуск
    expect(refetch).toHaveBeenCalledTimes(1);

    now = 3_500; // 3500-1000 = 2500 > 2000
    onEvent('core.member.joined'); // окно прошло → рефетч
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('дедуп общий на вызывающего, не per-type: revealed и member.joined в одном окне → один вызов', () => {
    const refetch = vi.fn();
    let now = 1_000;
    const onEvent = createRosterEventRefetcher(refetch, 2_000, () => now);

    onEvent('quiz.question.revealed'); // t=1000 → рефетч
    now = 1_500;
    onEvent('core.member.joined'); // то же окно → пропуск
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('событие вне списка рефетча → refetch не вызывается', () => {
    const refetch = vi.fn();
    const onEvent = createRosterEventRefetcher(refetch, 2_000, () => 1_000);

    onEvent('quiz.question.opened');
    expect(refetch).not.toHaveBeenCalled();
  });
});
