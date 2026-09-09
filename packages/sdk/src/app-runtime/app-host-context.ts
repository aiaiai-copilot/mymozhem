import type { MemberRole } from '../membership/member-role';

// Контекст вызова handlePublish. now тоже ISO-строка (та же причина, что у
// AppLogEvent.recordedAt — через границу только JSON-сериализуемые значения,
// REQ-CTR-002).
export interface AppHostContext<S> {
  readonly roomId: string;
  readonly actorId: string;
  readonly actorRole: MemberRole;
  readonly settings: unknown;
  readonly state: S;
  readonly now: string;
}
