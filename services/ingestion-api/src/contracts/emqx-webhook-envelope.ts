export interface EmqxEnvelope { topic: string; clientId: string; username: string; qos: 0 | 1 | 2; retained: false; brokerReceivedAtMs: number; payload: Record<string, unknown>; }
const keys = ['topic', 'clientId', 'username', 'qos', 'retained', 'brokerReceivedAtMs', 'payload'];
const plain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export function parseEnvelope(value: unknown): { ok: true; value: EmqxEnvelope } | { ok: false; code: 'invalid_envelope' | 'retained_event' } {
  if (!plain(value) || Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) return { ok: false, code: 'invalid_envelope' };
  const v = value as Record<string, unknown>;
  if (v.retained !== false) return { ok: false, code: v.retained === true ? 'retained_event' : 'invalid_envelope' };
  if (typeof v.topic !== 'string' || typeof v.clientId !== 'string' || typeof v.username !== 'string' || v.clientId.length < 1 || v.clientId.length > 128 || v.username.length < 1 || v.username.length > 128 || ![0, 1, 2].includes(v.qos as number) || !Number.isSafeInteger(v.brokerReceivedAtMs) || (v.brokerReceivedAtMs as number) < 0 || !plain(v.payload)) return { ok: false, code: 'invalid_envelope' };
  return { ok: true, value: v as unknown as EmqxEnvelope };
}
