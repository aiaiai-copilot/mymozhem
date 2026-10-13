### Task 4: MembershipService — assertMember/assertOrganizer/listRoster

**Files:**
- Modify: `packages/core/src/membership/membership.service.ts`
- Test: `packages/core/src/membership/membership.int-spec.ts` (существующая int-спека membership; найти по `findActiveMembership`)

**Interfaces:**
- Consumes: `findActiveMembership(roomId, identityId)`, `ActorNotMemberError`, `ActorNotOrganizerError` (оба в `./membership.errors`).
- Produces: `assertMember(roomId, identityId): Promise<Membership>`, `assertOrganizer(roomId, identityId): Promise<Membership>`, `listRoster(roomId): Promise<{ identityId: string; displayName: string | null; role: MemberRole }[]>` — потребители: Task 5.

- [ ] **Step 1: Failing tests**

```ts
it('assertMember throws ActorNotMemberError for non-member, returns membership for member', ...)
it('assertOrganizer throws ActorNotOrganizerError for PARTICIPANT, passes for ORGANIZER', ...)
it('listRoster returns active members with identity displayName (null after sweep)', async () => {
  // организатор + гость + swept-гость (displayName null) + исключённый (deletedAt membership) —
  // исключённого нет, swept с null-именем есть
});
```

- [ ] **Step 2: Run red** — `pnpm --filter @mymozhem/core test:int -- membership` → FAIL (методов нет)

- [ ] **Step 3: Implement**

```ts
  // Актор — активный член комнаты любой роли (UI-срез: ростер, решение №10).
  async assertMember(roomId: string, identityId: string): Promise<Membership> {
    const m = await this.findActiveMembership(roomId, identityId);
    if (!m) {
      throw new ActorNotMemberError(`identity ${identityId} is not an active member of room ${roomId}`);
    }
    return m;
  }

  // Актор — ORGANIZER комнаты (UI-срез: lifecycle-контур, решение №9).
  async assertOrganizer(roomId: string, identityId: string): Promise<Membership> {
    const m = await this.assertMember(roomId, identityId);
    if (m.role !== 'ORGANIZER') {
      throw new ActorNotOrganizerError(`identity ${identityId} is not organizer of room ${roomId}`);
    }
    return m;
  }

  // Ростер комнаты: активные membership'ы; displayName null после TTL-свипа (решение №10).
  async listRoster(roomId: string): Promise<{ identityId: string; displayName: string | null; role: MemberRole }[]> {
    const rows = await this.prisma.membership.findMany({
      where: { roomId, deletedAt: null, room: { deletedAt: null } },
      select: { identityId: true, role: true, identity: { select: { displayName: true } } },
    });
    return rows.map((r) => ({ identityId: r.identityId, displayName: r.identity.displayName, role: r.role }));
  }
```

(`Membership`, `MemberRole` — Prisma-типы, уже импортируемые или добавить импорт; следовать стилю файла.)

- [ ] **Step 4: Run green** — тот же прогон + полный int core

- [ ] **Step 5: Commit** — `feat(core): MembershipService — assertMember/assertOrganizer/listRoster (UI-срез)`

