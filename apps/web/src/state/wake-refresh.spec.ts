import { describe, expect, it, vi } from 'vitest';
import {
  accessTokenDueSoon,
  createSessionWakeRefresher,
  REFRESH_AHEAD_MS,
} from './wake-refresh';

// Фейковый JWT (тот же стиль, что session.spec): подпись не проверяется.
const makeToken = (claims: unknown): string =>
  `hdr.${btoa(JSON.stringify(claims))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')}.sig`;

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const NOW = 1_900_000_000_000; // ms
const NOW_SEC = NOW / 1000;

describe('accessTokenDueSoon (проактивный refresh, дизайн §3(Г))', () => {
  it('null → false (Review Focus 2: refresh без куки — новый warn-шум «no refresh cookie»)', () => {
    // Страница без access-токена (screen до join, host-login) не должна стрелять
    // refresh на каждый focus.
    expect(accessTokenDueSoon(null, NOW)).toBe(false);
  });

  it('malformed → false (декод бросает fail-loud — здесь ловим)', () => {
    expect(accessTokenDueSoon('not-a-jwt', NOW)).toBe(false);
    // Валидный JWT без exp — decodeAccessClaims бросает (обязательное поле).
    expect(accessTokenDueSoon(makeToken({ sub: 'a', kind: 'GUEST' }), NOW)).toBe(false);
  });

  it('свежий токен (exp далеко за порогом) → false', () => {
    const token = makeToken({ sub: 'a', kind: 'GUEST', exp: NOW_SEC + 600 });
    expect(accessTokenDueSoon(token, NOW)).toBe(false);
  });

  it('истекающий (осталось меньше порога) → true; истёкший → true', () => {
    const soon = makeToken({ sub: 'a', kind: 'GUEST', exp: NOW_SEC + 60 });
    expect(accessTokenDueSoon(soon, NOW)).toBe(true);
    const expired = makeToken({ sub: 'a', kind: 'GUEST', exp: NOW_SEC - 5 });
    expect(accessTokenDueSoon(expired, NOW)).toBe(true);
  });

  it('граница: осталось ровно порог — ещё не due (строгое неравенство)', () => {
    const edge = makeToken({ sub: 'a', kind: 'GUEST', exp: NOW_SEC + REFRESH_AHEAD_MS / 1000 });
    expect(accessTokenDueSoon(edge, NOW)).toBe(false);
  });
});

describe('createSessionWakeRefresher', () => {
  const dueToken = makeToken({ sub: 'a', kind: 'GUEST', exp: NOW_SEC + 10 });
  const freshToken = makeToken({ sub: 'a', kind: 'GUEST', exp: NOW_SEC + 3_600 });

  it('due → refresh вызван, onWake стреляет ПОСЛЕ settle refresh (refresh-then-kick, дизайн §3(Г))', async () => {
    const order: string[] = [];
    let resolveRefresh!: () => void;
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          order.push('refresh');
          resolveRefresh = resolve;
        }),
    );
    const wake = createSessionWakeRefresher(() => dueToken, refresh, {
      now: () => NOW,
      onWake: () => order.push('onWake'),
    });

    wake();
    expect(refresh).toHaveBeenCalledTimes(1);
    // onWake НЕ до settle: handshake обязан уйти со свежим токеном.
    expect(order).toEqual(['refresh']);

    resolveRefresh();
    await flushMicrotasks();
    expect(order).toEqual(['refresh', 'onWake']);
  });

  it('не due → onWake сразу, refresh не вызывается', () => {
    const refresh = vi.fn(() => Promise.resolve());
    const onWake = vi.fn();
    const wake = createSessionWakeRefresher(() => freshToken, refresh, {
      now: () => NOW,
      onWake,
    });

    wake();

    expect(refresh).not.toHaveBeenCalled();
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it('провал refresh → onWake всё равно стреляет, исключение проглочено (страховка — реактивный 401-путь)', async () => {
    const refresh = vi.fn(() => Promise.reject(new Error('no refresh cookie')));
    const onWake = vi.fn();
    const wake = createSessionWakeRefresher(() => dueToken, refresh, {
      now: () => NOW,
      onWake,
    });

    wake();
    await flushMicrotasks();

    // Кик reconnect обязан стрельнуть и при провале refresh; unhandled rejection
    // уронил бы прогон vitest.
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it('двойной вызов в окне minInterval → один refresh (дедуп createFocusRefetcher)', async () => {
    let now = NOW;
    const refresh = vi.fn(() => Promise.resolve());
    const onWake = vi.fn();
    const wake = createSessionWakeRefresher(() => dueToken, refresh, {
      now: () => now,
      minIntervalMs: 2_000,
      onWake,
    });

    // Пара visibilitychange+focus приходят вместе — один refresh на пару.
    wake();
    wake();
    await flushMicrotasks();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onWake).toHaveBeenCalledTimes(1);

    // Окно вышло — свежая волна пробуждения снова имеет право на refresh.
    now += 3_000;
    wake();
    await flushMicrotasks();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
