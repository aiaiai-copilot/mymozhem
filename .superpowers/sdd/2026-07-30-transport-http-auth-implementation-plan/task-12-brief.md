### Task 12: Полные гейты + живой docker boot smoke

**Files:** только новые коммиты при находках.

- [ ] **Step 1: Полные ланы из корня**

```bash
pnpm build && pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm boundary-check && pnpm guardrails
```
Expected: всё зелёное. Docker Desktop запущен.

- [ ] **Step 2: Docker boot smoke**

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build -d
# /health/ready → 200; миграции применены (логи server или prisma migrate deploy в entrypoint — по факту Dockerfile)
curl -s -X POST localhost:3000/rooms/join -H 'content-type: application/json' -d '{"code":"NOPE1234","displayName":"Probe"}'
# ожидается: 403 {"code":"ROOM_JOIN_DENIED"} — транспорт + фильтр живы
docker compose down -v   # lt-pg не трогаем
```

- [ ] **Step 3: Обновить HANDOFF.md** (состояние среза, follow-ups: realtime-handshake берёт `TokenService.verify` + формат claims; OAuth-срез — REGISTERED-ветка; REQ-ID-010 sweep-джоб отложен). Commit.

---

## Spec coverage (сверка с дизайном)

| Дизайн § | Task |
|---|---|
| §3 компоненты (TransportModule, контроллеры, фильтр, AuthModule) | 4, 7, 8, 9 |
| §4 токен-модель + Session | 3, 4, 5 |
| §5 маппинг ошибок | 1 (коды), 7 |
| §6 контроли (real-IP, eviction, refresh-limit, helmet/CORS, uuid) | 6, 8, 9, 10 |
| §7 конфиг | 2 |
| §8 seed-скрипт | 11 |
| §9 тесты | 1, 2, 3, 4, 5, 6, 7, 10 |
| §0.3 parked minors (real-IP, eviction, uuid) | 9, 6, 7 |

## Follow-ups, которые этот план осознанно НЕ закрывает (фиксация для handoff)

- Realtime-handshake: берёт `TokenService.verifyAccessToken` + claims-формат как есть.
- OAuth-срез: `POST /rooms`, REGISTERED-ветка `TokenService` (без roomId-scope), Google-флоу.
- REQ-ID-010 (SHOULD): регламентный sweep просроченных сессий — таблица готова, джоб не строится.
- Access-revocation по `sid` (усиление после первого события, дизайн §11).
- appSettings follow-ups для configure-го транспорта (guard на null settings и пр.) — когда configure получит HTTP.
