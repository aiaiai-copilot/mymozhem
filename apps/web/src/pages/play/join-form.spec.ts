import { describe, expect, it } from 'vitest';
import { buildJoinRequest } from './join-form';

// Тело join (ADR-012 §3): имя необязательно — пустое уходит БЕЗ ключа
// displayName, сервер назначит псевдоним и вернёт фактическое имя в ответе
// (joinResponseSchema). Ключ обязан отсутствовать, а не быть пустой строкой:
// strict-схема с displayNameSchema.min(1) отклонила бы пустое значение.
describe('buildJoinRequest', () => {
  it('пустое имя → body без displayName', () => {
    const body = buildJoinRequest('ABCD-1234', '');
    expect(body).toEqual({ code: 'ABCD-1234' });
    expect(body).not.toHaveProperty('displayName');
  });

  it('непустое имя → body с displayName', () => {
    expect(buildJoinRequest('ABCD-1234', 'Маша')).toEqual({
      code: 'ABCD-1234',
      displayName: 'Маша',
    });
  });
});
