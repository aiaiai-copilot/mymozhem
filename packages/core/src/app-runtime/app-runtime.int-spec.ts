import type { AppManifest, AppRuntimeModule, AppHostContext, AppLogEvent, AppCommit } from '@mymozhem/sdk';
import { AppRejection, ContractError } from '@mymozhem/sdk';
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import { readRoomLog } from '../testing/read-room-log';
import { TEST_CONFIG } from '../testing/test-config';
import { AppRegistryService } from '../app-registry/app-registry.service';
import { MembershipService } from '../membership/membership.service';
import { JoinRateLimiter } from '../membership/join-rate-limiter';
import { IdentityService } from '../identity/identity.service';
import { RoomService } from '../room/room.service';
import { EventLogService } from '../realtime/event-log.service';
import { EventEmitLimiter } from '../realtime/event-emit-limiter';
import { RealtimeBus } from '../realtime/realtime-bus';
import { EventOutbox } from '../realtime/event-outbox';
import { EventPayloadInvalidError, RoomNotActiveError } from '../realtime/realtime.errors';
import { AppRuntimeService } from './app-runtime.service';
import { AppProjectionCache } from './app-projection-cache';
import { PublishForbiddenError, AppModuleUnavailableError } from './app-runtime.errors';

const ORG = '00000000-0000-0000-0000-000000000001';
const P1 = '00000000-0000-0000-0000-0000000000a1';
const P2 = '00000000-0000-0000-0000-0000000000b2';
const P3 = '00000000-0000-0000-0000-0000000000c3';
const SPEC = '00000000-0000-0000-0000-0000000000d4';
// 20 акторов для теста плотности (двойной ответ одного актора отклоняется модулем —
// каждому dispatch нужен свой актор).
const racerId = (i: number) => `00000000-0000-0000-0000-00000000ac${i.toString(16).padStart(2, '0')}`;

// Фикстурный манифест (design §7): note.posted и secret.recorded — клиентские
// команды (clientInitiated: true); note.echoed — производный тип (public,
// clientInitiated: false), клиенту закрыт гейтом диспетчера.
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
      clientInitiated: true,
    },
    'secret.recorded': {
      schema: {
        type: 'object',
        properties: { n: { type: 'number' } },
        required: ['n'],
        additionalProperties: false,
      },
      visibility: 'module-private',
      clientInitiated: true,
    },
    'note.echoed': {
      schema: {
        type: 'object',
        properties: { n: { type: 'number' } },
        required: ['n'],
        additionalProperties: false,
      },
      visibility: 'public',
      clientInitiated: false,
    },
  },
};

// Вторая версия манифеста — для теста «пин на версию без зарегистрированного
// рантайм-модуля» (реестр знает манифест, диспетчер модуль — нет).
const TEST_APP_V2: AppManifest = { ...TEST_APP, manifestVersion: 2 };

interface TestState {
  sum: number;
  answered: ReadonlySet<string>;
}

// Фикстурный рантайм-модуль: note.posted коммитит вход как есть (actor: publisher)
// и доизлучает note.echoed (actor: server, payload { n: вдвое }); secret.recorded
// коммитит как есть. reduce считает сумму n по note.posted — для replay-теста.
// Повторный note.posted того же актора отклоняется (ALREADY_ANSWERED) — состояние
// из reduce, прецедент double-answer гонки design §7.3.
class TestAppRuntime implements AppRuntimeModule<TestState> {
  readonly appId = 'test-app';
  readonly manifestVersion = 1;
  readonly manifest = TEST_APP;
  // Состояния, которые модуль наблюдал в handlePublish — шпион для replay-теста.
  readonly observedSums: number[] = [];

  initialState(): TestState {
    return { sum: 0, answered: new Set<string>() };
  }

  reduce(state: TestState, event: AppLogEvent): TestState {
    if (event.shortName === 'note.posted') {
      return {
        sum: state.sum + (event.payload.n as number),
        answered: new Set(state.answered).add(event.actorId ?? 'server'),
      };
    }
    return state;
  }

  handlePublish(
    ctx: AppHostContext<TestState>,
    shortName: string,
    payload: Record<string, unknown>,
  ): AppCommit[] {
    this.observedSums.push(ctx.state.sum);
    if (shortName === 'note.posted') {
      if (ctx.state.answered.has(ctx.actorId)) {
        throw new AppRejection('ALREADY_ANSWERED', `actor ${ctx.actorId} already posted a note`);
      }
      return [
        { shortName: 'note.posted', payload, visibility: 'public', actor: 'publisher' },
        { shortName: 'note.echoed', payload: { n: (payload.n as number) * 2 }, visibility: 'public', actor: 'server' },
      ];
    }
    if (shortName === 'secret.recorded') {
      return [{ shortName: 'secret.recorded', payload, visibility: 'module-private', actor: 'publisher' }];
    }
    return [];
  }
}

describe('AppRuntimeService (командный хост, design 2026-09-09 §2)', () => {
  let db: TestDb;
  let rooms: RoomService;
  let bus: RealtimeBus;
  let membership: MembershipService;
  let registry: AppRegistryService;
  let eventLog: EventLogService;
  let outbox: EventOutbox;
  let testModule: TestAppRuntime;
  let runtime: AppRuntimeService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    await seedIdentity(db.prisma, { id: P1, kind: 'GUEST' });
    await seedIdentity(db.prisma, { id: P2, kind: 'GUEST' });
    await seedIdentity(db.prisma, { id: P3, kind: 'GUEST' });
    await seedIdentity(db.prisma, { id: SPEC, kind: 'GUEST' });
    for (let i = 0; i < 20; i++) {
      await seedIdentity(db.prisma, { id: racerId(i), kind: 'GUEST' });
    }
    registry = new AppRegistryService([TEST_APP, TEST_APP_V2]);
    bus = new RealtimeBus();
    outbox = new EventOutbox(db.prisma, bus);
    eventLog = new EventLogService(registry, new EventEmitLimiter(1000), TEST_CONFIG, outbox);
    membership = new MembershipService(
      db.prisma,
      new IdentityService(db.prisma),
      new JoinRateLimiter(1000),
      TEST_CONFIG,
    );
    rooms = new RoomService(db.prisma, eventLog, outbox, registry, membership, TEST_CONFIG);
  }, 120000);

  beforeEach(() => {
    // Свежий модуль и кэш на тест: observedSums — шпион, кэш не должен перетекать
    // между тестами (комнаты пересоздаются, roomId свежие — но дешевле гарантировать).
    testModule = new TestAppRuntime();
    runtime = new AppRuntimeService(
      db.prisma,
      membership,
      registry,
      eventLog,
      outbox,
      new AppProjectionCache(),
      [testModule],
    );
  });

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  async function activeRoom(manifestVersion = 1) {
    const room = await rooms.create(ORG);
    await rooms.configure(room.id, {
      appId: 'test-app',
      manifestVersion,
      settings: { label: 'live' },
    });
    return rooms.activate(room.id);
  }

  async function join(roomId: string, identityId: string, role: 'PARTICIPANT' | 'SPECTATOR' = 'PARTICIPANT') {
    await db.prisma.membership.create({ data: { roomId, identityId, role } });
  }

  const dispatch = (roomId: string, actorId: string, shortName: string, payload: Record<string, unknown>) =>
    runtime.dispatch({ roomId, actorId, appId: 'test-app', shortName, payload });

  const appEventsOf = async (roomId: string) =>
    (await readRoomLog(db.prisma, roomId)).filter((e) => e.type.startsWith('test-app.'));

  it('1. commit-цепочка: note.posted → posted (actor=P1) + echoed (actor=null) подряд, оба доставлены в bus', async () => {
    const room = await activeRoom();
    await join(room.id, P1);
    const delivered: { type: string; actorId: string | null }[] = [];
    bus.subscribe((events) => delivered.push(...events.map((e) => ({ type: e.type, actorId: e.actorId }))));

    await dispatch(room.id, P1, 'note.posted', { n: 1 });

    const appEvents = await appEventsOf(room.id);
    expect(appEvents.map((e) => [e.type, e.actorId])).toEqual([
      ['test-app.note.posted', P1],
      ['test-app.note.echoed', null],
    ]);
    // Два события подряд: seq смежные относительно baseline первого app-события
    // (в логе уже есть lifecycle core.room.activated).
    expect(appEvents[1].seq).toBe(appEvents[0].seq + 1);
    expect(delivered).toEqual([
      { type: 'test-app.note.posted', actorId: P1 },
      { type: 'test-app.note.echoed', actorId: null },
    ]);
  });

  it('2. SPECTATOR не может publish: rejects PUBLISH_FORBIDDEN, app-событий в логе нет', async () => {
    const room = await activeRoom();
    await join(room.id, SPEC, 'SPECTATOR');

    const err = await dispatch(room.id, SPEC, 'note.posted', { n: 1 }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PublishForbiddenError);
    expect((err as ContractError).code).toBe('PUBLISH_FORBIDDEN');
    expect(await appEventsOf(room.id)).toHaveLength(0);
  });

  it('3. производный тип от клиента: note.echoed → PUBLISH_FORBIDDEN', async () => {
    const room = await activeRoom();
    await join(room.id, P1);

    const err = await dispatch(room.id, P1, 'note.echoed', { n: 2 }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PublishForbiddenError);
    expect((err as ContractError).code).toBe('PUBLISH_FORBIDDEN');
    expect(await appEventsOf(room.id)).toHaveLength(0);
  });

  it('4. пин на версию без рантайм-модуля → MODULE_UNAVAILABLE (fail-closed)', async () => {
    const room = await activeRoom(2); // манифест test-app@2 в реестре есть, модуля — нет
    await join(room.id, P1);

    const err = await dispatch(room.id, P1, 'note.posted', { n: 1 }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppModuleUnavailableError);
    expect((err as ContractError).code).toBe('MODULE_UNAVAILABLE');
    expect(await appEventsOf(room.id)).toHaveLength(0);
  });

  it('5a. тип вне манифеста → EVENT_UNKNOWN_TYPE', async () => {
    const room = await activeRoom();
    await join(room.id, P1);

    const err = await dispatch(room.id, P1, 'note.v2', { n: 1 }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ContractError);
    expect((err as ContractError).code).toBe('EVENT_UNKNOWN_TYPE');
  });

  it('5b. невалидный payload → EVENT_PAYLOAD_INVALID (схема до вызова модуля)', async () => {
    const room = await activeRoom();
    await join(room.id, P1);

    const err = await dispatch(room.id, P1, 'note.posted', { blob: 1 }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(EventPayloadInvalidError);
    expect((err as EventPayloadInvalidError).code).toBe('EVENT_PAYLOAD_INVALID');
    expect(testModule.observedSums).toHaveLength(0); // модуль не вызывался
  });

  it('5c. не-ACTIVE комната → RoomNotActiveError (wire: ROOM_LOG_SEALED)', async () => {
    const room = await rooms.create(ORG);
    await rooms.configure(room.id, {
      appId: 'test-app',
      manifestVersion: 1,
      settings: { label: 'live' },
    });
    await join(room.id, P1);

    const err = await dispatch(room.id, P1, 'note.posted', { n: 1 }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RoomNotActiveError);
    // Core-код ROOM_NOT_ACTIVE; на границе error-mapping переводит в ROOM_LOG_SEALED.
    expect((err as RoomNotActiveError).code).toBe('ROOM_NOT_ACTIVE');
    expect(await appEventsOf(room.id)).toHaveLength(0);
  });

  it('5d. не-член комнаты → ACTOR_NOT_MEMBER', async () => {
    const room = await activeRoom();

    const err = await dispatch(room.id, P2, 'note.posted', { n: 1 }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ContractError);
    expect((err as ContractError).code).toBe('ACTOR_NOT_MEMBER');
    expect(await appEventsOf(room.id)).toHaveLength(0);
  });

  it('6. отказ модуля до коммита: второй note.posted того же актора → ALREADY_ANSWERED, в логе ровно одно posted', async () => {
    const room = await activeRoom();
    await join(room.id, P1);

    await dispatch(room.id, P1, 'note.posted', { n: 1 });
    const err = await dispatch(room.id, P1, 'note.posted', { n: 2 }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppRejection);
    expect((err as ContractError).code).toBe('ALREADY_ANSWERED');
    const appEvents = await appEventsOf(room.id);
    expect(appEvents.filter((e) => e.type === 'test-app.note.posted')).toHaveLength(1);
  });

  it('7. конкурентный double-submit одного актора: ровно один успех, одно posted в логе', async () => {
    const room = await activeRoom();
    await join(room.id, P1);

    const results = await Promise.allSettled([
      dispatch(room.id, P1, 'note.posted', { n: 1 }),
      dispatch(room.id, P1, 'note.posted', { n: 1 }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejection = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejection.reason as ContractError).code).toBe('ALREADY_ANSWERED');
    const appEvents = await appEventsOf(room.id);
    expect(appEvents.filter((e) => e.type === 'test-app.note.posted')).toHaveLength(1);
  });

  it('8. REQ-RT-007 на app-пути: 20 конкурентных dispatch со смешанным размером payload — все закоммичены, seq плотные', async () => {
    const room = await activeRoom();
    for (let i = 0; i < 20; i++) {
      await join(room.id, racerId(i));
    }
    const big = (i: number) => ({ n: i, blob: 'x'.repeat(4096) });
    const small = (i: number) => ({ n: i });

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        dispatch(room.id, racerId(i), 'note.posted', i % 2 === 0 ? big(i) : small(i)),
      ),
    );

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const appEvents = await appEventsOf(room.id);
    const posted = appEvents.filter((e) => e.type === 'test-app.note.posted');
    expect(posted).toHaveLength(20);
    // 20 dispatch × (posted + echoed) = 40 app-событий; seq плотные относительно
    // baseline первого app-события (до него в логе lifecycle core.room.activated).
    const baseline = appEvents[0].seq;
    expect(appEvents.map((e) => e.seq)).toEqual(
      Array.from({ length: 40 }, (_, i) => baseline + i),
    );
    // Порядок не коррелирует с размером: seq больших payload — не префикс и не
    // суффикс диапазона posted-событий.
    const bigSeqs = new Set(
      posted
        .filter((e) => (e.payload as { blob?: string }).blob !== undefined)
        .map((e) => e.seq),
    );
    expect(bigSeqs.size).toBe(10);
    const postedSeqs = posted.map((e) => e.seq);
    const firstTen = new Set(postedSeqs.slice(0, 10));
    const lastTen = new Set(postedSeqs.slice(-10));
    expect(bigSeqs).not.toEqual(firstTen);
    expect(bigSeqs).not.toEqual(lastTen);
  });

  it('9. replay: после invalidateProjection модуль видит state, восстановленный редукцией лога', async () => {
    const room = await activeRoom();
    await join(room.id, P1);
    await join(room.id, P2);
    await join(room.id, P3);

    await dispatch(room.id, P1, 'note.posted', { n: 1 });
    await dispatch(room.id, P2, 'note.posted', { n: 2 });
    // Тёплый путь: модуль видел суммы 0, затем 1 (fold закоммиченных).
    expect(testModule.observedSums).toEqual([0, 1]);

    runtime.invalidateProjection(room.id);
    await dispatch(room.id, P3, 'note.posted', { n: 4 });

    // Холодный промах: состояние пересоздано replay'ем лога — модуль увидел
    // сумму прежних n (1 + 2 = 3), а не initialState и не утечку тёплого кэша.
    expect(testModule.observedSums).toEqual([0, 1, 3]);
  });
});
