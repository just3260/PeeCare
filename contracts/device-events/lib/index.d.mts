export type EventType = 'urination' | 'battery';
export type TimeSource = 'device' | 'server';
export interface DevicePayload { deviceId: string; eventId: string; eventType: EventType; recordedAtMs: number | null; [key: string]: unknown }
export declare function parseTopic(topic: unknown): { productModel: string; deviceId: string; eventType: EventType; schemaKey: EventType } | { error: string };
export declare function loadValidators(): { urination: unknown; battery: unknown };
export declare function validateEnvelope(envelope: unknown, validators: { urination: unknown; battery: unknown }): { ok: true; schemaKey: EventType } | { ok: false; error: string; summary: string };
export declare function deriveEffectiveTime(recordedAtMs: number | null, receivedAtMs: number): { effectiveAtMs: number; timeSource: TimeSource; recordedAtMs: number | null };
export declare const ERROR_CODES: Readonly<Record<string, string>>;
