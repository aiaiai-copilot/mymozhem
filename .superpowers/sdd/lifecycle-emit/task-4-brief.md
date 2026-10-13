### Task 4: Экспорты, регистрация в сервере, полные гейты, boot-проверка

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `apps/server/src/app.module.ts`

**Interfaces:**
- Consumes: `RealtimeModule`, `EventLogService` (Task 2–3).
- Produces: публичный экспорт `@mymozhem/core`: `RealtimeModule`, `EventLogService`; `AppModule` импортирует `RealtimeModule`.

- [ ] **Step 1: Добавить экспорты в `packages/core/src/index.ts`**

Добавить в конец файла:

```ts
export * from './realtime/event-log.service';
export * from './realtime/realtime.module';
```

- [ ] **Step 2: Зарегистрировать модуль в `apps/server/src/app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import {
  AppRegistryModule,
  HealthModule,
  PrismaModule,
  RealtimeModule,
  RoomModule,
} from '@mymozhem/core';

@Module({
  imports: [PrismaModule, HealthModule, AppRegistryModule, RoomModule, RealtimeModule],
})
export class AppModule {}
```

- [ ] **Step 3: Прогнать boundary-check и guardrails**

Run: `pnpm boundary-check && pnpm guardrails`
Expected: `0 violations` (правило `socketio-only-in-realtime` уже предусматривает `packages/core/src/realtime`; новых правил не требуется — зависимость `room → realtime` внутри core не ограничена, циклов нет). Guardrails: все проверки зелёные.

- [ ] **Step 4: Прогнать полный набор гейтов монорепо**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: всё зелёное во всех пакетах (SDK 162/162 без изменений; core unit 55/55; сборка server с новым импортом проходит).

- [ ] **Step 5: Прогнать интеграционную лану монорепо**

Run: `pnpm test:int`
Expected: всё зелёное (core int: 33 теста). Требуется запущенный Docker Desktop.

- [ ] **Step 6: Boot-проверка артефакта (критерий §9 спеки)**

```bash
docker compose up --build -d
until curl -sf http://localhost:3000/health/ready > /dev/null; do sleep 2; done
docker compose down -v
```

Expected: `/health/ready` отвечает 200 (сервер применил все миграции, включая `realtime_log_event`, на свежей БД). Предусловия: Docker Desktop запущен, порт 3000 свободен. Если boot падает на миграции — это сигнал о проблеме миграции/entrypoint, исправить до коммита, не пропускать.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index.ts apps/server/src/app.module.ts
git commit -m "feat(core): export and register RealtimeModule in server (REQ-RT-010)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review прогон (выполнен при написании)

- **Покрытие спеки:** §2 (модель данных) → Task 1; §3 (примитив, модуль) → Task 2; §4 (transition) → Task 3; §6 (обвязка, экспорты) → Task 4; §7 (тесты: эмит, конкуренция, миграция) → Tasks 1–3; §9 (критерии выхода: гейты, migrate deploy, регистрация, boot) → Task 4. Пробелов нет.
- **Консистентность типов:** `commitCoreEvent(tx, roomId, name, payload?, actorId?)` одинаково в Task 2 (produces) и Task 3 (consumes); `readRoomLog` — один хелпер, два потребителя; конструктор `RoomService(prisma, eventLog)` синхронно в Task 3 produces и всех call-sites.
- **TDD-честность:** RED-прогоны явные (Task 1 step 2; Task 2 step 2; Task 3 step 3 с оговоркой про временное комментирование emit-строки).
