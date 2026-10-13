### Task 9: LogStore + проекции + golden-фикстура

**Files:**
- Create: `apps/web/src/state/log-store.ts`, `apps/web/src/state/projections.ts`, `apps/web/src/state/roster-refetch.ts`, `apps/web/src/state/fixtures/quiz-log.fixture.ts`
- Test: `apps/web/src/state/log-store.spec.ts`, `apps/web/src/state/projections.spec.ts`, `apps/web/src/state/roster-refetch.spec.ts`

**Interfaces:**
- Consumes: `ProjectedEvent`, `AppLogEvent`, `coreEventType`, `RoomStatus` (SDK); `initialQuizState/reduceQuiz/QuizState`; `initialLotteryState/reduceLottery/LotteryState`.
- Produces: `LogStore { pushLive(e); applySnapshot(events); reset(); all(): ProjectedEvent[] }`; `toAppLogEvent(e, appId, localSeq, recordedAt)`; `projectQuiz(events, recordedAt): QuizState`; `projectLottery(events, recordedAt): LotteryState`; `deriveRoomStatus(events): RoomStatus`; `shouldRefetchRoster(type: string): boolean`.

- [ ] **Step 1: Failing tests log-store** (вкл. Review Focus 3 — дуп из окна handshake применён дважды и это запинано):

```ts
it('buffers live events until snapshot; all() = snapshot + buffered + live')
it('duplicate from the handshake window is applied twice (accepted, design §3)')
it('reset() clears everything (re-subscribe path)')
```

- [ ] **Step 2: Implement LogStore**

```ts
import type { ProjectedEvent } from '@mymozhem/sdk';

// Фолд-модель клиента (дизайн §3): live до snapshot — в буфер; после snapshot —
// напрямую. Дуп из окна handshake (событие и в snapshot, и в буфере) структурно
// неотличим (wire без id/seq, REQ-RT-011a) — принят; лечится re-subscribe → reset +
// полный перефолд. Потеря события исключена.
export class LogStore {
  private snapshot: ProjectedEvent[] | null = null;
  private buffered: ProjectedEvent[] = [];
  private live: ProjectedEvent[] = [];

  pushLive(event: ProjectedEvent): void {
    (this.snapshot === null ? this.buffered : this.live).push(event);
  }
  applySnapshot(events: ProjectedEvent[]): void {
    this.snapshot = [...events];
  }
  reset(): void {
    this.snapshot = null;
    this.buffered = [];
    this.live = [];
  }
  all(): ProjectedEvent[] {
    return this.snapshot === null ? [] : [...this.snapshot, ...this.buffered, ...this.live];
  }
}
```

- [ ] **Step 3: Failing tests projections + roster-refetch, затем implement**

```ts
// projections.ts
import { coreEventType, type AppLogEvent, type ProjectedEvent, type RoomStatus } from '@mymozhem/sdk';
import { initialQuizState, reduceQuiz, type QuizState } from '@mymozhem/app-quiz';
import { initialLotteryState, reduceLottery, type LotteryState } from '@mymozhem/app-lottery';

// Адаптер wire → AppLogEvent (дизайн §3): wire несёт '<appId>.<short>' без seq/recordedAt
// (REQ-RT-011a). Локальный seq сохраняет порядок приёма; recordedAt — момент приёма
// (только отображение; баллы едут в payload question.revealed, не из тайминга).
export const toAppLogEvent = (
  event: ProjectedEvent, appId: string, localSeq: number, recordedAt: string,
): AppLogEvent => ({
  shortName: event.type.slice(appId.length + 1),
  payload: event.payload,
  actorId: event.actorId,
  seq: localSeq,
  recordedAt,
});

const foldApp = <S>(
  appId: string,
  events: ProjectedEvent[],
  initial: () => S,
  reduce: (state: S, event: AppLogEvent) => S,
  recordedAt: string,
): S =>
  events
    .filter((e) => e.type.startsWith(`${appId}.`))
    .reduce((state, e, i) => reduce(state, toAppLogEvent(e, appId, i + 1, recordedAt)), initial());

export const projectQuiz = (events: ProjectedEvent[], recordedAt: string): QuizState =>
  foldApp('quiz', events, initialQuizState, reduceQuiz, recordedAt);
export const projectLottery = (events: ProjectedEvent[], recordedAt: string): LotteryState =>
  foldApp('lottery', events, initialLotteryState, reduceLottery, recordedAt);

// Статус комнаты — из lifecycle-событий лога (REQ-RT-010); последнее побеждает.
export const deriveRoomStatus = (events: ProjectedEvent[]): RoomStatus => {
  let status: RoomStatus = 'DRAFT';
  for (const e of events) {
    if (e.type === coreEventType('room.activated')) status = 'ACTIVE';
    else if (e.type === coreEventType('room.completed')) status = 'COMPLETED';
    else if (e.type === coreEventType('room.cancelled')) status = 'CANCELLED';
  }
  return status;
};
```

```ts
// roster-refetch.ts — join не эмитит событий: ростер рефетчим на subscribe и на
// событиях, где имена показываются (Review Focus 2).
const ROSTER_REFETCH_EVENTS = new Set(['quiz.question.revealed', 'quiz.game.finished', 'lottery.draw.completed']);
export const shouldRefetchRoster = (type: string): boolean => ROSTER_REFETCH_EVENTS.has(type);
```

golden-фикстура (`fixtures/quiz-log.fixture.ts`): рукописный массив `ProjectedEvent[]` мини-игры (2 вопроса, 2 игрока: open→submit→close→reveal ×2 → finish) и спек `projections.spec.ts`:

```ts
it('golden: фолд записанного лога ≡ ожидаемая проекция (порядок/адаптер, не редьюсер)')
// assert: currentQuestion, accepting, totals по actorId, finished; recordedAt фиксированной строкой
it('фильтр по appId: события lottery/core не попадают в quiz-проекцию')
it('deriveRoomStatus: пусто → DRAFT; activated → ACTIVE; completed позже → COMPLETED')
```

- [ ] **Step 4: Run green**, lint/typecheck

- [ ] **Step 5: Commit** — `feat(web): LogStore (buffer/перефолд) + проекции через редьюсеры app-пакетов + golden-фикстура`

---

## Батч C — сессия, участник, экран

