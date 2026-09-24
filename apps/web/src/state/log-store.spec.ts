import { describe, expect, it } from 'vitest';
import type { ProjectedEvent } from '@mymozhem/sdk';
import { LogStore } from './log-store';

// Фолд-модель клиента (дизайн §3): snapshot приходит по subscribe-ack, live-события
// текут параллельно. До snapshot live идёт в буфер (терять нельзя — событие могло
// попасть в лог до чтения snapshot'а), после — напрямую в хвост.
const ACTOR = '0f8fad5b-d9cb-469f-a165-70867728950e';

function ev(type: string, actorId: string | null = ACTOR): ProjectedEvent {
  return { type, payload: {}, actorId };
}

describe('LogStore', () => {
  it('buffers live events until snapshot; all() = snapshot + buffered + live', () => {
    const store = new LogStore();
    const buffered = ev('quiz.question.opened');

    store.pushLive(buffered);
    // До snapshot лог не отдаётся наружу: проекции фолдятся только после snapshot.
    expect(store.all()).toEqual([]);

    const snapshot = [ev('core.room.activated', null), ev('quiz.game.finished', null)];
    store.applySnapshot(snapshot);

    const live = ev('quiz.answer.submitted');
    store.pushLive(live);

    expect(store.all()).toEqual([...snapshot, buffered, live]);
  });

  it('duplicate from the handshake window is applied twice (accepted, design §3)', () => {
    const store = new LogStore();
    // Событие из окна handshake: пришло live до snapshot и попало в snapshot.
    // Wire без id/seq (REQ-RT-011a) — дуп структурно неотличим, дедупликации нет;
    // лечится re-subscribe → reset + полный перефолд. Пиним принятое поведение.
    const dup = ev('quiz.question.closed');

    store.pushLive(dup);
    store.applySnapshot([ev('core.room.activated', null), dup]);

    const occurrences = store.all().filter((e) => e.type === dup.type);
    expect(occurrences).toHaveLength(2);
  });

  it('reset() clears everything (re-subscribe path)', () => {
    const store = new LogStore();
    store.pushLive(ev('quiz.question.opened'));
    store.applySnapshot([ev('core.room.activated', null)]);
    store.pushLive(ev('quiz.answer.submitted'));

    store.reset();
    expect(store.all()).toEqual([]);

    // После reset стор снова в режиме «до snapshot»: live буферизуется,
    // applySnapshot открывает новый фолд — ровно путь re-subscribe.
    const buffered = ev('quiz.question.opened');
    store.pushLive(buffered);
    expect(store.all()).toEqual([]);

    const fresh = ev('core.room.activated', null);
    store.applySnapshot([fresh]);
    expect(store.all()).toEqual([fresh, buffered]);
  });
});
