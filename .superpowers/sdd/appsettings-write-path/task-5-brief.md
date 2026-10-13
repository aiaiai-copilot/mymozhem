### Task 5: Полные гейты + живой boot артефакта

**Files:** только чтение/прогон; изменений кода нет (если гейт красный — возврат к задаче-виновнику).

**Interfaces:**
- Consumes: всё выше.
- Produces: зелёный CI-эквивалент локально; доказанный boot с 5 миграциями.

- [ ] **Step 1: Полная лана гейтов из корня**

Run:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm boundary-check && pnpm guardrails && pnpm build
```

Expected: всё зелёное. `boundary-check` — 0 нарушений (зависимость room → app-registry внутри core правилам не запрещена, конфиг не менялся).

- [ ] **Step 2: Живой boot docker-артефакта со свежей БД**

Run:

```bash
docker compose up --build -d
until curl -sf http://localhost:3000/health/ready >/dev/null; do sleep 2; done
docker compose exec -T postgres psql -U mymozhem -c "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at NULLS LAST;"
docker compose down -v
```

Expected: `/health/ready` → 200; в `_prisma_migrations` 5 строк, последняя `<timestamp>_room_app_config`; `down -v` убирает контейнеры и volume (хост-порт 5432/`lt-pg` не тронут — compose не публикует postgres наружу). Если psql-запрос не находит таблицу в `public` (multiSchema) — fallback: `docker compose logs server 2>&1 | grep -i "room_app_config"` — миграция видна в логе применения при старте.

- [ ] **Step 3: Финальный коммит при необходимости**

Если Steps 1–2 потребовали правок — закоммитить их отдельно (`fix(core): …` с REQ-тегом). Если правок не было — коммита нет, задача завершена.
