import { generateRoomCode, isRoomCodeCollision, ROOM_CODE_ALPHABET } from './room-code';

describe('generateRoomCode (REQ-ID-013)', () => {
  it('produces a code of the requested length from the safe alphabet only', () => {
    const code = generateRoomCode(8);
    expect(code).toHaveLength(8);
    for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
  });

  it('excludes confusable characters by construction (no 0/o, 1/l/i)', () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[01ilo]/);
  });

  it('respects other lengths', () => {
    expect(generateRoomCode(12)).toHaveLength(12);
  });
});

describe('isRoomCodeCollision (REQ-ID-013)', () => {
  // Форма, которую реально бросает Prisma 7.8 + adapter-pg при failed $queryRaw:
  // PrismaClientKnownRequestError P2010, SQLSTATE и имя индекса — внутри message.
  const p2010 = (message: string) => ({ code: 'P2010', message });

  it('matches a P2010 raw-query error carrying 23505 on the Room_code_key index', () => {
    const err = p2010(
      'Raw query failed. Code: `23505`. Message: `duplicate key value violates unique constraint "Room_code_key"`',
    );
    expect(isRoomCodeCollision(err)).toBe(true);
  });

  it('rejects a P2010 on a different index', () => {
    const err = p2010(
      'Raw query failed. Code: `23505`. Message: `duplicate key value violates unique constraint "Membership_single_organizer_key"`',
    );
    expect(isRoomCodeCollision(err)).toBe(false);
  });

  it('rejects a P2010 with a different SQLSTATE', () => {
    const err = p2010(
      'Raw query failed. Code: `23502`. Message: `null value in column "code" violates not-null constraint`',
    );
    expect(isRoomCodeCollision(err)).toBe(false);
  });

  it('rejects a non-P2010 error even with 23505 in the message', () => {
    const err = {
      code: 'P2002',
      message:
        'Raw query failed. Code: `23505`. Message: `duplicate key value violates unique constraint "Room_code_key"`',
    };
    expect(isRoomCodeCollision(err)).toBe(false);
  });

  it.each([null, undefined, new Error('boom'), '23505', {}])(
    'rejects non-error-shaped input (%p)',
    (input) => {
      expect(isRoomCodeCollision(input)).toBe(false);
    },
  );
});
