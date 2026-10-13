# Task 12 — отчёт: квиз в composition root

**Статус:** DONE
**Коммит:** `e30ac5a` — `feat(server): квиз в composition root — манифест и рантайм-модуль через register`
**Ветка:** quiz (worktree `.worktrees/quiz`), push не выполнялся (по инструкции).

## Diff summary (3 файла, +9/-2)

- `apps/server/src/app.module.ts` (+5/-2):
  - добавлен импорт `createQuizApp` из `@mymozhem/app-quiz`;
  - `const quiz = createQuizApp();` на уровне модуля;
  - `AppRegistryModule.register([])` → `AppRegistryModule.register([quiz.manifest])`;
  - `AppRuntimeModule.register([])` → `AppRuntimeModule.register([quiz.runtime])` (убран комментарий «пусто до Task 12»);
  - все прочие импорты и записи `imports` (PrismaModule, HealthModule, RoomModule, IdentityModule, MembershipModule, RealtimeModule, TransportModule) сохранены без изменений.
- `apps/server/package.json` (+1): `"@mymozhem/app-quiz": "workspace:*"` — перед `@mymozhem/core`, в алфавитном порядке секции dependencies.
- `pnpm-lock.yaml` (+3): workspace-линк новой зависимости.

## Команды и результаты

| Команда | Результат |
|---|---|
| `docker ps` | OK (testcontainers доступны) |
| `pnpm install` | Done in 6.7s, «Already up to date», линк добавлен |
| `pnpm build` | 4/4 tasks successful (sdk, core, app-quiz, server) |
| `pnpm typecheck` | 7/7 tasks successful |
| `pnpm --filter @mymozhem/server test` | **4 suites passed, 49 tests passed** (transport, oauth, realtime + четвёртый e2e), 7.5s. ERROR-логи `OAuthError: google oauth not configured` в выводе — ожидаемые assertions ошибочного пути oauth.e2e, не сбой. |
| `pnpm --filter @mymozhem/server lint` | чисто |
| `pnpm boundary-check` | ✔ no dependency violations found (518 modules, 1496 dependencies) |

Существующие e2e не затронуты: они override'ят `APP_MANIFESTS`/`APP_RUNTIME_MODULES` своими тестовыми модулями — регистрация квиза в AppModule на них не влияет (подтверждено зелёным прогоном).

## Отклонения от брифа

1. **Контекст родителя о Task 7 не соответствовал файлу.** В контексте сессии было сказано, что `AppRuntimeModule.register` уже получил `imports: [PrismaModule, MembershipModule, RealtimeModule]` в Task 7. Фактически в `app.module.ts` был `AppRuntimeModule.register([])` без options — а `imports` находятся внутри `AppRuntimeModule.register()` (`packages/core/src/app-runtime/app-runtime.module.ts:21`) и меняться не должны. Действовал по брифу: изменён только аргумент-массив, сигнатура `register(modules)` одноаргументная — всё сходится.

TDD не применялся (pure wiring, в брифе нет RED-шага) — гейтом служит зелёный сьют.

## Concerns

Нет.
