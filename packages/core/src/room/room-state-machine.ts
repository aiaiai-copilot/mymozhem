import { RoomTransitionError } from './room.errors';

// Domain status type. The `RoomStatus` enum in the Prisma `room` schema mirrors these
// exact string members, so a row's status is assignable here by a cast at the service
// boundary. This module stays Prisma-free so it is a pure, dependency-light leaf
// (unit-testable without a DB).
export type RoomStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

// Allow-list (REQ-RT-005), keyed by source status: adding a member to RoomStatus is a
// compile error here until its outgoing edges are declared. COMPLETED and CANCELLED are
// terminal — stated as empty sets in the data, not only in prose.
const ROOM_TRANSITIONS: Readonly<Record<RoomStatus, ReadonlySet<RoomStatus>>> = {
  DRAFT: new Set<RoomStatus>(['ACTIVE', 'CANCELLED']),
  ACTIVE: new Set<RoomStatus>(['COMPLETED', 'CANCELLED']),
  COMPLETED: new Set<RoomStatus>(),
  CANCELLED: new Set<RoomStatus>(),
};

// Soft-delete allowed in DRAFT/COMPLETED/CANCELLED, forbidden in ACTIVE (REQ-RT-005).
const DELETABLE_STATUSES: ReadonlySet<RoomStatus> = new Set<RoomStatus>([
  'DRAFT',
  'COMPLETED',
  'CANCELLED',
]);

export function canTransition(from: RoomStatus, to: RoomStatus): boolean {
  return ROOM_TRANSITIONS[from].has(to);
}

export function assertTransition(from: RoomStatus, to: RoomStatus): void {
  if (!canTransition(from, to)) {
    throw new RoomTransitionError(`Illegal room transition: ${from} -> ${to}`);
  }
}

export function isDeletable(status: RoomStatus): boolean {
  return DELETABLE_STATUSES.has(status);
}

export function assertDeletable(status: RoomStatus): void {
  if (!isDeletable(status)) {
    throw new RoomTransitionError(`Room in status ${status} cannot be soft-deleted`);
  }
}
