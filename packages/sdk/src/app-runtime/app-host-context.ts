import type { MemberRole } from '../membership/member-role';

// Снапшот пула розыгрыша (design §2, вариант A2): активные PARTICIPANT-членства
// комнаты. Наполняется диспетчером только для модулей с capability 'rewards'.
export interface DrawPoolEntry {
  readonly identityId: string;
  readonly kind: 'REGISTERED' | 'GUEST';
}

// Контекст вызова handlePublish. now тоже ISO-строка (та же причина, что у
// AppLogEvent.recordedAt — через границу только JSON-сериализуемые значения,
// REQ-CTR-002).
export interface AppHostContext<S> {
  readonly roomId: string;
  readonly actorId: string;
  readonly actorRole: MemberRole;
  readonly settings: unknown;
  readonly state: S;
  readonly now: string; // ISO
  // Хост-примитивы (design §2): randomInt — над crypto.randomInt (node:crypto,
  // CSPRNG по построению, REQ-RWD-011); иного санкционированного источника
  // случайности у модуля нет. Зафиксированное расширение трактовки REQ-CTR-002
  // (прецедент функций в контракте — reduce/handlePublish).
  readonly randomInt: (boundExclusive: number) => number;
  readonly drawPool: readonly DrawPoolEntry[];
}
