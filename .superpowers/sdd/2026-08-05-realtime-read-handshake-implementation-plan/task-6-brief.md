### Task 6: SubscriptionRegistry + MembershipService.findActiveMembership + токен лимитера

**Files:**
- Create: `packages/core/src/realtime/subscription-registry.ts`
- Create: `packages/core/src/realtime/subscription-registry.spec.ts`
- Create: `packages/core/src/realtime/realtime.tokens.ts`
- Modify: `packages/core/src/membership/membership.service.ts` (метод)
- Modify: `packages/core/src/membership/membership.service.int-spec.ts` (int-тест метода)

**Interfaces:**
- Consumes: `OutwardLevel` (Task 4); `JoinRateLimiter` (существующий, переиспользуется класс — отдельный инстанс по конвенции REFRESH_RATE_LIMITER).
- Produces (Task 7): `SubscriptionRegistry` с `add(sub: Subscription): void`, `get(socketId: string): Subscription | undefined`, `remove(socketId: string): void`, `socketsOf(identityId: string, roomId: string): readonly string[]`; интерфейс `Subscription { socketId, identityId, roomId, level: OutwardLevel }`; `RECONNECT_RATE_LIMITER` (Symbol DI-токен); `MembershipService.findActiveMembership(roomId: string, identityId: string): Promise<Membership | null>`.

- [ ] **Step 1: Failing unit test — реестр**

`packages/core/src/realtime/subscription-registry.spec.ts`:

```ts
import { SubscriptionRegistry } from './subscription-registry';

const SUB_A = { socketId: 's1', identityId: 'u1', roomId: 'r1', level: 'public' as const };
const SUB_B = { socketId: 's2', identityId: 'u1', roomId: 'r1', level: 'organizer' as const };
const SUB_C = { socketId: 's3', identityId: 'u2', roomId: 'r1', level: 'public' as const };

describe('SubscriptionRegistry', () => {
  it('add/get/remove round-trip', () => {
    const registry = new SubscriptionRegistry();
    registry.add(SUB_A);
    expect(registry.get('s1')).toEqual(SUB_A);
    registry.remove('s1');
    expect(registry.get('s1')).toBeUndefined();
  });

  it('socketsOf groups by (identityId, roomId) for the revoke hook', () => {
    const registry = new SubscriptionRegistry();
    registry.add(SUB_A);
    registry.add(SUB_B);
    registry.add(SUB_C);
    expect([...registry.socketsOf('u1', 'r1')].sort()).toEqual(['s1', 's2']);
    expect(registry.socketsOf('u2', 'r1')).toEqual(['s3']);
    expect(registry.socketsOf('u1', 'r2')).toEqual([]);
  });

  it('remove cleans the membership index; empty sets are dropped', () => {
    const registry = new SubscriptionRegistry();
    registry.add(SUB_A);
    registry.add(SUB_B);
    registry.remove('s1');
    expect(registry.socketsOf('u1', 'r1')).toEqual(['s2']);
    registry.remove('s2');
    expect(registry.socketsOf('u1', 'r1')).toEqual([]);
  });

  it('removing an unknown socket is a no-op', () => {
    const registry = new SubscriptionRegistry();
    expect(() => registry.remove('nope')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/core test subscription-registry`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Implementation — реестр + токен**

`packages/core/src/realtime/subscription-registry.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { OutwardLevel } from './projection.service';

export interface Subscription {
  readonly socketId: string;
  readonly identityId: string;
  readonly roomId: string;
  readonly level: OutwardLevel;
}

// Реестр подписок (design §2): источник «кто что слушает» для fan-out и hook'а
// разрыва (REQ-SEC-003). In-memory легален при одной реплике (REQ-OPS-005);
// состояние — поле экземпляра (REQ-CORE-004). Индекс по (identityId, roomId)
// поддерживается синхронно с bySocket — менять только вместе.
@Injectable()
export class SubscriptionRegistry {
  private readonly bySocket = new Map<string, Subscription>();
  private readonly socketsByMembership = new Map<string, Set<string>>();

  private static key(identityId: string, roomId: string): string {
    return `${identityId}:${roomId}`;
  }

  add(sub: Subscription): void {
    this.bySocket.set(sub.socketId, sub);
    const key = SubscriptionRegistry.key(sub.identityId, sub.roomId);
    const set = this.socketsByMembership.get(key) ?? new Set<string>();
    set.add(sub.socketId);
    this.socketsByMembership.set(key, set);
  }

  get(socketId: string): Subscription | undefined {
    return this.bySocket.get(socketId);
  }

  remove(socketId: string): void {
    const sub = this.bySocket.get(socketId);
    if (sub === undefined) return;
    this.bySocket.delete(socketId);
    const key = SubscriptionRegistry.key(sub.identityId, sub.roomId);
    const set = this.socketsByMembership.get(key);
    set?.delete(socketId);
    if (set?.size === 0) this.socketsByMembership.delete(key);
  }

  socketsOf(identityId: string, roomId: string): readonly string[] {
    return [...(this.socketsByMembership.get(SubscriptionRegistry.key(identityId, roomId)) ?? [])];
  }
}
```

`packages/core/src/realtime/realtime.tokens.ts`:

```ts
// DI-токен per-identity лимитера reconnect/replay (REQ-RT-015, объём v1.3).
// Отдельный инстанс JoinRateLimiter — состояние не делится с join/refresh
// лимитерами (конвенция REFRESH_RATE_LIMITER транспортного среза).
export const RECONNECT_RATE_LIMITER = Symbol('RECONNECT_RATE_LIMITER');
```

- [ ] **Step 4: Run unit test**

Run: `pnpm --filter @mymozhem/core test subscription-registry`
Expected: PASS (4 теста).

- [ ] **Step 5: findActiveMembership — failing int-test**

Добавить describe в `packages/core/src/membership/membership.service.int-spec.ts` (внутри существующего beforeAll-контекста с db; посев — по образцу существующих тестов файла: комната через RoomService, членство через `db.prisma.membership.create`):

```ts
  describe('findActiveMembership', () => {
    it('returns the membership of a live member in a live room', async () => {
      const room = await rooms.create(ORG);
      await db.prisma.membership.create({
        data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' },
      });
      const found = await membership.findActiveMembership(room.id, P1);
      expect(found?.role).toBe('PARTICIPANT');
    });

    it('returns null for a non-member', async () => {
      const room = await rooms.create(ORG);
      expect(await membership.findActiveMembership(room.id, P1)).toBeNull();
    });

    it('returns null when the room is soft-deleted (REQ-SEC-003)', async () => {
      const room = await rooms.create(ORG);
      await db.prisma.membership.create({
        data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' },
      });
      await rooms.softDelete(room.id);
      expect(await membership.findActiveMembership(room.id, P1)).toBeNull();
    });
  });
```

(Имена переменных `rooms`/`membership`/`P1` — выровнять по фактическим в файле спеки; визит в файл обязателен до вставки.)

- [ ] **Step 6: Run to fail, implement, run to pass**

Run: `pnpm --filter @mymozhem/core test:int membership.service -t "findActiveMembership"`
Expected: FAIL — метод не существует.

В `packages/core/src/membership/membership.service.ts` после `createOrganizerMembership` добавить:

```ts
  // Read-path realtime-среза (REQ-SEC-003): живое членство в живой комнате.
  // Мягкое удаление комнаты гасит членство для чтения; мягкого удаления самой
  // membership в схеме пока нет — появится со срезом исключения (там же hook
  // SubscriptionRegistry.revokeRoomAccess получит вызывающего).
  async findActiveMembership(roomId: string, identityId: string): Promise<Membership | null> {
    const membership = await this.prisma.membership.findUnique({
      where: { roomId_identityId: { roomId, identityId } },
      include: { room: true },
    });
    if (!membership || membership.room.deletedAt !== null) return null;
    return membership;
  }
```

Run: `pnpm --filter @mymozhem/core test:int membership.service`
Expected: PASS всего файла.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/realtime/subscription-registry.ts packages/core/src/realtime/subscription-registry.spec.ts packages/core/src/realtime/realtime.tokens.ts packages/core/src/membership/membership.service.ts packages/core/src/membership/membership.service.int-spec.ts
git commit -m "feat(core): SubscriptionRegistry + findActiveMembership + токен reconnect-лимитера (REQ-SEC-003, REQ-RT-015)"
```

---

