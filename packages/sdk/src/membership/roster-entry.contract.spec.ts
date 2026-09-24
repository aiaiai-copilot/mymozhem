import { rosterEntrySchema } from './roster-entry';

describe('rosterEntry contract (UI-срез, решение №10)', () => {
  it.each([
    ['valid', { identityId: crypto.randomUUID(), displayName: 'Гость', role: 'participant' }, true],
    ['swept guest — displayName null', { identityId: crypto.randomUUID(), displayName: null, role: 'participant' }, true],
    ['uppercase role rejected (wire lowercase)', { identityId: crypto.randomUUID(), displayName: 'x', role: 'PARTICIPANT' }, false],
    ['extra key rejected', { identityId: crypto.randomUUID(), displayName: 'x', role: 'organizer', extra: 1 }, false],
  ])('%s', (_l, entry, ok) => {
    expect(rosterEntrySchema.safeParse(entry).success).toBe(ok);
  });
});
