// Пары valid/invalid для appCommitSchema (REQ-CTR-002/003): то, что модуль просит
// ядро зафиксировать. actor 'publisher' — атрибуция клиенту (гейты применяются),
// 'server' — эмиссия модуля (actorId=null, гейты не применяются).
export const validAppCommits: unknown[] = [
  { shortName: 'answer.submitted', payload: { optionId: 'a' }, visibility: 'public', actor: 'publisher' },
  { shortName: 'round.opened', payload: {}, visibility: 'module-private', actor: 'server' },
  { shortName: 'tick', payload: { remainingMs: 5000, seq: 3 }, visibility: 'organizer', actor: 'server' },
];

export const invalidAppCommits: unknown[] = [
  {}, // нет обязательных полей
  { shortName: 'answer.submitted', payload: {}, visibility: 'public' }, // нет actor
  { shortName: 'answer.submitted', payload: {}, visibility: 'public', actor: 'publisher', extra: true }, // strictObject
  { shortName: 'Quiz.x', payload: {}, visibility: 'public', actor: 'publisher' }, // namespace в shortName не пройдёт
  { shortName: 'answer.submitted', payload: {}, visibility: 'secret', actor: 'publisher' }, // visibility вне перечисления REQ-CORE-005
  { shortName: 'answer.submitted', payload: {}, visibility: 'public', actor: 'client' }, // actor вне enum
  'not-an-object',
];
