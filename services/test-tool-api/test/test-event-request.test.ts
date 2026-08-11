import { describe, expect, it } from 'vitest';

import {
  InvalidTestEventRequestError,
  parseTestEventRequest,
} from '../src/events/test-event-request.js';

describe('typed Test Tool event request parser', () => {
  it.each([
    [
      'urination minima',
      { eventType: 'urination', flushDurationMs: 0, pumpDurationMs: 0 },
    ],
    [
      'urination uint32 maxima',
      {
        eventType: 'urination',
        flushDurationMs: 4_294_967_295,
        pumpDurationMs: 4_294_967_295,
      },
    ],
    ['battery without voltage', { eventType: 'battery', batteryLevelPercent: 75 }],
    [
      'battery minima',
      { eventType: 'battery', batteryLevelPercent: 0, batteryVoltageMv: 0 },
    ],
    [
      'battery maxima',
      { eventType: 'battery', batteryLevelPercent: 100, batteryVoltageMv: 20_000 },
    ],
  ])('accepts exact %s measurements', (_case, body) => {
    expect(parseTestEventRequest(body)).toEqual(body);
  });

  it.each([
    ['null', null],
    ['array', []],
    ['string', 'battery'],
    ['missing eventType', { batteryLevelPercent: 75 }],
    ['unknown eventType', { eventType: 'temperature', temperatureC: 24 }],
    ['urination missing flush', { eventType: 'urination', pumpDurationMs: 5000 }],
    ['urination missing pump', { eventType: 'urination', flushDurationMs: 3000 }],
    [
      'negative flush',
      { eventType: 'urination', flushDurationMs: -1, pumpDurationMs: 5000 },
    ],
    [
      'overflow flush',
      { eventType: 'urination', flushDurationMs: 4_294_967_296, pumpDurationMs: 5000 },
    ],
    [
      'fractional pump',
      { eventType: 'urination', flushDurationMs: 3000, pumpDurationMs: 1.5 },
    ],
    ['non-tier battery', { eventType: 'battery', batteryLevelPercent: 80 }],
    ['string battery', { eventType: 'battery', batteryLevelPercent: '75' }],
    [
      'negative voltage',
      { eventType: 'battery', batteryLevelPercent: 75, batteryVoltageMv: -1 },
    ],
    [
      'overflow voltage',
      { eventType: 'battery', batteryLevelPercent: 75, batteryVoltageMv: 20_001 },
    ],
    [
      'fractional voltage',
      { eventType: 'battery', batteryLevelPercent: 75, batteryVoltageMv: 3900.5 },
    ],
    [
      'explicit undefined voltage',
      { eventType: 'battery', batteryLevelPercent: 75, batteryVoltageMv: undefined },
    ],
  ])('rejects %s with one sanitized error', (_case, body) => {
    expect(() => parseTestEventRequest(body)).toThrow(new InvalidTestEventRequestError());
  });

  it.each([
    'url',
    'method',
    'headers',
    'authorization',
    'topic',
    'projectId',
    'productModel',
    'eventId',
    'sequence',
    'recordedAtMs',
    'firmwareVersion',
    'clientId',
    'username',
    'qos',
    'retained',
    'brokerReceivedAtMs',
  ])('rejects caller-controlled %s without preserving its value', (field) => {
    const privateValue = `private-${field}-value`;
    expect(() =>
      parseTestEventRequest({
        eventType: 'battery',
        batteryLevelPercent: 75,
        [field]: privateValue,
      }),
    ).toThrow(new InvalidTestEventRequestError());
    try {
      parseTestEventRequest({
        eventType: 'battery',
        batteryLevelPercent: 75,
        [field]: privateValue,
      });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(privateValue);
      expect((error as Error).message).not.toContain(field);
    }
  });
});
