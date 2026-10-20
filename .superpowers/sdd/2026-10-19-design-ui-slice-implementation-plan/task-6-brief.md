### Task 6: Дорожки — чистая логика + компонент RaceTracks

**Files:**
- Create: `apps/web/src/state/race-tracks.ts`, `apps/web/src/components/race-tracks.tsx`
- Test: `apps/web/src/state/race-tracks.spec.ts`

**Interfaces:**
- Consumes: `ProjectedEvent` из SDK; payload `question.revealed` (`awarded: [{actorId, points}]`) из `@mymozhem/app-quiz`.
- Produces: `lastRoundGains(events: ProjectedEvent[]): Record<string, number>` — `awarded` ПОСЛЕДНЕГО `quiz.question.revealed` (прирост за раунд из перефолженного лога, дизайн §7 — reconnect-safe); `trackWidths(entries: {actorId, total}[], gains): Map<string, {fillPct, gainPct}>` — нормировка к лидеру (=100%), fill = (total−gain)/leader, gain = gain/leader, лидер 0/все нули → всё 0 (пустая дорожка); `topNWithRest<T>(list: T[], n: number): { top: T[]; rest: number }`; `myPlace(sortedEntries, myId): number | null`. Компонент `<RaceTracks entries={[{actorId, name, total, gain}]} highlightId? topN? contour="scene"|"console" />` — разметка по мокапу `component-states-live.html` (`.track-row/.tr-top/.tr-lane/.fill/.gain`, tabular-nums, transition var(--t-race); полотно: сцена `--track-canvas-dark`, консоль `--track-canvas-light`), «ещё N» при `topN`; DOM-тестов нет (паттерн репо), верификация T13. Потребители: T7, T8, T9.

- [ ] **Step 1: Failing test** — лидер-нормировка (1500/1200/900 → 100/80/60), прирост-сегмент (gain отделён от fill), нулевой лидер → пустые дорожки, нулевой gain → gainPct 0, `lastRoundGains` берёт последний reveal (два reveal подряд), `topNWithRest([…7], 4)` → rest 3, `myPlace` (плотный порядок desc, отсутствующий → null).
- [ ] **Step 2:** RED.
- [ ] **Step 3:** Реализация логики + компонент.
- [ ] **Step 4:** GREEN, typecheck.
- [ ] **Step 5: Commit** `feat(web): race-tracks — логика дорожек (нормировка к лидеру, прирост из последнего reveal) + компонент RaceTracks`.

---

## Батч C — сцена и консольный каркас (задачи 7–9)

