export interface ValidatedDeviceEvent {
  eventType: 'urination' | 'battery'; productModel: string; deviceId: string; topic: string;
  clientId: string; username: string; qos: 0 | 1 | 2; brokerReceivedAtMs: number;
  receivedAtMs: number; effectiveAtMs: number; timeSource: 'device' | 'server'; payload: Record<string, unknown>;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) freeze(child);
  }
  return value;
}
export function immutableEvent(event: ValidatedDeviceEvent): ValidatedDeviceEvent { return freeze(event); }
