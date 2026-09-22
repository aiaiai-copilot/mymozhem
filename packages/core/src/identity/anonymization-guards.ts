// Приостановка TTL гостя через hook, не импортом (design 2026-09-10 §5,
// REQ-RWD-001/013): identity объявляет токен; rewards регистрирует guard в
// composition root. Паттерн — по прецеденту onAccessRevoked (membership).
export interface AnonymizationGuard {
  // Возвращает подмножество identityIds, у которых есть нерешённая награда
  // (AWARDED). identity про rewards не знает.
  hasOpenAwards(identityIds: readonly string[]): Promise<Set<string>>;
}

export const ANONYMIZATION_GUARDS = Symbol('ANONYMIZATION_GUARDS');
