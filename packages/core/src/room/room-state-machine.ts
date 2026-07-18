import { RoomTransitionError } from './room.errors';

// Domain status type. Prisma's generated `RoomStatus` enum (Task 2) mirrors these
// exact string members; the two are structurally interchangeable. This module stays
// Prisma-free so it is a pure, dependency-light leaf (unit-testable without a DB).
export type RoomStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

// Allow-list (REQ-RT-005). COMPLETED and CANCELLED are terminal — no outgoing edges.
const ROOM_TRANSITIONS: ReadonlyArray<readonly [RoomStatus, RoomStatus]> = [
  ['DRAFT', 'ACTIVE'],
  ['DRAFT', 'CANCELLED'],
  ['ACTIVE', 'COMPLETED'],
  ['ACTIVE', 'CANCELLED'],
];

// Soft-delete allowed in DRAFT/COMPLETED/CANCELLED, forbidden in ACTIVE (REQ-RT-005).
const DELETABLE_STATUSES: ReadonlySet<RoomStatus> = new Set<RoomStatus>([
  'DRAFT',
  'COMPLETED',
  'CANCELLED',
]);

export function canTransition(from: RoomStatus, to: RoomStatus): boolean {
  return ROOM_TRANSITIONS.some(([f, t]) => f === from && t === to);
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
