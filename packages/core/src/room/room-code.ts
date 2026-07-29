import { randomInt } from 'node:crypto';

// REQ-ID-013: cryptographically random room code; alphabet excludes confusable
// characters (no 0/o, 1/l/i) — 31 chars, 8 chars ≈ 8.5e11 combinations. Length comes
// from ROOM_CODE_MIN_LEN (config §4), never a literal.
export const ROOM_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateRoomCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

// Unique violation on the room code (index "Room_code_key"). Prisma 7 + adapter-pg
// wraps every failing $queryRaw in PrismaClientKnownRequestError with code P2010 and
// message `Raw query failed. Code: \`23505\`. Message: \`duplicate key value violates
// unique constraint "Room_code_key"...\`` — the raw SQLSTATE never reaches the top
// level (verified against @prisma/client@7.8.0 runtime + @prisma/adapter-pg@7.8.0
// convertError: 23505 → UniqueConstraintViolation with originalCode '23505', also
// reachable as meta.driverAdapterError.cause.originalCode). The retry loop in
// create() is a safety net — a collision is a ~1e-12 event and intentionally untested
// end-to-end; the classifier itself is unit-tested in room-code.spec.ts.
export function isRoomCodeCollision(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return (
    err?.code === 'P2010' &&
    typeof err.message === 'string' &&
    err.message.includes('23505') &&
    err.message.includes('Room_code_key')
  );
}
