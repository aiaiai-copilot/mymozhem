import { Injectable } from '@nestjs/common';
import type { Room } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertTransition, assertDeletable, type RoomStatus } from './room-state-machine';
import { RoomConflictError } from './room.errors';

@Injectable()
export class RoomService {
  constructor(private readonly prisma: PrismaService) {}

  create(organizerId: string): Promise<Room> {
    // Organizer is a plain id here; REGISTERED check + FK deferred (REQ-ID-005).
    return this.prisma.room.create({ data: { organizerId } });
  }

  async transition(roomId: string, to: RoomStatus): Promise<Room> {
    const current = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!current || current.deletedAt !== null) {
      throw new RoomConflictError(`Room ${roomId} not found or deleted`);
    }
    // State-machine legality first — precise ROOM_TRANSITION_INVALID for an existing room.
    assertTransition(current.status as RoomStatus, to);
    // Atomic guarded update: correctness of the race rests on this WHERE, not on the
    // read above (REQ-RT-005; same DB-invariant philosophy as REQ-RWD-010).
    const res = await this.prisma.room.updateMany({
      where: { id: roomId, status: current.status, deletedAt: null },
      data: { status: to },
    });
    if (res.count === 0) {
      throw new RoomConflictError(`Room ${roomId} changed concurrently`);
    }
    return this.prisma.room.findUniqueOrThrow({ where: { id: roomId } });
  }

  activate(roomId: string): Promise<Room> {
    return this.transition(roomId, 'ACTIVE');
  }

  complete(roomId: string): Promise<Room> {
    return this.transition(roomId, 'COMPLETED');
  }

  cancel(roomId: string): Promise<Room> {
    return this.transition(roomId, 'CANCELLED');
  }

  async softDelete(roomId: string): Promise<Room> {
    const current = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!current || current.deletedAt !== null) {
      throw new RoomConflictError(`Room ${roomId} not found or already deleted`);
    }
    assertDeletable(current.status as RoomStatus);
    const res = await this.prisma.room.updateMany({
      where: { id: roomId, deletedAt: null, status: { not: 'ACTIVE' } },
      data: { deletedAt: new Date() },
    });
    if (res.count === 0) {
      throw new RoomConflictError(`Room ${roomId} changed concurrently`);
    }
    return this.prisma.room.findUniqueOrThrow({ where: { id: roomId } });
  }
}
