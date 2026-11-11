import { describe, expect, it } from 'vitest';
import { createFocusDimTracker } from './focus-dim';

// Затемнение нефокусного окна (находка Н1, дизайн §3(А), решение 1):
// dimmed ⟺ blurred && visible. Условие «visible» отделяет десктопное «окно
// видно, фокус в другом приложении» (macOS съедает первый клик на активацию —
// вуаль даёт съеденному клику видимый смысл) от мобильного app-switch, где
// страница hidden и затемнять нечего (Review Focus 4). Трекер чистый: DOM не
// читает, visibility приходит снаружи через onVisibility (хук use-focus-dim).
describe('createFocusDimTracker', () => {
  it('изначально не затемнён', () => {
    const tracker = createFocusDimTracker();
    expect(tracker.dimmed()).toBe(false);
  });

  it('blur при видимой странице → затемнено', () => {
    const tracker = createFocusDimTracker();
    tracker.onBlur();
    expect(tracker.dimmed()).toBe(true);
  });

  it('blur при hidden-вкладке (мобильный app-switch) → НЕ затемнено', () => {
    const tracker = createFocusDimTracker();
    tracker.onVisibility(false);
    tracker.onBlur();
    expect(tracker.dimmed()).toBe(false);
  });

  it('focus снимает затемнение', () => {
    const tracker = createFocusDimTracker();
    tracker.onBlur();
    expect(tracker.dimmed()).toBe(true);
    tracker.onFocus();
    expect(tracker.dimmed()).toBe(false);
  });

  it('hidden снимает вуаль при удержанном blur, возврат в visible — ставит снова', () => {
    const tracker = createFocusDimTracker();
    tracker.onBlur();
    tracker.onVisibility(false);
    expect(tracker.dimmed()).toBe(false);
    tracker.onVisibility(true);
    expect(tracker.dimmed()).toBe(true);
  });

  it('повторный blur без focus — без изменений', () => {
    const tracker = createFocusDimTracker();
    tracker.onBlur();
    tracker.onBlur();
    expect(tracker.dimmed()).toBe(true);
  });
});
