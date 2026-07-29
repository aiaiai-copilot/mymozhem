import { generateRoomCode, ROOM_CODE_ALPHABET } from './room-code';

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
