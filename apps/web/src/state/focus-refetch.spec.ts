import { describe, expect, it, vi } from 'vitest';
import { createFocusRefetcher } from './focus-refetch';

// Дедуп рефетча по фокусу (находка №6): visibilitychange и focus приходят парой
// на одно возвращение во вкладку — ростер дёргаем не чаще minIntervalMs.
describe('createFocusRefetcher', () => {
  it('события в пределах окна → один рефетч; после окна → следующий', () => {
    const refetch = vi.fn();
    let now = 1_000;
    const onFocus = createFocusRefetcher(refetch, 2_000, () => now);

    onFocus(); // t=1000 → рефетч
    now = 2_000;
    onFocus(); // внутри окна → пропуск
    now = 3_500; // 3500-1000 = 2500 > 2000
    onFocus(); // рефетч

    expect(refetch).toHaveBeenCalledTimes(2);
  });
});
