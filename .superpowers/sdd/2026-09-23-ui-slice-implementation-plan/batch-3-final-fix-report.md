# Отчёт о фикс-волне финревью батча 3 (Tasks 7–9) UI-среза

Дата: 2026-09-24 · Коммит: `e5caa45` (worktree `.worktrees/ui-slice`)
Объём: ровно 2 finding'а финального ревью + покрывающие тесты. Minor-находки — stay-deferred, не тронуты.

## Finding 1 (Critical) — content-type на каждом запросе

**Файл:** `apps/web/src/api/api-client.ts:20-26`

`headers` теперь стартует пустым; `content-type: application/json` выставляется
только при `req.body !== undefined`. В коде оставлен русский комментарий с
причиной: fastify отвечает `400 FST_ERR_CTP_EMPTY_JSON_BODY` на запрос с этим
content-type и пустым телом, поэтому body-less POST'ы (`refreshSession`,
`activateRoom`, `completeRoom`, `cancelRoom`, `fulfillAward`, `revokeAward`,
`excludeMember` без `input`) обязаны уходить без content-type. Побочный бонус
сохранён: серверный `body ?? {}` в exclude теперь получает честный `undefined`.

**Покрывающий тест:** `apps/web/src/api/api-client.spec.ts` —
`content-type только при теле: body-less POST уходит без него (fastify: пустой JSON body → 400)`:
POST без body → `body` undefined и `content-type` отсутствует; POST с body →
JSON-строка и `content-type: application/json`.

## Finding 2 (Important) — unhandled rejection в reconnect-ветке

**Файл:** `apps/web/src/realtime/room-connection.ts:34-47`

Цепочка re-subscribe при reconnect получила
`.catch(() => this.stateCb?.('disconnected'))`. В коде — русский комментарий с
причиной: при ошибке subscribe gateway зачищает серверную подписку
(`registry.remove` + `socket.leave`), но соединение НЕ разрывает, поэтому без
`.catch` состояние навсегда оставалось бы `live` при мёртвой подписке (тихий
«мёртвый live» с unhandled rejection, против дизайна §5 «обрыв — явный
индикатор»). Retry-стратегия осознанно НЕ добавлена — забота потребителя (Task 10+).

**Покрывающий тест:** `apps/web/src/realtime/room-connection.spec.ts` —
`re-subscribe при reconnect упал (error-ack) → явный "disconnected", а не тихий мёртвый "live"`:
после join программируется error-ack `{ code: 'INTERNAL_ERROR' }`, триггерится
reconnect → состояния `['live', 'live', 'disconnected']`, `onResync` не вызван.

## Прогоны (все из `.worktrees/ui-slice`)

Focused-спеки:
```
$ pnpm --filter @mymozhem/web test -- src/api/api-client.spec.ts src/realtime/room-connection.spec.ts
Test Files  5 passed (5)
     Tests  32 passed (32)
```

Полный сьют web:
```
$ pnpm --filter @mymozhem/web test
Test Files  5 passed (5)
     Tests  32 passed (32)   # было 30 + 2 новых
```

Гейты:
```
$ pnpm --filter @mymozhem/web lint        # eslint src — чисто
$ pnpm --filter @mymozhem/web typecheck   # tsc --noEmit — чисто
$ pnpm boundary-check                     # ✔ no dependency violations found (669 modules, 2052 dependencies)
```

## Коммит

```
e5caa45 fix(web): content-type только при body + явный disconnected при падении re-subscribe (UI-срез, финревью батча 3)
4 files changed, 56 insertions(+), 4 deletions(-)
```
