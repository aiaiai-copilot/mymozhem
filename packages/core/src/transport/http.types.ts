// Core не зависит от fastify напрямую (адаптер подключается в apps/server) — контроллеры
// типизируются структурным минимумом запроса/ответа; FastifyRequest/FastifyReply
// совместимы по форме. Тот же приём, что ReplyLike в http-exception.filter (там своя
// приватная вариация под status/send — здесь под ip/cookies/setCookie).
export interface RequestLike {
  readonly ip: string;
  readonly cookies: Record<string, string | undefined>;
}

export interface ReplyLike {
  setCookie(
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'strict';
      path: string;
      maxAge: number;
    },
  ): unknown;
}
