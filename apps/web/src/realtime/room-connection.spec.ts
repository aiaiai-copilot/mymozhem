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
  private readonly connectErrorCbs: Array<(err: Error) => void> = [];
  private readonly disconnectCbs: Array<() => void> = [];
  private readonly eventCbs: Array<(payload: unknown) => void> = [];
  disconnected = false;
  // Состояние соединения и счётчик киков — для wakeUp (находка №8).
  connected = false;
  kickCount = 0;

  programAck(event: string, ack: unknown): void {
    const queue = this.ackQueue.get(event) ?? [];
    queue.push(ack);
    this.ackQueue.set(event, queue);
  }

  onConnect(cb: () => void): void {
    this.connectCbs.push(cb);
  }
  onConnectError(cb: (err: Error) => void): void {
    this.connectErrorCbs.push(cb);
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
  isConnected(): boolean {
    return this.connected;
  }
  kickReconnect(): void {
    this.kickCount += 1;
  }

  triggerConnect(): void {
    // Инвариант connected держит сам фейк (Minor-3 таск-ревью батча D);
    // wakeUp-тесты ставят поле вручную, потому что triggerConnect после join
    // дёргает re-subscribe и потребовал бы запрограммированный ack.
    this.connected = true;
    this.connectCbs.forEach((cb) => cb());
  }
  triggerConnectError(err: Error = new Error('SESSION_INVALID')): void {
    this.connectErrorCbs.forEach((cb) => cb(err));
  }
  triggerDisconnect(): void {
    this.connected = false;
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

  it('re-subscribe при reconnect упал (error-ack) → явный "disconnected", а не тихий мёртвый "live"', async () => {
    const socket = new FakeSocket();
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { ok: true, snapshot: SNAPSHOT });
    const conn = new RoomConnection(socket, ROOM_ID);
    const states: ConnectionState[] = [];
    conn.onStateChange((s) => states.push(s));
    await conn.join();

    // Gateway при ошибке subscribe зачищает серверную подписку (registry.remove +
    // socket.leave), но соединение НЕ разрывает: без явного состояния клиент
    // навсегда остался бы "мёртвым live" с unhandled rejection.
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { code: 'INTERNAL_ERROR' });
    const resynced: RoomSnapshot[] = [];
    conn.onResync((s) => resynced.push(s));

    socket.triggerConnect();
    await flushMicrotasks();

    expect(states).toEqual(['live', 'live', 'disconnected']);
    expect(resynced).toEqual([]);
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

  it('успешный refresh после connect_error → немедленный кик reconnect (CONNECT_ERROR — терминальный teardown)', async () => {
    const socket = new FakeSocket();
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { ok: true, snapshot: SNAPSHOT });
    const conn = new RoomConnection(socket, ROOM_ID, () => Promise.resolve());
    await conn.join();
    socket.connected = false;

    // Auth-отказ handshake — терминален для socket.io (4.8.3): CONNECT_ERROR →
    // Socket.destroy() → Manager._close(skipReconnect=true) — retry НЕ
    // планируется никогда (находка №8: «refresh 200 → тишина»). После успешного
    // refresh клиент обязан перезапустить соединение сам — официальный паттерн.
    socket.triggerConnectError();
    await flushMicrotasks();

    expect(socket.kickCount).toBe(1);
  });

  it('connect_error после join → ровно один refresh на стрик обрыва (не на каждый retry)', async () => {
    const socket = new FakeSocket();
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { ok: true, snapshot: SNAPSHOT });
    let refreshes = 0;
    const conn = new RoomConnection(socket, ROOM_ID, () => {
      refreshes += 1;
      return Promise.resolve();
    });
    await conn.join();

    // Обрыв + протухший за сон access-токен: каждый handshake-отказ серии
    // (SESSION_INVALID) приходит в connect_error — refresh обязан уйти один
    // раз на стрик, иначе retry-шторм превратился бы в refresh-шторм.
    socket.triggerDisconnect();
    socket.triggerConnectError();
    socket.triggerConnectError();
    socket.triggerConnectError();
    await flushMicrotasks();
    expect(refreshes).toBe(1);
  });

  it('успешный reconnect закрывает стрик: новая серия connect_error снова тянет refresh', async () => {
    const socket = new FakeSocket();
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { ok: true, snapshot: SNAPSHOT });
    let refreshes = 0;
    const conn = new RoomConnection(socket, ROOM_ID, () => {
      refreshes += 1;
      return Promise.resolve();
    });
    await conn.join();

    socket.triggerDisconnect();
    socket.triggerConnectError();
    await flushMicrotasks();
    expect(refreshes).toBe(1);

    // Refresh успел обновить токен → очередной retry handshake прошёл.
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { ok: true, snapshot: SNAPSHOT });
    socket.triggerConnect();
    await flushMicrotasks();

    socket.triggerDisconnect();
    socket.triggerConnectError();
    await flushMicrotasks();
    expect(refreshes).toBe(2);
  });

  it('connect_error до join (первый handshake) — refresh не вызывается', async () => {
    const socket = new FakeSocket();
    let refreshes = 0;
    new RoomConnection(socket, ROOM_ID, () => {
      refreshes += 1;
      return Promise.resolve();
    });

    socket.triggerConnectError();
    await flushMicrotasks();

    expect(refreshes).toBe(0);
  });

  it('упавший refresh (мёртвая refresh-кука) → явный "disconnected", повторных попыток нет', async () => {
    const socket = new FakeSocket();
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { ok: true, snapshot: SNAPSHOT });
    let refreshes = 0;
    const conn = new RoomConnection(socket, ROOM_ID, () => {
      refreshes += 1;
      return Promise.reject(new Error('refresh cookie expired'));
    });
    const states: ConnectionState[] = [];
    conn.onStateChange((s) => states.push(s));
    await conn.join();

    socket.triggerDisconnect();
    socket.triggerConnectError();
    socket.triggerConnectError();
    await flushMicrotasks();

    expect(refreshes).toBe(1);
    // Провал refresh — мёртвая refresh-кука: кик бессмысленен (токен не
    // обновлён), перезаход drives onSessionDead-путь страницы.
    expect(socket.kickCount).toBe(0);
    // 'disconnected' от самого обрыва + явный 'disconnected' после провала refresh
    // (тот же контракт, что у упавшего re-subscribe): retry — забота потребителя.
    expect(states).toEqual(['live', 'disconnected', 'disconnected']);
  });

  it('провал refresh-хука → onSessionDead + состояние disconnected (находка №5)', async () => {
    const socket = new FakeSocket();
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { ok: true, snapshot: SNAPSHOT });
    let sessionDead = 0;
    const states: ConnectionState[] = [];
    const conn = new RoomConnection(
      socket,
      ROOM_ID,
      () => Promise.reject(new Error('refresh cookie dead')),
      () => {
        sessionDead += 1;
      },
    );
    conn.onStateChange((s) => states.push(s));

    socket.triggerConnect();
    await conn.join();
    socket.triggerDisconnect();
    socket.triggerConnectError();

    await flushMicrotasks();

    expect(sessionDead).toBe(1);
    expect(states[states.length - 1]).toBe('disconnected');
  });

  it('обычный disconnect (сеть) → onSessionDead НЕ стреляет (Review Focus 5)', async () => {
    const socket = new FakeSocket();
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { ok: true, snapshot: SNAPSHOT });
    let sessionDead = 0;
    const conn = new RoomConnection(socket, ROOM_ID, undefined, () => {
      sessionDead += 1;
    });

    socket.triggerConnect();
    await conn.join();
    socket.triggerDisconnect();
    await flushMicrotasks();

    expect(sessionDead).toBe(0);
  });

  it('без refresh-хука connect_error — no-op: ни состояния, ни исключений', async () => {
    const socket = new FakeSocket();
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { ok: true, snapshot: SNAPSHOT });
    const conn = new RoomConnection(socket, ROOM_ID);
    const states: ConnectionState[] = [];
    conn.onStateChange((s) => states.push(s));
    await conn.join();

    socket.triggerConnectError();
    await flushMicrotasks();

    expect(states).toEqual(['live']);
  });

  // wakeUp (находка №8): WebKit выбрасывает backoff-таймер socket.io из
  // замороженной вкладки — Manager застревает (_reconnecting=true, таймера нет,
  // все внутренние retry заперты). Кик — явный перезапуск по сигналу пробуждения.
  it('wakeUp после join при мёртвом соединении — kick reconnect', async () => {
    const socket = new FakeSocket();
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { ok: true, snapshot: SNAPSHOT });
    const conn = new RoomConnection(socket, ROOM_ID);
    await conn.join();
    socket.connected = false;

    conn.wakeUp();
    expect(socket.kickCount).toBe(1);

    // Каждое пробуждение — свежий кик; дедуп парных DOM-событий — забота
    // вызывающего (createFocusRefetcher в useRoomBinding).
    conn.wakeUp();
    expect(socket.kickCount).toBe(2);
  });

  it('wakeUp при живом соединении — no-op (кик идемпотентен)', async () => {
    const socket = new FakeSocket();
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { ok: true, snapshot: SNAPSHOT });
    const conn = new RoomConnection(socket, ROOM_ID);
    await conn.join();
    socket.connected = true;

    conn.wakeUp();
    expect(socket.kickCount).toBe(0);
  });

  it('wakeUp до join — no-op: начальным подключением управляет сам socket.io', () => {
    const socket = new FakeSocket();
    const conn = new RoomConnection(socket, ROOM_ID);
    socket.connected = false;

    conn.wakeUp();
    expect(socket.kickCount).toBe(0);
  });
});
