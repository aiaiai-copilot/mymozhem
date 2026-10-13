import { describe, expect, it } from 'vitest';
import type { RosterEntry } from '@mymozhem/sdk';
import { excludeIfStillActive } from './members-panel';

// rosterEntrySchema (SDK, strict): { identityId: uuid, displayName: string|null,
// role: lowercase } — joinedAt на wire НЕТ, фикстура минимальна.
const entry = (identityId: string): RosterEntry => ({
  identityId,
  displayName: 'Игрок',
  role: 'participant',
});

// Рефетч в момент действия (находка №6): join не эмитит событий (I-3), ростер
// консоли стейл — «Исключить» по прежней identity перезашедшего бьёт мимо.
// Перед exclude ростер рефетчится; ушедшей identity exclude НЕ отправляется.
describe('excludeIfStillActive', () => {
  it('identity активна в свежем ростере → exclude отправлен (listMembers ДО exclude)', async () => {
    const calls: string[] = [];
    const deps = {
      listMembers: async () => {
        calls.push('list');
        return { members: [entry('id-1')] };
      },
      excludeMember: async () => {
        calls.push('exclude');
      },
    };

    const result = await excludeIfStillActive(deps, 'room-1', 'id-1');

    expect(result).toBe('excluded');
    expect(calls).toEqual(['list', 'exclude']);
  });

  it('identity исчезла (перезаход) → exclude НЕ отправлен', async () => {
    const calls: string[] = [];
    const deps = {
      listMembers: async () => {
        calls.push('list');
        return { members: [entry('id-new')] };
      },
      excludeMember: async () => {
        calls.push('exclude');
      },
    };

    const result = await excludeIfStillActive(deps, 'room-1', 'id-1');

    expect(result).toBe('stale');
    expect(calls).toEqual(['list']);
  });
});
