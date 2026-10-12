import { createHash, timingSafeEqual } from 'node:crypto';

// Сравнение через sha256-дайджесты: timingSafeEqual требует равной длины буферов,
// а дайджесты выравнивают длину — кандидат любой длины не утекает ни длиной,
// ни временем (Review Focus 5).
export function setupTokenMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
