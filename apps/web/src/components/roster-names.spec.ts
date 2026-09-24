import { describe, expect, it } from 'vitest';
import type { RosterEntry } from '@mymozhem/sdk';
import { rosterNames } from './roster-names';

// rosterNames (дизайн §4, решение №10): табло/экран показывают имена из ростера
// (identityId → displayName). displayName nullable — TTL-свип анонимизирует гостя,
// membership при этом жив; табло обязано показать fallback, а не пустую строку.
describe('rosterNames', () => {
  it('maps identityId → displayName для обычных членов', () => {
    const members: RosterEntry[] = [
      { identityId: 'id-1', displayName: 'Алиса', role: 'participant' },
      { identityId: 'id-2', displayName: 'Борис', role: 'spectator' },
    ];

    const names = rosterNames(members);

    expect(names.get('id-1')).toBe('Алиса');
    expect(names.get('id-2')).toBe('Борис');
    expect(names.size).toBe(2);
  });

  it('null displayName (swept-гость) → fallback «Гость», не пустая строка', () => {
    const members: RosterEntry[] = [{ identityId: 'id-1', displayName: null, role: 'participant' }];

    expect(rosterNames(members).get('id-1')).toBe('Гость');
  });

  it('пустой ростер → пустая Map', () => {
    expect(rosterNames([]).size).toBe(0);
  });
});
