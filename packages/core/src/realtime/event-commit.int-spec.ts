import type { AppManifest } from '@mymozhem/sdk';
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import { readRoomLog } from '../testing/read-room-log';
import { TEST_CONFIG } from '../testing/test-config';
import { AppRegistryService } from '../app-registry/app-registry.service';
import { MembershipService } from '../membership/membership.service';
import { JoinRateLimiter } from '../membership/join-rate-limiter';
import { IdentityService } from '../identity/identity.service';
import { RoomService } from '../room/room.service';
import { EventLogService } from './event-log.service';
import { EventEmitLimiter } from './event-emit-limiter';
import {
  ActorNotMemberError,
  EventEmitRateLimitedError,
  EventPayloadInvalidError,
  EventPayloadTooLargeError,
  EventTypeUnknownError,
  EventVisibilityExceededError,
  RoomNotActiveError,
} from './realtime.errors';

const ORG = '00000000-0000-0000-0000-000000000001';
const P1 = '00000000-0000-0000-0000-0000000000a1';
const P2 = '00000000-0000-0000-0000-0000000000b2';

// Фикстурный манифест (design §7): открытая схема note.posted — нужна для
// payload-нейтральности (Task 7); secret.recorded — потолок module-private.
const TEST_APP: AppManifest = {
  appId: 'test-app',
  manifestVersion: 1,
  contractRange: '^1.0.0',
  appSettings: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: { label: { type: 'string' } },
  },
  events: {
    'note.posted': {
      schema: {
        type: 'object',
        properties: { n: { type: 'number' }, blob: { type: 'string' } },
        required: ['n'],
        additionalProperties: true,
      },
      visibility: 'public',
    },
    'secret.recorded': {
      schema: {
        type: 'object',
        properties: { n: { type: 'number' } },
        required: ['n'],
        additionalProperties: false,
      },
      visibility: 'module-private',
    },
  },
};

describe('EventLogService.commitAppEvent', () => {
  let db: TestDb;
  let rooms: RoomService;
  let eventLog: EventLogService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    await seedIdentity(db.prisma, { id: P1, kind: 'GUEST' });
    await seedIdentity(db.prisma, { id: P2, kind: 'GUEST' });
    const registry = new AppRegistryService([TEST_APP]);
    eventLog = new EventLogService(registry, new EventEmitLimiter(1000), TEST_CONFIG);
    rooms = new RoomService(
      db.prisma,
      eventLog,
      registry,
      new MembershipService(
        db.prisma,
        new IdentityService(db.prisma),
        new JoinRateLimiter(1000),
        TEST_CONFIG,
      ),
      TEST_CONFIG,
    );
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  const ACTIVE_SETTINGS = { label: 'live' };

  async function activeRoom() {
    const room = await rooms.create(ORG);
    await rooms.configure(room.id, {
      appId: 'test-app',
      manifestVersion: 1,
      settings: ACTIVE_SETTINGS,
    });
    return rooms.activate(room.id);
  }

  async function joinParticipant(roomId: string, identityId: string) {
    await db.prisma.membership.create({
      data: { roomId, identityId, role: 'PARTICIPANT' },
    });
  }

  it('commits an app event with contract shape after activation', async () => {
    const room = await activeRoom();
    await joinParticipant(room.id, P1);

    await db.prisma.$transaction((tx) =>
      eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', P1),
    );

    const log = await readRoomLog(db.prisma, room.id);
    expect(log).toHaveLength(2); // seq 1 — core.room.activated (пин)
    expect(log[1]).toMatchObject({
      seq: 2,
      type: 'test-app.note.posted',
      visibility: 'public',
      actorId: P1,
      payload: { n: 1 },
      schemaVersion: 1, // пиннутый manifestVersion
    });
  });

  it('rejects emission into a DRAFT room (ROOM_NOT_ACTIVE), nothing written', async () => {
    const room = await rooms.create(ORG);
    await rooms.configure(room.id, {
      appId: 'test-app',
      manifestVersion: 1,
      settings: ACTIVE_SETTINGS,
    });

    const err = await db.prisma
      .$transaction((tx) =>
        eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', null),
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RoomNotActiveError);
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(0);
  });

  it('seals the log in a terminal status (REQ-RT-016): cancel, then emit rejected', async () => {
    const room = await activeRoom();
    await rooms.cancel(room.id);

    const err = await db.prisma
      .$transaction((tx) =>
        eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', null),
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RoomNotActiveError);
    expect((err as RoomNotActiveError).code).toBe('ROOM_NOT_ACTIVE');
    // seq 1 activated, seq 2 cancelled — попытка эмита ничего не добавила
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(2);
  });

  it('rejects oversized payload (REQ-RT-012)', async () => {
    const room = await activeRoom();
    const big = { n: 1, blob: 'x'.repeat(TEST_CONFIG.MAX_EVENT_PAYLOAD_BYTES) };
    const err = await db.prisma
      .$transaction((tx) =>
        eventLog.commitAppEvent(tx, room.id, 'note.posted', big, 'public', null),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EventPayloadTooLargeError);
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(1);
  });

  it('rejects an undefined payload with the typed error (EVENT_PAYLOAD_INVALID)', async () => {
    // JSON.stringify(undefined) === undefined: без safe-stringify шаг размера падал
    // бы сырым TypeError из Buffer.byteLength вне typed-таксономии (design §6).
    const room = await activeRoom();
    const err = await db.prisma
      .$transaction((tx) =>
        eventLog.commitAppEvent(tx, room.id, 'note.posted', undefined, 'public', null),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EventPayloadInvalidError);
    expect((err as EventPayloadInvalidError).code).toBe('EVENT_PAYLOAD_INVALID');
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(1);
  });

  it('rejects a circular payload with the typed error (EVENT_PAYLOAD_INVALID)', async () => {
    // JSON.stringify бросает TypeError на циклической ссылке — маппим в typed error.
    const room = await activeRoom();
    const circular: Record<string, unknown> = { n: 1 };
    circular.self = circular;
    const err = await db.prisma
      .$transaction((tx) =>
        eventLog.commitAppEvent(tx, room.id, 'note.posted', circular, 'public', null),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EventPayloadInvalidError);
    expect((err as EventPayloadInvalidError).code).toBe('EVENT_PAYLOAD_INVALID');
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(1);
  });

  it('rejects an unknown event type (REQ-CTR-008)', async () => {
    const room = await activeRoom();
    const err = await db.prisma
      .$transaction((tx) =>
        eventLog.commitAppEvent(tx, room.id, 'note.v2', { n: 1 }, 'public', null),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EventTypeUnknownError);
  });

  it('rejects payload failing the registered schema (REQ-CTR-008)', async () => {
    const room = await activeRoom();
    const err = await db.prisma
      .$transaction((tx) =>
        eventLog.commitAppEvent(tx, room.id, 'note.posted', { blob: 1 }, 'public', null),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EventPayloadInvalidError);
    expect((err as EventPayloadInvalidError).code).toBe('EVENT_PAYLOAD_INVALID');
  });

  it('rejects visibility weaker than the declared ceiling (REQ-CTR-009)', async () => {
    const room = await activeRoom();
    await joinParticipant(room.id, P1);
    const err = await db.prisma
      .$transaction((tx) =>
        eventLog.commitAppEvent(tx, room.id, 'secret.recorded', { n: 1 }, 'organizer', P1),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EventVisibilityExceededError);
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(1);
  });

  it('allows visibility STRONGER than the ceiling (module-private under public)', async () => {
    const room = await activeRoom();
    await db.prisma.$transaction((tx) =>
      eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'module-private', null),
    );
    const log = await readRoomLog(db.prisma, room.id);
    expect(log[1]).toMatchObject({ visibility: 'module-private' });
  });

  it('rejects an actor without membership (ACTOR_NOT_MEMBER)', async () => {
    const room = await activeRoom();
    const err = await db.prisma
      .$transaction((tx) =>
        eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', P2),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ActorNotMemberError);
  });

  it('null actor (server emission): no membership gate, commits', async () => {
    const room = await activeRoom();
    await db.prisma.$transaction((tx) =>
      eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', null),
    );
    const log = await readRoomLog(db.prisma, room.id);
    expect(log[1]).toMatchObject({ actorId: null, seq: 2 });
  });
});

describe('EventLogService.commitAppEvent — rate limit (REQ-RT-014)', () => {
  let db: TestDb;
  let rooms: RoomService;
  let limitedLog: EventLogService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    await seedIdentity(db.prisma, { id: P1, kind: 'GUEST' });
    await seedIdentity(db.prisma, { id: P2, kind: 'GUEST' });
    const registry = new AppRegistryService([TEST_APP]);
    limitedLog = new EventLogService(registry, new EventEmitLimiter(3), TEST_CONFIG);
    rooms = new RoomService(
      db.prisma,
      limitedLog,
      registry,
      new MembershipService(
        db.prisma,
        new IdentityService(db.prisma),
        new JoinRateLimiter(1000),
        TEST_CONFIG,
      ),
      TEST_CONFIG,
    );
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  async function activeRoomWithP1P2() {
    const room = await rooms.create(ORG);
    await rooms.configure(room.id, { appId: 'test-app', manifestVersion: 1, settings: { label: 'x' } });
    await rooms.activate(room.id);
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' } });
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: P2, role: 'PARTICIPANT' } });
    return room;
  }

  it('4th attempt in the window is rejected; other actor and null actor unaffected', async () => {
    const room = await activeRoomWithP1P2();
    const emit = (actor: string | null) =>
      db.prisma.$transaction((tx) =>
        limitedLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', actor),
      );

    await emit(P1);
    await emit(P1);
    await emit(P1);
    const err = await emit(P1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EventEmitRateLimitedError);

    await emit(P2);   // другой actor — свой бюджет
    await emit(null); // серверная эмиссия — вне per-actor лимита

    const log = await readRoomLog(db.prisma, room.id);
    expect(log).toHaveLength(1 /* activated */ + 3 + 2);
  });

  it('failed attempts burn the budget too (attempts counted, not just successes)', async () => {
    const room = await activeRoomWithP1P2();
    // 3 попытки с невалидным payload (отказ по схеме — после шага лимитера)
    for (let i = 0; i < 3; i++) {
      const e = await db.prisma
        .$transaction((tx) =>
          limitedLog.commitAppEvent(tx, room.id, 'note.posted', { blob: 1 }, 'public', P1),
        )
        .catch((e: unknown) => e);
      expect(e).toBeInstanceOf(EventPayloadInvalidError);
    }
    const err = await db.prisma
      .$transaction((tx) =>
        limitedLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', P1),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EventEmitRateLimitedError);
  });
});

describe('EventLogService.commitAppEvent — concurrency (REQ-RT-007)', () => {
  let db: TestDb;
  let rooms: RoomService;
  let eventLog: EventLogService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    await seedIdentity(db.prisma, { id: P1, kind: 'GUEST' });
    await seedIdentity(db.prisma, { id: P2, kind: 'GUEST' });
    const registry = new AppRegistryService([TEST_APP]);
    eventLog = new EventLogService(registry, new EventEmitLimiter(1000), TEST_CONFIG);
    rooms = new RoomService(
      db.prisma,
      eventLog,
      registry,
      new MembershipService(
        db.prisma,
        new IdentityService(db.prisma),
        new JoinRateLimiter(1000),
        TEST_CONFIG,
      ),
      TEST_CONFIG,
    );
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  async function activeRoomWithP1P2() {
    const room = await rooms.create(ORG);
    await rooms.configure(room.id, { appId: 'test-app', manifestVersion: 1, settings: { label: 'x' } });
    await rooms.activate(room.id);
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' } });
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: P2, role: 'PARTICIPANT' } });
    return room;
  }

  it('serializes concurrent app commits: dense seqs after activation', async () => {
    const room = await activeRoomWithP1P2();
    const N = 8;

    const committed = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        db.prisma.$transaction((tx) =>
          eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: i }, 'public', P1),
        ),
      ),
    );

    // seq 1 — core.room.activated; app-события занимают ровно {2..N+1}.
    expect(new Set(committed.map((e) => e.seq))).toEqual(
      new Set(Array.from({ length: N }, (_, i) => i + 2)),
    );
    expect((await readRoomLog(db.prisma, room.id)).map((e) => e.seq)).toEqual(
      Array.from({ length: N + 1 }, (_, i) => i + 1),
    );
  });

  it('payload-neutrality: mixed-size races stay dense and all-valid', async () => {
    // Отложенный тест lifecycle-среза (§10). Принуждаемое свойство: валидация —
    // до lock (design §2), поэтому размер payload не меняет исход гонки — обе
    // записи валидны, seq плотные при любом порядке старта. Порядок захвата lock
    // black-box не наблюдаем; детерминированно проверяем контракт на смешанных
    // размерах с чередованием порядка старта.
    const room = await activeRoomWithP1P2();
    const ROUNDS = 20;
    const big = { n: 1, blob: 'x'.repeat(8000) }; // < MAX_EVENT_PAYLOAD_BYTES
    const small = { n: 2 };

    for (let round = 0; round < ROUNDS; round++) {
      const bigFirst = round % 2 === 0;
      const bigEmit = () =>
        db.prisma.$transaction((tx) =>
          eventLog.commitAppEvent(tx, room.id, 'note.posted', big, 'public', P1),
        );
      const smallEmit = () =>
        db.prisma.$transaction((tx) =>
          eventLog.commitAppEvent(tx, room.id, 'note.posted', small, 'public', P2),
        );
      // Чередуем порядок СТАРТА (создания промисов): bigFirst либо smallFirst.
      const first = bigFirst ? bigEmit : smallEmit;
      const second = bigFirst ? smallEmit : bigEmit;
      const [firstEv, secondEv] = await Promise.all([first(), second()]);
      expect(firstEv.seq).not.toBe(secondEv.seq);
      // Payload round-trip под гонкой: повреждённая запись (обрезанный/перепутанный
      // payload) должна провалить тест, а не пройти по одним seq.
      const bigEv = bigFirst ? firstEv : secondEv;
      const smallEv = bigFirst ? secondEv : firstEv;
      expect(bigEv.payload).toEqual(big);
      expect(smallEv.payload).toEqual(small);
    }

    const log = await readRoomLog(db.prisma, room.id);
    expect(log.map((e) => e.seq)).toEqual(Array.from({ length: 1 + ROUNDS * 2 }, (_, i) => i + 1));
    const appEvents = log.filter((e) => e.type === 'test-app.note.posted');
    expect(appEvents).toHaveLength(ROUNDS * 2);
    // Каждый big payload доехал до storage целиком.
    const bigEvents = appEvents.filter((e) => (e.payload as { blob?: string }).blob !== undefined);
    expect(bigEvents).toHaveLength(ROUNDS);
    for (const e of bigEvents) {
      expect((e.payload as { blob: string }).blob).toHaveLength(8000);
    }
  });

  it('rejects an emit that loses the race to a terminal transition (TOCTOU, REQ-RT-016)', async () => {
    // Детерминированная гонка без sleep'ов: держим advisory lock комнаты в сырой
    // транзакции на deferred; эмит проходит status-гейт по ACTIVE строке и встаёт
    // за lock; пока он ждёт, статус коммитится в CANCELLED напрямую SQL'ем (симулируем
    // закоммиченный терминальный переход — сознательно БЕЗ lock'а и БЕЗ log-события);
    // отпускаем lock. С post-lock re-check эмит обязан отказаться ROOM_NOT_ACTIVE,
    // и лог не должен ничего приобрести.
    const room = await activeRoomWithP1P2();

    let lockAcquired!: () => void;
    let releaseLock!: () => void;
    const acquired = new Promise<void>((resolve) => (lockAcquired = resolve));
    const released = new Promise<void>((resolve) => (releaseLock = resolve));
    const holdTx = db.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${room.id}, 0))`;
      lockAcquired();
      await released; // транзакция (и lock) открыты до сигнала
    });
    await acquired;

    // Эмит: status-гейт пройдёт по ACTIVE, дальше — блокировка на advisory lock.
    const emit = db.prisma
      .$transaction((tx) =>
        eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', P1),
      )
      .catch((e: unknown) => e);

    // Детерминированно ждём, пока эмит реально встанет в очередь за lock:
    // в pg_locks появляется не-granted advisory-запрос (condition-poll, не sleep).
    for (let i = 0; ; i++) {
      const rows = await db.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
      if (rows[0].n > 0) break;
      if (i > 1000) throw new Error('emit never queued on the room advisory lock');
      await new Promise((r) => setImmediate(r));
    }

    // Терминальный переход коммитится, пока эмит ждёт lock (статус пишется ДО lock'а
    // по конвенции порядка блокировок — здесь симулируем его закоммиченный результат).
    await db.prisma.$executeRaw`
      UPDATE room."Room" SET status = 'CANCELLED' WHERE id = ${room.id}::uuid`;

    releaseLock();
    await holdTx;

    const err = await emit;
    expect(err).toBeInstanceOf(RoomNotActiveError);
    expect((err as RoomNotActiveError).code).toBe('ROOM_NOT_ACTIVE');
    // Лог запечатан: попытка эмита после терминального перехода ничего не добавила
    // (seq 1 — core.room.activated).
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(1);
  });
});
