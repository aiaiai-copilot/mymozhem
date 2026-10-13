## Task 9: Parallel non-blocking deliverables — legal questions and phase-remapping amendment

**Files:**
- Create: `docs/legal/questions-for-lawyer.md`
- Create: `docs/spec/amendment-v1.3-phase-remapping.md`

**Interfaces:** none (documentation). These are the §6.1 gate-prep and the §1.4 amendment draft from the design; they do not gate phase-0 code.

- [ ] **Step 1: Create `docs/legal/questions-for-lawyer.md`**

```markdown
# Вопросы юристу — гейт перед событием с посторонними/призами (§6.1)

Готовит агент; заключение даёт живой юрист. Не блокирует фазу 0.

1. **152-ФЗ и неудаляемый лог.** Мы храним append-only лог событий комнаты;
   право на удаление реализуем анонимизацией строки identity (обнуление PII,
   сохранение id и actorId в логе). Удовлетворяет ли анонимизация обязанности
   удаления ПДн, или требуется физическое удаление?
2. **Согласие гостя.** Гость входит по коду комнаты и имени, без регистрации.
   Какое согласие на обработку ПДн необходимо и как его фиксировать при
   гостевом входе?
3. **Стимулирующие лотереи.** Механика «лотерея с призом» на живом событии —
   подпадает ли под регулирование стимулирующих лотерей? Требования к правилам,
   уведомлению, срокам?
4. **Налог с выигрыша.** Кто налоговый агент при выдаче материального приза
   победителю; какие пороги и обязанности возникают у организатора/платформы?
5. **Локализация данных.** Требование хранения ПДн граждан РФ на территории РФ —
   как влияет на выбор хостинга единого артефакта и БД?
6. **Закрытый тест среди знакомых до заключения.** Допустимо ли провести
   закрытое событие в кругу знакомых (без посторонних, без денежных призов)
   до получения заключения юриста, и на каких условиях?
```

- [ ] **Step 2: Create `docs/spec/amendment-v1.3-phase-remapping.md`**

```markdown
# Амендмент v1.3 (черновик) — фазовая пере-разметка

**Статус:** черновик для решения владельца. Меняет разметку фаз, НЕ нормы.
Основание: организующий принцип «кратчайший путь к первому живому событию» +
фильтр задела для защитных норм (сессия 2026-07-11).

| Норма | Было (фаза 1) | Предлагается | Основание |
|---|---|---|---|
| REQ-RT-011 (метаданные seq) | MUST, ф.1 | SHOULD на MVP; MUST с механикой со скрытым таймингом | актор скрытого тайминга (T7) на живом квизе отсутствует; per-level нумерация нетривиальна |
| REQ-RT-014/015 (лимиты/бэкофф) | полностью, ф.1 | базовый per-actor rate-limit — ф.1; режимы/reconnect-бэкофф — ф.4 | флудер-вектор маловероятен на одной комнате знакомых |
| REQ-ID-019 (глобальный backoff) | ф.1 | per-IP (REQ-ID-006) — ф.1; глобальный слой — ф.4 | распределённый перебор — угроза этапа «много комнат» |
| REQ-ID-018 + право исключения MODERATOR | ф.1 (дубль с ф.4) | в MVP исключает только ORGANIZER; MODERATOR получает право вместе с контролями ID-018 в ф.4 | право без контролей нарушает букву REQ-ID-011 |
| Kind-флип flow (REQ-ID-004/017 как код) | ф.1 | после первого события; схема с `kind` и partial index — с ф.1 | на первом событии привязки аккаунта нет |

**Не меняется:** формулировки норм, их уровни MUST/SHOULD как таковые вне
указанной пере-привязки к фазам, ADR-001…011.
```

- [ ] **Step 3: Commit**

```bash
git add docs/legal/questions-for-lawyer.md docs/spec/amendment-v1.3-phase-remapping.md
git commit -m "docs: lawyer question list + phase-remapping amendment draft (§6.1, §1.4)"
```

---

## Phase 0 Exit Criteria (verify all before declaring done)

From the design §4 and normative package §5:

- [ ] At least one contract schema with a valid/invalid fixture pair: valid passes, invalid rejected, a deliberate schema break turns the test suite red (Task 2, verified in Step 10).
- [ ] boundary-check catches a deliberately-introduced boundary violation **and** a module-level mutable export — as a permanent CI step, not a one-off demo (Task 3, `pnpm run guardrails`).
- [ ] The artifact builds and comes up with one command; `/health/ready` is green against a real DB (Task 7, Step 6).
- [ ] CI runs lint + typecheck + test + build + guardrails on every PR (Task 8).
- [ ] Lawyer question list exists; amendment v1.3 draft handed to the owner (Task 9).

---

## Self-Review Notes

- **Spec coverage:** design §3 tasks 1–9 map 1:1 to Tasks 1–9; exit criteria §4 map to the checklist above. Global constraints (one lockfile, boundary-from-commit-1, no forward scaffolding, docs/sessions placement) are enforced by Tasks 1/3/5 and the file structure.
- **Deferred within accepted norms (flagged, not silent):** Prisma `multiSchema` deferred to phase 1's first model (Task 5 design note); REQ-RT-011/014/015, REQ-ID-018/019, kind-flip flow deferred via the v1.3 amendment draft (Task 9) — owner decision, not implemented silently.
- **Type consistency:** `loadConfig`/`AppConfig`, `PrismaService.isHealthy`, `HealthController.ready`, `logEventSchema`/`LogEvent`, fixture shapes are used identically across the tasks that produce and consume them.
- **Not in phase 0 (anti-forward):** no app-modules, no Prisma models, no auth/tokens, no socket.io, no OpenAPI/AsyncAPI generation, no §4 parameters beyond the minimal config.
```
