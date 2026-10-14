# Task 6 report: Стейл-roomId в консоли (находка №3)

**Статус:** DONE
**Коммит:** `9091d0190c60f6cadd13b47efeb9dbf6f2753a16` (branch `rehearsal-fixes`, worktree `.worktrees/rehearsal-fixes-a`)

## Что сделано

1. **Step 1 — падающий тест.** Создан `apps/web/src/pages/host/console-page.spec.ts` дословно по брифу (предикат `isStaleRoomJoinError`, 2 теста).
2. **Step 2 — реализация** в `apps/web/src/pages/host/console-page.tsx`:
   - экспорт `isStaleRoomJoinError(code)` перед компонентом (ACTOR_NOT_MEMBER | NOT_FOUND → true);
   - хуки `roomGone`/`useEffect` сразу после `binding`/`feed` (до рендер-веток, безусловны): на переход `binding.joinError` → `SessionStore.clearHostRoom()` + `setRoomGone(true)`;
   - рендер-ветка `if (roomGone)` сразу после существующей `if (!roomId)`: «Комната не найдена» + ссылка `/host/setup`.
   Код — дословно из брифа, включая русские комментарии (причина/инвариант, не пересказ кода).
3. **Step 3 — гейты + коммит** (2 файла, как указано в брифе).

## Прогоны

### Падающий (до реализации)
```
$ pnpm --filter @mymozhem/web exec vitest run src/pages/host/console-page.spec.ts
 FAIL  src/pages/host/console-page.spec.ts > isStaleRoomJoinError > ACTOR_NOT_MEMBER и NOT_FOUND → true
 FAIL  src/pages/host/console-page.spec.ts > isStaleRoomJoinError > прочие коды и null (сеть) → false
TypeError: isStaleRoomJoinError is not a function
 Test Files  1 failed (1)
      Tests  2 failed (2)
```

### Проходящий (после реализации)
```
$ pnpm --filter @mymozhem/web exec vitest run src/pages/host/console-page.spec.ts
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

### Гейты
```
$ pnpm --filter @mymozhem/web lint       → eslint src, чисто
$ pnpm --filter @mymozhem/web typecheck  → tsc --noEmit, чисто
$ pnpm --filter @mymozhem/web test       → Test Files 15 passed (15), Tests 94 passed (94)
```
Базовая линия была 14 файлов / 92 теста → стало 15 / 94 (+1 spec, +2 теста), регрессий нет.

## Отклонения от брифа

- К сообщению коммита добавлена строка `Co-Authored-By: Claude Code <noreply@anthropic.com>` — требование окружения; тема и список файлов — строго по брифу.

## Замечания

Нет. Интерфейсы из ранних задач (`SessionStore.clearHostRoom`, `binding.joinError`) использованы как есть, не переизобретены. Зависимости, wire-контракты и SDK не тронуты.
