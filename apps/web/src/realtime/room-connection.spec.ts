import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  REALTIME_MESSAGES,
  validProjectedEvents,
  type ProjectedEvent,
  type RoomSnapshot,
} from '@mymozhem/sdk';
import { ApiError } from '../api/api-error';
import { RoomConnection, type ConnectionState } from './room-connection';
import type { SocketLike } from './socket-like';

// Фейк транспорта: ack'и программируются очередью по имени сообщения,
// connect/disconnect/event триггерятся из теста — поведение сокета под контролем
// спеки, без таймеров и реальной сети.
class FakeSocket implements SocketLike {
  readonly calls: Array<{ event: string; payload: unknown }> = [];
  private readonly ackQueue = new Map<string, unknown[]>();
  private readonly connectCbs: Array<() => void> = [];
  private readonly disconnectCbs: Array<() => void> = [];
  private readonly eventCbs: Array<(payload: unknown) => void> = [];
  disconnected = false;

  programAck(event: string, ack: unknown): void {
    const queue = this.ackQueue.get(event) ?? [];
    queue.push(ack);
    this.ackQueue.set(event, queue);
  }

  onConnect(cb: () => void): void {
    this.connectCbs.push(cb);
  }
  onDisconnect(cb: () => void): void {
    this.disconnectCbs.push(cb);
  }
  onEvent(cb: (payload: unknown) => void): void {
    this.eventCbs.push(cb);
  }
  emitWithAck(event: string, payload: unknown): Promise<unknown> {
    this.calls.push({ event, payload });
    const ack = this.ackQueue.get(event)?.shift();
    if (ack === undefined) {
      throw new Error(`FakeSocket: нет запрограммированного ack для "${event}"`);
    }
    return Promise.resolve(ack);
  }
  disconnect(): void {
    this.disconnected = true;
  }

  triggerConnect(): void {
    this.connectCbs.forEach((cb) => cb());
  }
  triggerDisconnect(): void {
    this.disconnectCbs.forEach((cb) => cb());
  }
  triggerEvent(payload: unknown): void {
    this.eventCbs.forEach((cb) => cb(payload));
  }
}

// Re-subscribe на reconnect — fire-and-forget цепочка промисов; макротаск
// гарантированно сливает все микротаски перед ассертами.
const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const ROOM_ID = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT: RoomSnapshot = {
  events: [validProjectedEvents[0]],
  appSettings: { rounds: 3 },
};

describe('RoomConnection', () => {
  it('join: ok-ack → распарсенный snapshot; на провод ушёл subscribe с roomId', async () => {
    const socket = new FakeSocket();
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { ok: true, snapshot: SNAPSHOT });
    const conn = new RoomConnection(socket, ROOM_ID);

    const snapshot = await conn.join();

    expect(snapshot).toEqual(SNAPSHOT);
    expect(socket.calls).toEqual([
      { event: REALTIME_MESSAGES.SUBSCRIBE, payload: { roomId: ROOM_ID } },
    ]);
  });

  it('join: error-ack { code } → ApiError с серверным кодом (wire-уровень, статус 0)', async () => {
    const socket = new FakeSocket();
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { code: 'ACTOR_NOT_MEMBER' });
    const conn = new RoomConnection(socket, ROOM_ID);

    const err = await conn.join().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('ACTOR_NOT_MEMBER');
    expect((err as ApiError).status).toBe(0);
  });

  it('onEvent: payload парсится в ProjectedEvent; дрейф контракта → ZodError (fail-loud)', () => {
    const socket = new FakeSocket();
    const conn = new RoomConnection(socket, ROOM_ID);
    const received: ProjectedEvent[] = [];
    conn.onEvent((e) => received.push(e));

    socket.triggerEvent(validProjectedEvents[0]);
    expect(received).toEqual([validProjectedEvents[0]]);

    // Лишний ключ (seq из внутреннего конверта) — дрейф: громкое падение, не тихий strip.
    expect(() => socket.triggerEvent({ ...validProjectedEvents[0], seq: 42 })).toThrow(ZodError);
  });

  it('reconnect после join → re-subscribe → onResync со свежим snapshot (полный перефолд)', async () => {
    const socket = new FakeSocket();
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { ok: true, snapshot: SNAPSHOT });
    const conn = new RoomConnection(socket, ROOM_ID);
    await conn.join();

    const fresh: RoomSnapshot = { events: [...validProjectedEvents], appSettings: { rounds: 5 } };
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { ok: true, snapshot: fresh });
    const resynced: RoomSnapshot[] = [];
    conn.onResync((s) => resynced.push(s));

    socket.triggerConnect();
    await flushMicrotasks();

    expect(resynced).toEqual([fresh]);
    // Повторный subscribe ушёл тем же wire-сообщением с тем же roomId.
    expect(socket.calls).toHaveLength(2);
    expect(socket.calls[1]?.event).toBe(REALTIME_MESSAGES.SUBSCRIBE);
    expect(socket.calls[1]?.payload).toEqual({ roomId: ROOM_ID });
  });

  it('state: join → "live"; disconnect → "disconnected"; reconnect после join → "live"', async () => {
    const socket = new FakeSocket();
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { ok: true, snapshot: SNAPSHOT });
    const conn = new RoomConnection(socket, ROOM_ID);
    const states: ConnectionState[] = [];
    conn.onStateChange((s) => states.push(s));
    await conn.join();

    socket.triggerDisconnect();
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { ok: true, snapshot: SNAPSHOT });
    socket.triggerConnect();
    await flushMicrotasks();

    expect(states).toEqual(['live', 'disconnected', 'live']);
  });

  it('первый connect до join — no-op: состояние "connecting", subscribe не уходит', () => {
    const socket = new FakeSocket();
    const conn = new RoomConnection(socket, ROOM_ID);
    const states: ConnectionState[] = [];
    conn.onStateChange((s) => states.push(s));

    socket.triggerConnect();

    expect(states).toEqual(['connecting']);
    expect(socket.calls).toHaveLength(0);
  });

  it('publish: ok-ack → resolve; error-ack → ApiError с серверным кодом', async () => {
    const socket = new FakeSocket();
    const conn = new RoomConnection(socket, ROOM_ID);

    socket.programAck(REALTIME_MESSAGES.PUBLISH, { ok: true });
    await conn.publish('quiz.answer.submitted', { roundId: 'r1', choice: 2 });
    expect(socket.calls[0]).toEqual({
      event: REALTIME_MESSAGES.PUBLISH,
      payload: { type: 'quiz.answer.submitted', payload: { roundId: 'r1', choice: 2 } },
    });

    socket.programAck(REALTIME_MESSAGES.PUBLISH, { code: 'ROUND_NOT_OPEN' });
    const err = await conn.publish('quiz.answer.submitted', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('ROUND_NOT_OPEN');
    expect((err as ApiError).status).toBe(0);
  });
});
