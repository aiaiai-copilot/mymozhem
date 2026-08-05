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
