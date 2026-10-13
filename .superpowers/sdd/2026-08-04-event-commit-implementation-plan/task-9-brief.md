### Task 9: Финальные гейты + сверка spec coverage

**Files:**
- Modify (по факту находок): любые

- [ ] **Step 1: Full gates**

Run последовательно, все зелёные:

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:int
pnpm boundary-check
pnpm guardrails
```

Ожидание: build 3/3, unit (включая новые 4+3 тестов), int (включая новые ~14), boundary-check без violations, guardrails живы.

- [ ] **Step 2: Spec coverage сверка**

Сверить с таблицей ниже: каждая строка закрыта задачей и тестом. Пробел — либо задача в плане пропущена (добавить), либо осознанный шов (§10 дизайна).

- [ ] **Step 3: Commit (если были правки)**

```bash
git commit -am "chore(core): final gate fixes для event-commit среза"
```

---

## Spec coverage

| REQ | Что закрывает | Тест |
|---|---|---|
| REQ-RT-016 (запечатывание) | Task 5 шаг 1 | `seals the log in a terminal status` |
| REQ-RT-014 (per-actor хард, объём v1.3) | Tasks 1-2, 5 шаг 2 | limiter unit ×4; `4th attempt…`, `failed attempts burn…` |
| REQ-RT-012 (размер) | Tasks 1, 5 шаг 3 | config spec; `rejects oversized payload` |
| REQ-CTR-008 (реестр+схема) | Tasks 3, 5 шаги 4-5 | registry spec ×3; `unknown event type`, `payload failing the registered schema` |
| REQ-CTR-009 (потолок видимости) | Task 5 шаг 6 (`isWithinCeiling` из SDK) | `visibility weaker than the declared ceiling`, `visibility STRONGER` |
| REQ-RT-007 (seq, payload-нейтральность) | Task 4 (appendLocked, валидация до lock), Task 8 | `serializes concurrent app commits`, `payload-neutrality` |
| REQ-RT-009 (actorId, service-уровень) | Task 7 | `records actorId on lifecycle events`; membership-гейт-тесты Task 5 |
| REQ-OPS-003 (конфиг fail-closed) | Task 1 | config spec ×2 |
| Отложенное lifecycle §10: actorId≠null | Task 7 | тот же тест |
| Отложенное lifecycle §10: payload-нейтральность | Task 8 | `payload-neutrality` |
| Follow-up: шов-комментарий о порядке блокировок | Task 4 | комментарий в `event-log.service.ts` (проверка ревьюером) |
| Membership-гейт (решение владельца §0) | Task 5 шаг 7 | `actor without membership`, `null actor` |

## Швы после среза (не в скоупе — зафиксировать в HANDOFF при завершении)

- Wire-exposure commit (Socket.io `publish`), подстановка actorId из auth-контекста → realtime transport план.
- Маппинг `EVENT_EMIT_RATE_LIMITED` → `RATE_LIMITED`, остальные коды → wire `{code}` → realtime transport план.
- Read-path (проекции, replay, курсор) → realtime read план.
- `soft_room_event_cap`/алерт/`room_event_cap_mode` → фаза 4.
- Права эмита по ролям (SPECTATOR) → app-семантика, фаза 2.
