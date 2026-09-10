import { RoomSerializer } from './room-serializer';

// RoomSerializer — per-room очередь диспетчей (design §7.3): два конкурентных
// publish одной комнаты не должны читать одну проекцию до коммита друг друга
// (double-answer гонка). Разные комнаты друг друга не ждут.
describe('RoomSerializer', () => {
  it('serializes 50 concurrent runs of one room: counter is exactly 50, entry order is FIFO', async () => {
    const serializer = new RoomSerializer();
    let counter = 0;
    const entryOrder: number[] = [];

    const runs = Array.from({ length: 50 }, (_, i) =>
      serializer.run('room-1', async () => {
        entryOrder.push(i);
        // read-modify-write с искусственной задержкой: без сериализации счётчик
        // недосчитался бы (гонка snapshot/increment через setImmediate).
        const snapshot = counter;
        await new Promise((r) => setImmediate(r));
        counter = snapshot + 1;
        return i;
      }),
    );
    const results = await Promise.all(runs);

    expect(counter).toBe(50);
    expect(entryOrder).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(results).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it('does not block runs of different rooms (temporal overlap)', async () => {
    const serializer = new RoomSerializer();
    const events: string[] = [];
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => (releaseA = resolve));

    const a = serializer.run('room-a', async () => {
      events.push('a:start');
      await gateA;
      events.push('a:end');
    });
    const b = serializer.run('room-b', async () => {
      events.push('b:start');
    });

    await b;
    // b завершился, пока a ещё держит gate — room-b не ждал room-a.
    expect(events).toEqual(['a:start', 'b:start']);
    releaseA();
    await a;
    expect(events).toEqual(['a:start', 'b:start', 'a:end']);
  });

  it('a rejecting link does not break the chain: the next run still executes', async () => {
    const serializer = new RoomSerializer();

    const first = serializer.run('room-1', () => Promise.reject(new Error('boom')));
    const second = serializer.run('room-1', async () => 'ok');

    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe('ok');
  });

  it('drops the map entry after the tail settles (map returns to size 0)', async () => {
    const serializer = new RoomSerializer();
    const tails = (): Map<string, Promise<unknown>> =>
      (serializer as unknown as { tails: Map<string, Promise<unknown>> }).tails;

    const run = serializer.run('room-1', async () => 1);
    expect(tails().size).toBe(1);
    await run;
    // Маркер удаляется в then-колбэке после settle звена — дожидаемся макротаски.
    await new Promise((r) => setImmediate(r));
    expect(tails().size).toBe(0);
  });
});
