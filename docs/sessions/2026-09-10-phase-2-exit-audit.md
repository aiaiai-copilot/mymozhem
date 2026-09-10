# Сверка критериев выхода фазы 2 (Quiz)

**Дата:** 2026-09-10
**Тип:** сверка при закрытии среза (код среза — ветка `quiz`, `a75346e..88fab49`, 15 коммитов, +2861/−165 по 62 файлам)
**Основание:** §5 пакета v1.2 («Фаза 2 — Quiz», критерии выхода) + дизайн `2026-09-09-quiz-module-design.md` (утверждён владельцем) + план `2026-09-09-quiz-implementation-plan.md` (14 задач, исполнены батчами 1–5).
**Метод:** каждый критерий подтверждён артефактом (файл:строка) финальным двухстадийным ревью среза (Stage 1 spec-compliance: PASS по всем группам REQ; Stage 2 quality: 0 Critical / 0 Important; вердикт «Ready to merge: Yes»). Полный конвейер на ветке (`88fab49`): build → lint → typecheck → boundary-check → guardrails (все пробники живы) → test:int (159/159, 16 сьютов) → test (sdk 280/280, core 213/213, app-quiz 83/83, server 58/58) — **зелёный**, exit 0.

---

## 1. Критерии выхода (§5 пакета, «Фаза 2 — Quiz»)

| # | Критерий | Вердикт | Артефакт |
|---|---|---|---|
| 1 | Приёмочные e2e-сценарии квиза проходят | ✅ | `apps/server/test/quiz.e2e-spec.ts` — 9/9 сценариев: полная игра (2 раунда, скоростная шкала, dense-rank standings, порядок live-кадров = порядку лога у всех 4 клиентов), чит-тест, late-join участника, late-join зрителя, анти-бот, конкурентный double-answer, ролевые гейты, пересоздание проекции, запечатанная комната |
| 2 | **Чит-тест:** правильный ответ недоступен ни через REST, ни через realtime, ни через replay, ни по метаданным seq, ни через проекцию `appSettings` | ✅ | realtime: сериализационная проверка (`JSON.stringify` на `"correctIndex"`/`"correctAnswers"`) всех pre-reveal кадров/ack/snapshot участника (`quiz.e2e-spec.ts:352-371`); replay новым сокетом после раунда — легален, `answer.submitted` (module-private) и `correctAnswers` отсутствуют (`:384-390`); организаторский snapshot тоже без `correctAnswers` (module-private никому, `:394-398`). appSettings: `correctAnswers` без аннотации → fail-safe module-private (`quiz-manifest.contract.spec.ts:177-181`, REQ-CORE-008). REST: канала чтения состояния структурно нет (вся REST-поверхность — POST-эндпоинты входа/refresh/exclude/OAuth). seq: `ProjectedEvent` не несёт seq (`projected-event.schema.ts:13-18`, наследие ф.1) |
| 3 | **Анти-бот-тест:** ответ в субчеловеческом темпе отклонён (REQ-RT-013) | ✅ | `quiz-handlers.ts:62-68` (строгий `<`, `0` = контроль выкл); граничные unit `quiz-handlers.spec.ts:135-163` (interval−1 / interval / 0); e2e сценарий 5 (`minAnswerIntervalMs: 60_000` → `ANSWER_TOO_FAST`, лог чист; `0` → принят) |
| 4 | Тест payload-нейтральности гонки за seq (REQ-RT-007) | ✅ | `app-runtime.int-spec.ts` тест 8: 20 конкурентных dispatch с чередующимися payload 0/4KB — seq плотные (baseline..+39), порядок не коррелирует с размером payload; плюс неизменённый тест критической секции ф.1 (`event-commit.int-spec.ts:428/449`) |

## 2. Объём ф.2 по строке §5 пакета

| Пункт | Вердикт | Артефакт |
|---|---|---|
| `module-private` хранение вопросов и ответов, включая `appSettings` | ✅ | манифест: `correctAnswers` module-private (fail-safe), `answer.submitted` module-private; чит-тест (критерий 2) |
| Арбитраж «кто первый» по логу с анти-упреждающим контролем (REQ-RT-013) | ✅ | порядок по seq (лог — арбитр, ADR-005) + минимальный интервал (критерий 3); скоростная шкала `max(base − k·step, 0)` по seq ответа (`quiz-handlers.ts:73`) |
| Late-join участника и зрителя (SPECTATOR, REQ-ID-011) | ✅ | e2e сценарии 3–4; join-schema структурно отсекает привилегированные роли (`join-request.contract.spec.ts:21-25`); зритель вне лимита участников (`membership.service.ts:182-187,200`); гейт диспетчера до вызова модуля (`app-runtime.service.ts:80-82`) |
| Регистрация и валидация app-схем событий с уровнями видимости | ✅ | 7 типов квиза с точными visibility/clientInitiated, запинены табличным ассертом (`quiz-manifest.contract.spec.ts:18-26,44-52`); валидация payload до коммита — owner-схемой до вызова модуля (`app-runtime.service.ts:99-105`) и per-type в `commitAppEvent` (`event-log.service.ts:144-157`, гейт потолка REQ-CTR-009) |
| Счёт раундов — в состоянии модуля | ✅ | чистый редьюсер `reduceQuiz` (`quiz-state.ts`), проекция пересоздаётся из лога (ADR-005, REQ-CORE-004); totals перестраиваются из `awarded`, payload.totals не доверяется (запинено тестом с заведомо неверным totals) |
| Начисления rewards | ➖ | Фаза 3 по пакету — не входит |

## 3. Требования из Global Constraints плана (сверка Stage 1)

| Группа | Вердикт | Ключевые артефакты |
|---|---|---|
| REQ-CTR-001/002/003 (граница через SDK, JSON-форма, zod — источник истины) | ✅ | boundary `app-only-through-sdk` покрывает `packages/app-` (`.dependency-cruiser.cjs:15-16`); рантайм-контракт в SDK (`app-runtime-module.ts`, `app-commit.ts`, `app-host-context.ts`, `app-rejection.ts`); коммиты модуля ре-валидируются `appCommitSchema` перед записью (`app-runtime.service.ts:120-125`) |
| REQ-CTR-004 (паритет версии контракта) | ✅ | `CONTRACT_VERSION` = `1.5.0` = sdk package.json (`contract-version.ts:8`); контрактный тест паритета; quiz-манифест наследует `contractRange: ^1.5.0` |
| REQ-CTR-005 (фикстуры) | ✅ | `app-commit.fixtures.ts`, join-request role fixtures, manifest fixtures (вкл. invalid missing-`clientInitiated`), quiz manifest contract spec с Ajv2020 |
| REQ-CTR-008/009 (реестр схем, потолки, clientInitiated) | ✅ | `manifestEventSchema` требует `clientInitiated` (`manifest.schema.ts:35`); потолок visibility в `commitAppEvent` шаг 6 |
| REQ-CORE-004/005/008 | ✅ | нет глобального мутабельного состояния (guardrails-пробник жив); видимость строит ядро; состояние модуля — replay-проекция (`app-runtime.service.ts:150-166`) |
| REQ-RT-004 (пин `(appId, manifestVersion)`) | ✅ | диспетчер резолвит пин комнаты и модуль парой ключей (`app-runtime.service.ts:59-93`); fail-closed `MODULE_UNAVAILABLE` (int-spec тест 4) |
| REQ-RT-009 (actorId из аутентифицированного контекста) | ✅ | gateway берёт actorId из claims, roomId из подписки (`realtime.gateway.ts:206-212`); handlers читают только `ctx.actorId` |
| Erratum нейминга (dotted-lowercase, ruling батча 3) | ✅ | wire-имена `question.opened`…`game.finished` единообразно в манифесте, handlers, e2e; camelCase wire-литералов нет; `shortEventNameSchema` не ослаблена |

## 4. Санкционированные отклонения среза (все прошли ревью, журнал — леджер SDD)

1. **Ruling pre-flight:** плотность seq ассертится относительно baseline (в логе уже есть lifecycle-события), не абсолютных 1..20.
2. **T5:** `describe('AppRegistryModule')` переведён на `register([])` — статический импорт стал fail-closed.
3. **T7:** `AppRuntimeModule.register` получил `imports: [PrismaModule, MembershipModule, RealtimeModule]` — без них Nest DI не разрешает deps (int-spec строил сервис вручную).
4. **T8:** гард лимита участников обёрнут `if (role !== 'spectator')` — count-запрос (PARTICIPANT) не тронут, прочие гейты на месте.
5. **T9 (ruling контролёра, erratum):** имена событий квиза — dotted-lowercase под существующую `shortEventNameSchema`; ослабление схемы отклонено (blast radius на все приложения, REQ-CTR-008).
6. **T10:** `reduceQuiz` игнорирует `payload.totals`, перестраивает из `awarded` — проекция не доверяет производным данным payload.
7. **T11:** dense-rank standings (fix round 1: competition ranking 1,2,2,4 → плотный 1,2,2,3 + различающий тест).
8. **T13:** e2e без override'ов `APP_MANIFESTS`/`APP_RUNTIME_MODULES` — под тестом фактический composition root (сильнее буквы плана); локальная копия `readRoomLog` (barrel ядра его не экспортирует — утверждение плана устарело); противоречие плана о standings/total 0 разрешено в пользу сценария 1 (totals строятся только из awarded).

## 5. Deferred minors (триаж финального ревью: все stay-deferred, не гейтят мердж)

Полный список с обоснованиями — в леджере среза (`.superpowers/sdd/2026-09-09-quiz-implementation-plan/progress.md`, не в git). Из финального ревью добавлены: неограниченный рост `AppProjectionCache` (per-room записи без эвикции — фаза 4); clamp-ветка скоринга без отдельного теста (провод защищён схемой `points.min(0)`); устаревший комментарий в `realtime.e2e-spec.ts:89-90`. **Кандидат на решение владельца (вне среза):** AJV предупреждение `unknown format "uuid" ignored` — zod v4 эмитит `format: "uuid"`, stock Ajv 8 без ajv-formats его не принуждает; для среза безопасно (uuid-поля только в server-generated событиях), вопрос enforcement формата на commit-гейте — отдельной задачей.

## 6. Вердикт

**Фаза 2 (Quiz) закрыта.** Все четыре критерия выхода §5 подтверждены артефактами; объёмная строка закрыта (rewards — фаза 3 по пакету); Stage 1/Stage 2 финального ревью чистые; конвейер зелёный.

Гейты над следующими фазами не изменены: **юрист** до первого события с посторонними/призами (`docs/legal/questions-for-lawyer.md`), **manual smoke OAuth** с реальными Google-кредами (действие владельца), **первое живое событие** до тяжёлых вложений в фазу 3 (rewards/лотерея). Следующий срез — выбор владельца.
