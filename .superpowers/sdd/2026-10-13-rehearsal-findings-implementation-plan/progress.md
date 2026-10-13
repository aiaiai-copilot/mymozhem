# SDD ledger — plan: docs/sessions/2026-10-13-rehearsal-findings-implementation-plan.md

Батч A (задачи T1–T2), сессия 39. Worktree `.worktrees/rehearsal-fixes-a`, ветка `rehearsal-fixes-batch-a` от local main `346d275`.
Spec: `docs/sessions/2026-10-13-rehearsal-findings-design.md` (§0 решения владельца №2/№7, §2, §8.1) — читал контроллер; план аргументирует из неё.

Baseline (до T1): core 20 suites / 225 tests PASS; server typecheck PASS; bootstrap e2e 2/2 PASS (docker+testcontainers живы). Worktree setup: `pnpm install` → `pnpm build` (SDK dist) → `pnpm --filter @mymozhem/core prisma:generate` (postinstall выключен — известное поведение репо).

## Pre-flight scan (перед T1)

| Пара/задача | Что производит → что потребляет | Находка |
|---|---|---|
| T1 → T2 | T1 += `TEST_CONFIG.COOKIE_SECURE: 'auto'` → T2 конструирует сервисы с TEST_CONFIG | Аддитивно, конфликта нет; общих файлов нет (T1 — core+compose, T2 — только server test) |
| T1 внутри | создаёт refresh-cookie.spec.ts; правит config.schema.ts / refresh-cookie.ts / test-config.ts / config.schema.spec.ts / docker-compose.yml | Согласовано. FakeReply структурно совместим с ReplyLike (методная бивариантность). Вставка после блока TRUST_PROXY (config.schema.ts:48-52) — место существует. Плановый `base` внутри `it` затеняет файловый `base` config.schema.spec.ts — допустимо, стиль файла сохранить |
| T2 внутри | создаёт apps/server/test/xff-forwarded-for.e2e-spec.ts целиком | Конструкция сервисов = transport.e2e-spec.ts:119-141 (верифицировано: EventOutbox 3-arg, EventLogService 4-arg, MembershipService 5-arg с JoinRateLimiter(1000), TokenService 2-arg, seedIdentity {id, email}). Маршрут exclude — exclude.controller.ts:20. jest-env-setup даёт ORGANIZER_SETUP_TOKEN. TRUNCATE-список = transport.e2e:153 |
| T2 vs Global Constraints | прогон `-- xff-forwarded-for` — уникальное имя файла | Урок Quiz-среза (testPathPattern матчит путь, включая имя worktree `.worktrees/rehearsal-fixes-a`) соблюдён: ни 'rehearsal', ни 'xff' не матчат другие спеки |

Ruling: конфликтов план↔план и план↔код не найдено; скан чист.
Ruling: ветка переименована rehearsal-fixes-batch-a → rehearsal-fixes — ритуал репо: одна ветка на пакет, батчи копятся в ней, мердж no-ff после батча C (финальная приёмка плана). Цена ошибки: косметика имени, переименовать обратно — одна команда.
Ruling: вложенный `.superpowers/sdd/.gitignore` (`*`, создаётся скриптами навыка) снят — решение владельца 329a942: леджеры В git. Цена ошибки: scaffolding-файл снова появится при следующем прогоне sdd-скриптов — снимать при консолидации леджера.

## Ход исполнения

Task 1: minor (deferred): stray пробел в комментарии refresh-cookie.spec.ts:4 (« Secure-атрибут» — verbatim из плана).
Task 1: minor (deferred): test-local `base` в config.schema.spec.ts:60 затеняет файловый (plan-mandated, прецедент соответствия стилю).
Task 1: complete (commits 346d275..151dbf6, review clean — spec ✅, quality approved; ⚠️-пункты ревью закрыты контроллером: зелень полной core-сьюты 21/230 в отчёте покрывает cookie-потребителей, compose-дефолт `:-auto` подтверждён прогоном `docker compose config`).

Task 2: complete (commits 151dbf6..8dec889, review clean — spec ✅, quality approved; ruling I-1 подтверждён: сьют зелёный сразу, эмпирика XFF-цепочки записана фактом в комментарий (leftmost/client адрес — req.ip)).
Task 2: minor (deferred): `.sort()` на паре статусов лексикографический (корректно для 3-значных кодов; при смешанной длине понадобится компаратор).
Task 2: observation (deferred, кандидат владельцу): server `lint` покрывает только `src`, `test/` не линтуется — для этого диффа не важно (typecheck+jest гейтают), поднимать если хотим lint тестов как постоянный гейт.

## Финальное целобатчевое ревью (fable, range 346d275..8dec889)

Вердикт: **Ready to merge — Yes**. Critical/Important — нет. Spec-compliance по REQ-разметке подтверждён эмпирически ревьюером (полные core/server сьюты, compose-дефолт, boundary-check, guardrails). Невакуумность XFF-сьюта подтверждена статически (регрессия в shared-bucket красит конкретные ассерты).
Финревью: minor (deferred): refresh-cookie.spec — FakeReply сужает options до {secure}; атрибуты REQ-ID-008 (httpOnly/sameSite/path/maxAge) нигде не запинаны — кандидат ride-along при следующем касании файла (рекомендация: батч B/C).
Финревью: minor (deferred): имя теста xff :239 «fail-closed пин main.ts» преувеличивает — main.ts:21 сьюютом не покрывается (честно раскрыто в шапке файла); пин wiring — уровень bootstrap.e2e, отдельный кандидат владельцу.
Триаж deferred-миноров финревьюм: все 4 stay-deferred (пробел в комментарии; shadowing base; лексикографический sort; lint только src — кандидат владельцу как tooling-решение).
