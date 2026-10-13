# Task 12 — ревью: квиз в composition root

**Ревьюируемый диапазон:** `4d33181..e30ac5a` (1 коммит, 3 файла, +9/-2)
**Метод:** ревью диффа как файла; тесты не перезапускались (доказательства — в отчёте исполнителя).

---

## 1. Spec compliance: ✅

Проверено по брифу построчно:

| Пункт брифа | Факт в диффе | Вердикт |
|---|---|---|
| `import { createQuizApp } from '@mymozhem/app-quiz'` | `app.module.ts:2` — добавлен | ✅ |
| `const quiz = createQuizApp()` на уровне модуля | `app.module.ts:14` | ✅ |
| `AppRegistryModule.register([quiz.manifest])` | заменяет `register([])` | ✅ |
| `AppRuntimeModule.register([quiz.runtime])` | заменяет `register([])`, убран устаревший комментарий «пусто до Task 12» | ✅ |
| Прочие импорты/записи не тронуты и не переупорядочены | PrismaModule, HealthModule, RoomModule, IdentityModule, MembershipModule, RealtimeModule, TransportModule — на местах, в исходном порядке; импорт из `@mymozhem/core` не изменён | ✅ |
| `apps/server/package.json`: `"@mymozhem/app-quiz": "workspace:*"` | секция `dependencies`, перед `@mymozhem/core` — алфавитный порядок сохранён, форматирование консистентно | ✅ |
| `pnpm-lock.yaml` — только новый линк | +3 строки: `specifier: workspace:*` / `version: link:../../packages/app-quiz`; никакого re-resolution шума | ✅ (REQ-DEV-002) |
| Коммит: conventional, по-русски, трейлер | `feat(server): квиз в composition root — манифест и рантайм-модуль через register` + `Co-Authored-By: Claude Code <noreply@anthropic.com>` | ✅ |
| Стадятся ровно `apps/server` + `pnpm-lock.yaml` | `git show --stat`: ровно 3 файла (package.json, app.module.ts, pnpm-lock.yaml) | ✅ |
| Push не выполнять | push не выполнялся; `origin/main..HEAD` содержит всю ветку целиком — согласовано с решением владельца (push — решение владельца) | ✅ |

**Глобальный констрейнт границ:** дифф не трогает `packages/*` вообще; импорт `@mymozhem/app-quiz` происходит только в `apps/server` (composition root) — ровно как предписано. Нарушения «app-* не импортирует core» в этом диффе невозможно по построению.

**Уточнение исполнителя о контексте Task 7 — подтверждено.** Проверено по файлам:
- `packages/core/src/app-runtime/app-runtime.module.ts:12` — `static register(modules: RegisteredRuntimeModules): DynamicModule` (одноаргументная);
- `packages/core/src/app-registry/app-registry.module.ts:11` — `static register(manifests: readonly unknown[])` (одноаргументная);
- `createQuizApp()` экспортируется из entry-пoinта пакета (`packages/app-quiz/src/quiz-runtime.ts:20`, ре-экспорт через `index.ts:6`), сигнатура `{ manifest, runtime }` — соответствует использованию.

Call site в диффе (одноаргументные вызовы с массивами) совпадает с брифом; внутренности модулей ядра не тронуты (дифф ограничен `apps/server` + lockfile). Замечание исполнителя корректно: `imports` живут внутри `AppRuntimeModule.register`, а не в месте вызова — расхождение было в контексте контроллера, не в коде.

## ⚠️ Cannot verify from diff

- Результаты прогона (`pnpm install/build/typecheck/test`, 49 tests passed, boundary-check чисто) — приняты по отчёту исполнителя, как предписано протоколом ревью. Отчёт внутренне консистентен (зелёный typecheck косвенно подтверждается корректностью сигнатур, проверенной выше).

## Strengths

- Минимальный, хирургический дифф: ровно то, что требует бриф, ни одной лишней строки.
- Lockfile чистый — только workspace-линк, без каскадной пере-резолюции (частый источник шума в монорепо).
- Убран отработавший TODO-комментарий «пусто до Task 12» — уместная уборка в рамках задачи.
- Исполнитель вскрыл неточность во входном контексте (про `imports:` в Task 7), проверил по коду и действовал по брифу — правильное поведение, зафиксировано в отчёте.

## Issues

**Critical:** нет.

**Important:** нет.

**Minor:** нет.

(Замечание для протокола, не issue: `const quiz = createQuizApp()` на уровне модуля не нарушает REQ-CORE-004 — фабрика возвращает манифест и класс рантайм-модуля; инстансы с состоянием создаются Nest per-room внутри app-runtime, глобального мутабельного состояния процесса здесь нет. Форма соответствует брифу и дизайну Task 11.)

## Task quality verdict: **Approved**

Соответствие брифу полное, границы соблюдены, коммит оформлен по конвенции, lockfile минимален, отклонение от входного контекста корректно диагностировано и задокументировано.
