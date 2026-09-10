// Событие лога как его видит модуль при replay. recordedAt —
// ISO-строка, не Date: через границу ходят только JSON-сериализуемые значения
// (REQ-CTR-002); модуль делает Date.parse сам.
export interface AppLogEvent {
  readonly shortName: string;
  readonly payload: Record<string, unknown>;
  readonly actorId: string | null;
  readonly seq: number;
  readonly recordedAt: string;
}
