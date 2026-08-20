import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import { TEST_CONFIG } from '../testing/test-config';
import { EventLogService } from '../realtime/event-log.service';
import { EventEmitLimiter } from '../realtime/event-emit-limiter';
import { RealtimeBus } from '../realtime/realtime-bus';
import { EventOutbox } from '../realtime/event-outbox';
import { AppRegistryService } from '../app-registry/app-registry.service';
import { RoomService } from '../room/room.service';
import { IdentityService } from '../identity/identity.service';
import { MembershipService } from './membership.service';
import { JoinRateLimiter } from './join-rate-limiter';
import {
  ActorNotMemberError,
  ActorNotOrganizerError,
  JoinRateLimitedError,
  RoomJoinDeniedError,
  RoomParticipantLimitReachedError,
  TargetNotExcludableError,
  TargetNotMemberError,
} from './membership.errors';
import { TokenService } from '../auth/token.service';

const ORG = '00000000-0000-0000-0000-000000000001';
const P1 = '00000000-0000-0000-0000-000000000002';
const IP = '203.0.113.7';
const IP2 = '198.51.100.9';

describe('MembershipService.join (REQ-ID-002/003/006/013)', () => {
  let db: TestDb;
  let roomService: RoomService;

  const makeMembership = (overrides: { participantLimit?: number; rateLimit?: number } = {}) =>
    new MembershipService(
      db.prisma,
      new IdentityService(db.prisma),
      new JoinRateLimiter(overrides.rateLimit ?? 1000),
      { ...TEST_CONFIG, ROOM_PARTICIPANT_LIMIT: overrides.participantLimit ?? TEST_CONFIG.ROOM_PARTICIPANT_LIMIT },
    );

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    await seedIdentity(db.prisma, { id: P1, email: 'p1@example.test' });
    const outbox = new EventOutbox(db.prisma, new RealtimeBus());
    roomService = new RoomService(
      db.prisma,
      new EventLogService(
        new AppRegistryService([]),
        new EventEmitLimiter(1000),
        TEST_CONFIG,
        outbox,
      ),
      outbox,
      new AppRegistryService([]),
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
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE membership."Membership", room."Room" CASCADE',
    );
  });

  it('joins a DRAFT room by code + name (REQ-ID-003)', async () => {
    const room = await roomService.create(ORG);
    const result = await makeMembership().join({ code: room.code, displayName: 'Саша', ip: IP });
    expect(result.identity.kind).toBe('GUEST');
    expect(result.identity.displayName).toBe('Саша');
    expect(result.membership.roomId).toBe(room.id);
    expect(result.membership.identityId).toBe(result.identity.id);
    expect(result.membership.role).toBe('PARTICIPANT');
  });

  it('stores joinIp on the membership row (REQ-ID-006 rejoin-блок)', async () => {
    const room = await roomService.create(ORG);
    const result = await makeMembership().join({ code: room.code, displayName: 'Саша', ip: IP });
    const row = await db.prisma.membership.findUnique({ where: { id: result.membership.id } });
    expect(row?.joinIp).toBe(IP);
  });

  it('findActiveMembership returns null for a soft-deleted membership (REQ-SEC-003)', async () => {
    const room = await roomService.create(ORG);
    const result = await makeMembership().join({ code: room.code, displayName: 'Саша', ip: IP });
    // Soft-delete напрямую клиентом: публичный путь (exclude) — Task 4.
    await db.prisma.membership.update({
      where: { id: result.membership.id },
      data: { deletedAt: new Date() },
    });
    await expect(makeMembership().findActiveMembership(room.id, result.identity.id)).resolves.toBeNull();
  });

  it('joins an ACTIVE room (late-join, ADR-005)', async () => {
    const room = await roomService.create(ORG);
    await db.prisma.room.update({ where: { id: room.id }, data: { status: 'ACTIVE' } });
    const result = await makeMembership().join({ code: room.code, displayName: 'A', ip: IP });
    expect(result.membership.role).toBe('PARTICIPANT');
  });

  it('rejects an invalid display name before any write', async () => {
    const room = await roomService.create(ORG);
    await expect(
      makeMembership().join({ code: room.code, displayName: '', ip: IP }),
    ).rejects.toThrow();
    // Только ORGANIZER-membership от create; гостевая запись не появилась.
    expect(await db.prisma.membership.count({ where: { roomId: room.id } })).toBe(1);
  });

  // REQ-ID-013 exit criterion: all branches below collapse into the same typed refusal.
  it.each([
    'unknown code',
    'registered policy',
    'invite_only policy',
    'COMPLETED room',
    'CANCELLED room',
    'soft-deleted room',
  ])('refuses %s with the same ROOM_JOIN_DENIED', async (scenario) => {
    const room = await roomService.create(ORG);
    let code = room.code;
    switch (scenario) {
      case 'unknown code':
        code = 'zzzzzzzz';
        break;
      case 'registered policy':
        await db.prisma.room.update({ where: { id: room.id }, data: { joinPolicy: 'REGISTERED' } });
        break;
      case 'invite_only policy':
        await db.prisma.room.update({ where: { id: room.id }, data: { joinPolicy: 'INVITE_ONLY' } });
        break;
      case 'COMPLETED room':
        await db.prisma.room.update({ where: { id: room.id }, data: { status: 'COMPLETED' } });
        break;
      case 'CANCELLED room':
        await db.prisma.room.update({ where: { id: room.id }, data: { status: 'CANCELLED' } });
        break;
      case 'soft-deleted room':
        await db.prisma.room.update({ where: { id: room.id }, data: { deletedAt: new Date() } });
        break;
    }
    const err = await makeMembership()
      .join({ code, displayName: 'A', ip: IP })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoomJoinDeniedError);
    expect((err as RoomJoinDeniedError).code).toBe('ROOM_JOIN_DENIED');
  });

  it('writes nothing on denial', async () => {
    const guestsBefore = await db.prisma.identity.count({ where: { kind: 'GUEST' } });
    await expect(
      makeMembership().join({ code: 'zzzzzzzz', displayName: 'A', ip: IP }),
    ).rejects.toThrow(RoomJoinDeniedError);
    expect(await db.prisma.identity.count({ where: { kind: 'GUEST' } })).toBe(guestsBefore);
    expect(await db.prisma.membership.count()).toBe(0);
  });

  it('refuses a join at the participant limit with ROOM_PARTICIPANT_LIMIT_REACHED', async () => {
    const room = await roomService.create(ORG);
    const service = makeMembership({ participantLimit: 1 });
    await service.join({ code: room.code, displayName: 'A', ip: IP });
    const err = await service
      .join({ code: room.code, displayName: 'B', ip: IP2 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoomParticipantLimitReachedError);
    expect((err as RoomParticipantLimitReachedError).code).toBe(
      'ROOM_PARTICIPANT_LIMIT_REACHED',
    );
  });

  it('does not count the ORGANIZER membership toward the participant limit', async () => {
    const room = await roomService.create(ORG); // создаёт ORGANIZER-membership
    const result = await makeMembership({ participantLimit: 1 }).join({
      code: room.code,
      displayName: 'A',
      ip: IP,
    });
    expect(result.membership.role).toBe('PARTICIPANT');
  });

  it('refuses the (limit+1)-th attempt from one IP with JOIN_RATE_LIMITED', async () => {
    const room = await roomService.create(ORG);
    const service = makeMembership({ rateLimit: 2 });
    await service.join({ code: room.code, displayName: 'A', ip: IP });
    await service.join({ code: room.code, displayName: 'B', ip: IP });
    const err = await service
      .join({ code: room.code, displayName: 'C', ip: IP })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JoinRateLimitedError);
    expect((err as JoinRateLimitedError).code).toBe('JOIN_RATE_LIMITED');
  });

  it('counts attempts BEFORE the room lookup (brute force accumulates)', async () => {
    const service = makeMembership({ rateLimit: 2 });
    await expect(service.join({ code: 'zzzzzzzz', displayName: 'A', ip: IP })).rejects.toThrow(
      RoomJoinDeniedError,
    );
    await expect(service.join({ code: 'yyyyyyyy', displayName: 'A', ip: IP })).rejects.toThrow(
      RoomJoinDeniedError,
    );
    const err = await service
      .join({ code: 'xxxxxxxx', displayName: 'A', ip: IP })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JoinRateLimitedError);
  });

  it('does not throttle other IPs', async () => {
    const room = await roomService.create(ORG);
    const service = makeMembership({ rateLimit: 1 });
    await service.join({ code: room.code, displayName: 'A', ip: IP });
    const other = await service.join({ code: room.code, displayName: 'B', ip: IP2 });
    expect(other.membership.role).toBe('PARTICIPANT');
  });

  describe('findActiveMembership', () => {
    it('returns the membership of a live member in a live room', async () => {
      const room = await roomService.create(ORG);
      await db.prisma.membership.create({
        data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' },
      });
      const found = await makeMembership().findActiveMembership(room.id, P1);
      expect(found?.role).toBe('PARTICIPANT');
    });

    it('returns null for a non-member', async () => {
      const room = await roomService.create(ORG);
      expect(await makeMembership().findActiveMembership(room.id, P1)).toBeNull();
    });

    it('returns null when the room is soft-deleted (REQ-SEC-003)', async () => {
      const room = await roomService.create(ORG);
      await db.prisma.membership.create({
        data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' },
      });
      await roomService.softDelete(room.id);
      expect(await makeMembership().findActiveMembership(room.id, P1)).toBeNull();
    });
  });
});

describe('MembershipService.exclude (REQ-ID-006, REQ-SEC-003)', () => {
  let db2: TestDb;
  let roomService2: RoomService;

  const makeMembership2 = () =>
    new MembershipService(
      db2.prisma,
      new IdentityService(db2.prisma),
      new JoinRateLimiter(1000),
      TEST_CONFIG,
    );

  beforeAll(async () => {
    db2 = await startTestDb();
    await seedIdentity(db2.prisma, { id: ORG, email: 'org2@example.test' });
    const outbox = new EventOutbox(db2.prisma, new RealtimeBus());
    roomService2 = new RoomService(
      db2.prisma,
      new EventLogService(new AppRegistryService([]), new EventEmitLimiter(1000), TEST_CONFIG, outbox),
      outbox,
      new AppRegistryService([]),
      new MembershipService(db2.prisma, new IdentityService(db2.prisma), new JoinRateLimiter(1000), TEST_CONFIG),
      TEST_CONFIG,
    );
  }, 120000);

  afterAll(async () => {
    await db2.stop();
  });

  afterEach(async () => {
    await db2.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE membership."Exclusion", identity."Session", membership."Membership", room."Room" CASCADE',
    );
  });

  // Активная комната ORG + вошедший гость; возвращает ids и ip гостя.
  async function roomWithGuest() {
    const room = await roomService2.create(ORG);
    const joined = await makeMembership2().join({ code: room.code, displayName: 'Гость', ip: IP });
    return { room, guest: joined };
  }

  it('happy path: soft-delete + Exclusion(ip, excludedBy, reason) + guest-сессии отозваны', async () => {
    const { room, guest } = await roomWithGuest();
    const tokens = new TokenService(db2.prisma, TEST_CONFIG);
    await tokens.issueGuestTokens(guest.identity.id, room.id);

    const result = await makeMembership2().exclude({
      roomId: room.id,
      targetIdentityId: guest.identity.id,
      actorId: ORG,
      reason: 'флуд',
    });

    expect(result).toEqual({ excluded: true });
    const membership = await db2.prisma.membership.findUnique({ where: { id: guest.membership.id } });
    expect(membership?.deletedAt).not.toBeNull();
    const exclusion = await db2.prisma.exclusion.findUnique({
      where: { roomId_identityId: { roomId: room.id, identityId: guest.identity.id } },
    });
    expect(exclusion).toMatchObject({ ip: IP, excludedBy: ORG, reason: 'флуд' });
    const sessions = await db2.prisma.session.findMany({ where: { identityId: guest.identity.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].revokedAt).not.toBeNull();
  });

  it('REGISTERED-цель сохраняет сессии (дизайн §0.2)', async () => {
    const room = await roomService2.create(ORG);
    const registered = await seedIdentity(db2.prisma, { kind: 'REGISTERED', email: 'reg@example.test' });
    await db2.prisma.membership.create({
      data: { roomId: room.id, identityId: registered.id, role: 'PARTICIPANT', joinIp: IP },
    });
    const tokens = new TokenService(db2.prisma, TEST_CONFIG);
    await tokens.issueGuestTokens(registered.id, room.id); // session row kind-агностичен

    await makeMembership2().exclude({ roomId: room.id, targetIdentityId: registered.id, actorId: ORG });

    const sessions = await db2.prisma.session.findMany({ where: { identityId: registered.id } });
    expect(sessions[0].revokedAt).toBeNull();
  });

  it('актор-не-член → ActorNotMemberError', async () => {
    const { room, guest } = await roomWithGuest();
    await expect(
      makeMembership2().exclude({ roomId: room.id, targetIdentityId: guest.identity.id, actorId: P1 }),
    ).rejects.toBeInstanceOf(ActorNotMemberError);
  });

  it('актор-участник (не ORGANIZER) → ActorNotOrganizerError (матрица REQ-ID-011)', async () => {
    const { room, guest } = await roomWithGuest();
    await expect(
      makeMembership2().exclude({ roomId: room.id, targetIdentityId: ORG, actorId: guest.identity.id }),
    ).rejects.toBeInstanceOf(ActorNotOrganizerError);
  });

  it('цель никогда не была членом → TargetNotMemberError', async () => {
    const { room } = await roomWithGuest();
    await expect(
      makeMembership2().exclude({ roomId: room.id, targetIdentityId: P1, actorId: ORG }),
    ).rejects.toBeInstanceOf(TargetNotMemberError);
  });

  it('цель — ORGANIZER → TargetNotExcludableError (защита от самоблокировки)', async () => {
    const { room } = await roomWithGuest();
    await expect(
      makeMembership2().exclude({ roomId: room.id, targetIdentityId: ORG, actorId: ORG }),
    ).rejects.toBeInstanceOf(TargetNotExcludableError);
  });

  it('повторное исключение — типизированный no-op без второго insert и без hook', async () => {
    const { room, guest } = await roomWithGuest();
    const service = makeMembership2();
    const handler = jest.fn();
    service.onAccessRevoked(handler);

    await service.exclude({ roomId: room.id, targetIdentityId: guest.identity.id, actorId: ORG });
    const second = await service.exclude({ roomId: room.id, targetIdentityId: guest.identity.id, actorId: ORG });

    expect(second).toEqual({ excluded: false });
    expect(await db2.prisma.exclusion.count()).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1); // только от первого, реального исключения
  });

  it('hook вызван пост-коммит с (identityId, roomId); бросок обработчика изолирован', async () => {
    const { room, guest } = await roomWithGuest();
    const service = makeMembership2();
    const calls: Array<[string, string]> = [];
    service.onAccessRevoked((identityId, roomId) => { calls.push([identityId, roomId]); });
    service.onAccessRevoked(() => { throw new Error('listener blew up'); });
    const afterThrow: Array<[string, string]> = [];
    service.onAccessRevoked((identityId, roomId) => { afterThrow.push([identityId, roomId]); });

    await expect(
      service.exclude({ roomId: room.id, targetIdentityId: guest.identity.id, actorId: ORG }),
    ).resolves.toEqual({ excluded: true });
    expect(calls).toEqual([[guest.identity.id, room.id]]);
    expect(afterThrow).toEqual([[guest.identity.id, room.id]]); // бросок соседа не помешал
  });

  it('async-обработчик с rejection изолирован: exclude не падает, следующие handlers выполняются', async () => {
    const { room, guest } = await roomWithGuest();
    const service = makeMembership2();
    const before: Array<[string, string]> = [];
    service.onAccessRevoked((identityId, roomId) => { before.push([identityId, roomId]); });
    // Rejected promise без await внутри exclude превратился бы в unhandled rejection —
    // на современном Node это падение процесса; изоляция обязана ловить и его.
    service.onAccessRevoked(() => Promise.reject(new Error('async listener blew up')));
    const after: Array<[string, string]> = [];
    service.onAccessRevoked((identityId, roomId) => { after.push([identityId, roomId]); });

    await expect(
      service.exclude({ roomId: room.id, targetIdentityId: guest.identity.id, actorId: ORG }),
    ).resolves.toEqual({ excluded: true });
    expect(before).toEqual([[guest.identity.id, room.id]]);
    expect(after).toEqual([[guest.identity.id, room.id]]); // rejection соседа не помешал
  });

  it('rejoin с IP исключённого → RoomJoinDeniedError, неотличим от «неверного кода» (REQ-ID-013)', async () => {
    const { room, guest } = await roomWithGuest();
    await makeMembership2().exclude({ roomId: room.id, targetIdentityId: guest.identity.id, actorId: ORG });
    await expect(
      makeMembership2().join({ code: room.code, displayName: 'Снова', ip: IP }),
    ).rejects.toBeInstanceOf(RoomJoinDeniedError);
  });

  it('rejoin с ДРУГОГО IP проходит — задокументированный обход REQ-ID-006', async () => {
    const { room, guest } = await roomWithGuest();
    await makeMembership2().exclude({ roomId: room.id, targetIdentityId: guest.identity.id, actorId: ORG });
    const rejoined = await makeMembership2().join({ code: room.code, displayName: 'Снова', ip: IP2 });
    expect(rejoined.membership.role).toBe('PARTICIPANT');
  });

  it('исключение в одной комнате не блокирует вход в другую', async () => {
    const { room, guest } = await roomWithGuest();
    const other = await roomService2.create(ORG);
    await makeMembership2().exclude({ roomId: room.id, targetIdentityId: guest.identity.id, actorId: ORG });
    const joined = await makeMembership2().join({ code: other.code, displayName: 'Снова', ip: IP });
    expect(joined.membership.roomId).toBe(other.id);
  });
});
