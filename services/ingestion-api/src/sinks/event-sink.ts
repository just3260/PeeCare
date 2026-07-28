import type { ValidatedDeviceEvent } from '../domain/validated-device-event.js';

export type SinkOutcome = 'accepted' | 'stored' | 'duplicate' | 'event_id_conflict' | 'unknown_device' | 'device_disabled' | 'product_model_mismatch' | 'unavailable' | 'aggregation_integrity_error';
export interface EventSink { accept(event: ValidatedDeviceEvent, requestContext: { requestId: string }): Promise<SinkOutcome>; }
export class SinkUnavailableError extends Error { constructor() { super('sink unavailable'); } }
export class TemporarySinkError extends Error { constructor() { super('temporary sink failure'); } }
