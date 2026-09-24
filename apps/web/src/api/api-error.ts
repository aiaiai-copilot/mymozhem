// Единая ошибка транспортного слоя (дизайн §3): wire-код сервера + HTTP-статус.
// Код НЕ сверяется с CONTRACT_ERROR_CODES: клиент прозрачен — static-режим отдаёт
// NOT_FOUND вне enum'а, будущие коды тоже должны доезжать as-is; generic-бакетинг —
// забота слоёв выше (страниц), не клиента.
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`API ${status}: ${code}`);
    this.name = 'ApiError';
  }
}
