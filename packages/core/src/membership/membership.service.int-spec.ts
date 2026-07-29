import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import type { AppConfig } from '../config/config.schema';
import { EventLogService } from '../realtime/event-log.service';
import { AppRegistryService } from '../app-registry/app-registry.service';
import { RoomService } from '../room/room.service';
import { IdentityService } from '../identity/identity.service';
import { MembershipService } from './membership.service';
import { JoinRateLimiter } from './join-rate-limiter';
import {
  JoinRateLimitedError,
  RoomJoinDeniedError,
  RoomParticipantLimitReachedError,
} from './membership.errors';

const ORG = '00000000-0000-0000-0000-000000000001';
const IP = '203.0.113.7';
const IP2 = '198.51.100.9';

const TEST_CONFIG: AppConfig = {
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: 'postgresql://unused',
  ROOM_CODE_MIN_LEN: 8,
  ROOM_PARTICIPANT_LIMIT: 500,
  JOIN_RATE_LIMIT_IP: 20,
};

describe('MembershipService.join (REQ-ID-002/003/006/013)', () => {
  let db: TestDb;
  let roomService: RoomService;

  const makeMembership = (overrides: { participantLimit?: number; rateLimit?: number } = {}) =>
    new MembershipService(
      db.prisma,
      new IdentityService(db.prisma),
      new JoinRateLimiter(overrides.rateLimit ?? 1000),
      { ...TEST_CONFIG, ROOM_PARTICIPANT_LIMIT: overrides.participantLimit ?? 500 },
    );

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    roomService = new RoomService(
      db.prisma,
      new EventLogService(),
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
});
