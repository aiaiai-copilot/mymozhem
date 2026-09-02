// Core не зависит от fastify напрямую (адаптер подключается в apps/server) — контроллеры
// типизируются структурным минимумом запроса/ответа; FastifyRequest/FastifyReply
// совместимы по форме. Тот же приём, что ReplyLike в http-exception.filter (там своя
// приватная вариация под status/send — здесь под ip/cookies/setCookie).
export interface RequestLike {
  readonly ip: string;
  readonly cookies: Record<string, string | undefined>;
  // Bearer-аутентификация REST (срез исключения): первый REST-потребитель Authorization.
  readonly headers: Record<string, string | string[] | undefined>;
}

export interface ReplyLike {
  setCookie(
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'strict' | 'lax'; // lax — oauth state/pkce/redirect (возврат с Google, design §3)
      path: string;
      maxAge: number;
    },
  ): unknown;
  // OAuth-флоу: одноразовые куки гасятся при любом исходе; 302 на Google и на цель.
  clearCookie(name: string, options: { path: string }): unknown;
  // Fastify v5: redirect(url, code?) — URL первым (порядок v4 (code, url) перевёрнут,
  // wire-e2e поймал: v4-порядок даёт FST_ERR_BAD_STATUS_CODE → 500).
  redirect(url: string, statusCode?: number): unknown;
}
