import type { RosterEntry } from '@mymozhem/sdk';

// null — swept-гость (анонимизация); fallback-имя, а не пустая строка в табло.
export const rosterNames = (members: RosterEntry[]): Map<string, string> =>
  new Map(members.map((m) => [m.identityId, m.displayName ?? 'Гость']));

// Актора может не быть в ростере (рефетч отстаёт от события): табло показывает
// тот же fallback, что и swept-гость, — дыр вместо имён быть не должно.
export const displayNameOf = (names: Map<string, string>, identityId: string): string =>
  names.get(identityId) ?? 'Гость';
