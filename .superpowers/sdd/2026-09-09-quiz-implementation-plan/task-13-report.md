# Task 13 — отчёт: quiz e2e, приёмка фазы 2

## Что реализовано

`apps/server/test/quiz.e2e-spec.ts` — standalone e2e-спек (531 строка), все 9 сценариев brief'а:

1. **Полная игра** — 3 гостя (P1, P2, P3-молчун) + организатор на ws; 2 раунда со скоростной шкалой (P1: 1000+900=1900, место 1; P2: 1000, место 2); `answer.accepted` public без `optionIndex` (assert по ключам payload); P3 отсутствует в standings (зафиксировано assert'ом, как требует brief); порядок live-кадров у всех 4 клиентов == порядку public-событий в логе (`readRoomLog`); 4 module-private `answer.submitted` в логе.
2. **Чит-тест** — до `question.revealed` собраны ВСЕ кадры/ack/snapshot'ы участника и организатора (subscribe-ack, publish-ack, live-frames) и проверены сериализацией: `JSON.stringify(frame)` не содержит `"correctIndex"` и `"correctAnswers"`; `snapshot.appSettings` без `correctAnswers` у обоих. После reveal — replay новым сокетом: `quiz.question.revealed` в snapshot (легально), `quiz.answer.submitted` отсутствует, `correctAnswers` отсутствует; организаторский snapshot — тоже без `correctAnswers` и без `answer.submitted` (module-private никому).
3. **Late-join участника** в ACTIVE в середине раунда: snapshot содержит открытый `question.opened` (payload `{questionIndex: 0}`), ответ принят.
4. **Late-join зрителя** (`role: 'spectator'`): subscribe ok, snapshot public, publish `answer.submitted` → `{code: 'PUBLISH_FORBIDDEN'}`, длина лога не изменилась.
5. **Анти-бот (REQ-RT-013)**: `minAnswerIntervalMs: 60_000` → немедленный ответ = `{code: 'ANSWER_TOO_FAST'}`, в логе нет `answer.submitted`; `minAnswerIntervalMs: 0` → ответ принят.
6. **Конкурентный double-answer** (Promise.all двух publish на одном сокете): ровно один `{ok: true}`, второй `{code: 'ALREADY_ANSWERED'}`; в логе ровно один `quiz.answer.submitted` от этого actorId.
7. **Ролевые гейты**: участнику `question.opened` и `game.finish` → `PUBLISH_FORBIDDEN`.
8. **Пересоздание проекции**: `app.get(AppRuntimeService).invalidateProjection(roomId)` после раунда 0 → раунд 1 обрабатывается, `question.revealed` раунда 1 содержит `totals: [{P1, 2000}]` (очки раунда 0 восстановлены replay'ем).
9. **Запечатанная комната**: `roomService.complete` → publish → `{code: 'ROOM_LOG_SEALED'}`.

Харнесс скопирован/адаптирован из `realtime.e2e-spec.ts` (createApp/connect/emitAck/seedIdentity/startTestDb/TEST_CONFIG, env save-restore, TRUNCATE в afterEach). Добавлен `waitEventWhere(socket, type, pred?)` — waitEvent без фильтра не годится для много-типного потока квиза; waiters навешиваются ДО триггерящего publish (fan-out синхронен с коммитом, кадр может прийти раньше ack — первая версия сценария 1 на этом повисла в timeout, исправлено).

## Отклонения от brief

1. **Без override'ов `APP_MANIFESTS`/`APP_RUNTIME_MODULES`.** Brief предполагал `overrideProvider(...)`; но composition root (`apps/server/src/app.module.ts`, Task 12) уже регистрирует quiz глобально — корректирующее сообщение к Task 13 прямо предписывало в этом случае не переопределять. `createApp` собирает `AppModule` как есть.
2. **`readRoomLog` НЕ экспортирован из barrel ядра** (утверждение brief «exported via core barrel» устарело — ни src/index.ts, ни dist его не содержат; `@mymozhem/core` не имеет exports-map для deep-import). Хелпер (12 строк `$queryRaw`) скопирован локально в спек с комментарием — спек standalone по требованию brief. Прод-код не тронут.
3. **Фильтр visibility по сырому логу — lowercase (`'public'`)**: DB-enum хранит lowercase (маппинг @map делает только Prisma-клиент, а `$queryRaw` отдаёт сырое значение). Зафиксировано комментарием в тесте.
4. **Сервисы берутся из app (`app.get(RoomService/TokenService/AppRuntimeService)`)**, а не конструируются вручную, как в realtime.e2e, — ручная сборка там нужна была из-за override-провайдеров; здесь она ничего не даёт.
5. **Противоречие brief (Step 2 vs сценарий 1)** о standings при нулевых очках: Step 2 говорил «гость без правильных ответов присутствует в standings с total 0», сценарий 1 — «P3 в standings не попадает». Реализация (уже прошедшая ревью, батч 4) строит totals только из awarded → не отвечавший/не угадавший в standings отсутствует. Разрешено в пользу сценария 1 + реализации; дополнительно зафиксирован assert: после неверного ответа P2 в раунде 0 `totals` раунда 0 = `[{P1, 1000}]` (неверный ответ записи в totals не создаёт).
6. `activate(room.id, ORG)` с явным actorId (прецедент realtime.e2e), не `activate(room.id)` из псевдокода brief.
7. `activate` требует REGISTERED-организатора: ORG = валидный v4 UUID `00000000-0000-4000-8000-000000000001` (zod v4 `z.uuid()` отклоняет нулевой литерал — прецедент realtime.e2e).

## Прогон

Команда (как в brief): `pnpm --filter @mymozhem/server test -- quiz`
(паттерн матчит все 5 e2e-сьютов — путь worktree содержит «quiz»; это даёт бонус-регрессию остальных сьютов).

Финальный вывод:

```
PASS test/quiz.e2e-spec.ts (5.403 s)
    ✓ 1. полная игра: 2 раунда, скоростная шкала, standings; порядок live = порядку лога (232 ms)
    ✓ 2. чит-тест: до reveal нигде на проводе нет correctIndex/correctAnswers; replay легален, module-private никому (40 ms)
    ✓ 3. late-join участника в ACTIVE в середине раунда: snapshot с открытым вопросом, ответ принят (26 ms)
    ✓ 4. late-join зрителя: subscribe ok, snapshot public; publish → PUBLISH_FORBIDDEN, лог не изменился (22 ms)
    ✓ 5. анти-бот (REQ-RT-013): ответ раньше minAnswerIntervalMs → ANSWER_TOO_FAST; с 0 — принят (41 ms)
    ✓ 6. конкурентный double-answer: ровно один ok, второй ALREADY_ANSWERED; в логе один answer.submitted (21 ms)
    ✓ 7. ролевые гейты: участнику question.opened и game.finish запрещены (PUBLISH_FORBIDDEN) (14 ms)
    ✓ 8. пересоздание проекции: invalidateProjection → replay восстанавливает состояние, очки включают раунд 0 (41 ms)
    ✓ 9. запечатанная комната: publish после COMPLETED → ROOM_LOG_SEALED (16 ms)
Test Suites: 5 passed, 5 total
Tests:       58 passed, 58 total
Snapshots:   0 total
```

Процесс по brief: скелет сценария 1 запускался первым и упал ожидаемо (1 failed / 49 passed), затем полная реализация → зелёный.

Дополнительно: `pnpm --filter @mymozhem/server lint` и `typecheck` — чисто (скрипты покрывают только `src`; спек компилируется ts-jest'ом — реальный гейт прогона).

## Concerns / наблюдения

1. **AJV `console.warn`: `unknown format "uuid" ignored`** при компиляции quiz-схем в `AppRegistryService.eventValidatorFor` (stock Ajv 8 без ajv-formats игнорирует `format: "uuid"`, который эмитит zod v4 для `z.uuid()`). Практический эффект для среза нулевой: uuid-поля есть только у server-generated производных (`answer.accepted.actorId`, `awarded/totals`), которые модуль строит из `ctx.actorId`; клиентские схемы uuid-полей не имеют. Но ослабление формата на проводе — характеристика уже принятого кода (sdk→defineApp→JSON Schema + core Ajv); если норма требует enforcement формата uuid на commit-гейте — это тема для отдельного решения владельца, не для этого таска.
2. Прод-код не изменён (только новый тест-файл); багов в reviewed-коде сценарии не вскрыли.
