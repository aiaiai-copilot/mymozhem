import type { Prisma } from '@prisma/client';

// Приостановка TTL гостя через hook, не импортом (design 2026-09-10 §5,
// REQ-RWD-001/013): identity объявляет токен; rewards регистрирует guard в
// composition root. Паттерн — по прецеденту onAccessRevoked (membership).
export interface AnonymizationGuard {
  // Возвращает подмножество identityIds с нерешённой наградой (AWARDED).
  // tx — транзакция свипа: внетранзакционное чтение создавало окно гонки C-8.1
  // (award, закоммиченный между гард-чеком и коммитом свипа, оставался невидимым);
  // обе точки опроса (до анонимизации и re-check после) читают через tx вызывающего.
  hasOpenAwards(tx: Prisma.TransactionClient, identityIds: readonly string[]): Promise<Set<string>>;
}

export const ANONYMIZATION_GUARDS = Symbol('ANONYMIZATION_GUARDS');
