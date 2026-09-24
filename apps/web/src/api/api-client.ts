import { z } from 'zod';
import { ApiError } from './api-error';
import type { TokenProvider } from './token-provider';

// Тонкий typed REST-клиент (дизайн §3): zod-валидация ответов fail-loud при дрейфе
// контракта; серверные ошибки — { code } (REQ-SEC-006); 401 → один refresh → один
// retry (ровно один — Review Focus 4, allowRetry гасит цикл).
export interface ApiRequest<S extends z.ZodType> {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  schema: S;
  auth?: boolean; // default true
}

export class ApiClient {
  constructor(private readonly tokens: TokenProvider) {}

  async call<S extends z.ZodType>(req: ApiRequest<S>, allowRetry = true): Promise<z.output<S>> {
    const headers: Record<string, string> = {};
    // content-type: application/json — только при теле: fastify отвечает 400
    // (FST_ERR_CTP_EMPTY_JSON_BODY) на запрос с этим content-type и пустым телом,
    // поэтому body-less POST'ы (refresh, activate/complete/cancel, fulfill/revoke,
    // exclude без reason) обязаны уходить БЕЗ content-type.
    if (req.body !== undefined) headers['content-type'] = 'application/json';
    const token = this.tokens.getAccessToken();
    if (req.auth !== false && token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(req.path, {
      method: req.method,
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      credentials: 'same-origin', // refresh-кука Strict — только same-origin (дизайн §0.3)
    });
    if (res.status === 401 && req.auth !== false && allowRetry) {
      await this.tokens.refresh();
      return this.call(req, false);
    }
    // Тело ошибки может быть не JSON (static-режим, 5xx-страница прокси) — тогда кода нет.
    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = (json as { code?: unknown }).code;
      throw new ApiError(typeof code === 'string' ? code : `HTTP_${res.status}`, res.status);
    }
    return req.schema.parse(json);
  }
}
